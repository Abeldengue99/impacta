import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { MEDIA_DIRECTORY, MediaProcessingError, optimizeProfileAvatar, optimizeProfileCover, promotionMediaStoragePath } from './media-processing.js';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const storageDirectory = MEDIA_DIRECTORY;

interface ProfileSession { userId: string; csrfTokenHash?: string }
interface ProfileInput {
    displayName?: unknown;
    headline?: unknown;
    bio?: unknown;
    location?: unknown;
    occupation?: unknown;
    organization?: unknown;
    websiteUrl?: unknown;
    skills?: unknown;
    impactAreaId?: unknown;
    customImpactArea?: unknown;
    isPublic?: unknown;
}
interface AvatarDimensions { width: number; height: number }

function readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
    }
    return undefined;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function validId(value: string | undefined): value is string {
    if (!value || !/^[1-9]\d{0,18}$/.test(value)) return false;
    try { return BigInt(value) <= 9223372036854775807n; } catch { return false; }
}

function validProfileDocumentType(value: string | undefined): value is 'cv' | 'portfolio' {
    return value === 'cv' || value === 'portfolio';
}

function cleanText(value: unknown, maxLength: number, allowEmpty = true): string | null {
    if (typeof value !== 'string') return null;
    const result = value.trim();
    if ((!allowEmpty && !result) || Array.from(result).length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) return null;
    return result;
}

async function getSession(request: FastifyRequest, reply: FastifyReply, pool: Pool, requireCsrf: boolean): Promise<ProfileSession | null> {
    const token = readCookie(request.headers.cookie, 'impacta_session');
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        await reply.code(401).send({ error: 'authentication_required' });
        return null;
    }

    const result = await pool.query<{ user_id: string; csrf_token_hash: string | null }>(
        `SELECT session.user_id::text AS user_id, session.csrf_token_hash
         FROM impacta.auth_sessions AS session
         JOIN impacta.users AS account ON account.id = session.user_id
         WHERE session.token_hash = $1 AND session.revoked_at IS NULL
           AND session.idle_expires_at > now() AND session.absolute_expires_at > now()
           AND account.status = 'active'
         LIMIT 1`,
        [hashToken(token)]
    );
    const session = result.rows[0];
    if (!session) {
        await reply.code(401).send({ error: 'authentication_required' });
        return null;
    }
    if (!requireCsrf) return { userId: session.user_id };

    const cookieToken = readCookie(request.headers.cookie, 'impacta_csrf');
    const headerToken = request.headers['x-csrf-token'];
    if (typeof headerToken !== 'string' || !cookieToken
        || !safeEqualHex(cookieToken, headerToken)
        || !session.csrf_token_hash
        || !safeEqualHex(session.csrf_token_hash, hashToken(cookieToken))) {
        await reply.code(403).send({ error: 'csrf_validation_failed' });
        return null;
    }
    return { userId: session.user_id, csrfTokenHash: session.csrf_token_hash ?? undefined };
}

function imageDimensions(bytes: Buffer, mimeType: string): AvatarDimensions | null {
    if (mimeType === 'image/png') {
        const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)
            || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType !== 'image/jpeg' || bytes.length < 12
        || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;

    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) return null;
        const segmentLength = bytes.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
        if (startOfFrame.has(marker)) {
            if (segmentLength < 7) return null;
            return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
        }
        offset += segmentLength;
    }
    return null;
}

function validDimensions(dimensions: AvatarDimensions | null): dimensions is AvatarDimensions {
    return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0
        && dimensions.width <= MAX_IMAGE_SIDE && dimensions.height <= MAX_IMAGE_SIDE
        && dimensions.width * dimensions.height <= MAX_IMAGE_PIXELS);
}

function validCoverDimensions(dimensions: AvatarDimensions | null): dimensions is AvatarDimensions {
    return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0
        && dimensions.width <= 8192 && dimensions.height <= 8192
        && dimensions.width * dimensions.height <= 40_000_000);
}

function safeStoragePath(storageKey: string): string | null {
    if (/^promotions\/[a-f0-9-]{36}\.webp$/i.test(storageKey)) return promotionMediaStoragePath(storageKey);
    if (!/^(?:[a-f0-9-]{36}\.(?:png|jpg|webp)|posts\/[a-f0-9-]{36}\.(?:webp|mp4)|profile-documents\/[a-f0-9-]{36}\.pdf)$/i.test(storageKey)) return null;
    const path = resolve(storageDirectory, storageKey);
    return path.startsWith(`${storageDirectory}${process.platform === 'win32' ? '\\' : '/'}`) ? path : null;
}

function avatarUrl(id: string | null): string | null {
    return id ? `/api/v1/media/${encodeURIComponent(id)}` : null;
}

async function findOptionalSessionUserId(request: FastifyRequest, pool: Pool): Promise<string | null> {
    const token = readCookie(request.headers.cookie, 'impacta_session');
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
    const result = await pool.query<{ user_id: string }>(
        'SELECT session.user_id::text AS user_id ' +
        'FROM impacta.auth_sessions AS session ' +
        'JOIN impacta.users AS account ON account.id = session.user_id ' +
        'WHERE session.token_hash = $1 AND session.revoked_at IS NULL ' +
        'AND session.idle_expires_at > now() AND session.absolute_expires_at > now() ' +
        'AND account.status = \'active\' ' +
        'AND (NOT account.mfa_required OR session.mfa_verified_at IS NOT NULL) LIMIT 1',
        [hashToken(token)]
    );
    return result.rows[0]?.user_id ?? null;
}
export function registerProfileRoutes(server: FastifyInstance, pool: Pool): void {
    const listProfilePosts = async (userId: string, before: string | null, publicOnly: boolean, viewerUserId: string | null) => {
        const result = await pool.query(
            `SELECT post.id::text AS id, post.body, post.category_code, post.custom_category,
                    COALESCE(NULLIF(post.custom_category, ''), post_category.name) AS category, post.created_at,
                    (post.updated_at > post.created_at) AS edited,
                    account.id::text AS author_id, account.display_name AS author,
                    community.name AS community,
                    project.title AS project,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'user_id', mentioned.id::text,
                            'display_name', mentioned.display_name,
                            'is_public', mentioned_profile.is_public
                        ) ORDER BY mentioned.display_name)
                        FROM impacta.content_mentions AS mention
                        JOIN impacta.users AS mentioned
                          ON mentioned.id = mention.mentioned_user_id AND mentioned.status = 'active'
                        JOIN impacta.user_profiles AS mentioned_profile
                          ON mentioned_profile.user_id = mentioned.id AND mentioned_profile.is_public
                        WHERE mention.post_id = post.id
                    ), '[]'::json) AS mentions,
                    (NOT $3::boolean) AS is_author,
                    (SELECT count(reaction.user_id)::int FROM impacta.reactions AS reaction
                     WHERE reaction.post_id = post.id) AS support_count,
                     EXISTS (SELECT 1 FROM impacta.reactions AS viewer_reaction
                             WHERE viewer_reaction.post_id = post.id AND viewer_reaction.user_id = $4::bigint)
                         AS supported_by_viewer,
                    (SELECT count(comment.id)::int FROM impacta.comments AS comment
                     WHERE comment.post_id = post.id AND comment.status = 'published'
                       AND comment.deleted_at IS NULL) AS comment_count,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'id', media.id::text,
                            'url', '/api/v1/media/' || media.id::text,
                            'media_type', media.media_type,
                            'mime_type', media.mime_type
                        ) ORDER BY relation.position)
                        FROM impacta.post_media AS relation
                        JOIN impacta.media AS media ON media.id = relation.media_id
                        WHERE relation.post_id = post.id AND media.status = 'available'
                    ), '[]'::json) AS media
             FROM impacta.posts AS post
             JOIN impacta.users AS account ON account.id = post.author_user_id AND account.status = 'active'
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
             LEFT JOIN impacta.post_categories AS post_category ON post_category.code = post.category_code
             LEFT JOIN impacta.communities AS community ON community.id = post.community_id
             LEFT JOIN impacta.projects AS project ON project.id = post.project_id
             LEFT JOIN impacta.communities AS project_community ON project_community.id = project.community_id
             WHERE post.author_user_id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
               AND post.moderation_status = 'approved'
               AND ($3::boolean = false OR profile.is_public)
               AND (post.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
               AND (post.project_id IS NULL OR
                    (project.status IN ('active', 'completed') AND
                     (project.community_id IS NULL OR
                      (project_community.status = 'active' AND project_community.visibility = 'public'))))
               AND ($2::bigint IS NULL OR post.id < $2::bigint)
             ORDER BY post.id DESC
             LIMIT 21`,
            [userId, before, publicOnly, viewerUserId]
        );
        const hasMore = result.rows.length > 20;
        const items = result.rows.slice(0, 20);
        return { items, nextBefore: hasMore ? items.at(-1)?.id ?? null : null };
    };

    server.get<{ Querystring: { before?: string } }>('/api/v1/profile/posts', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const before = request.query.before ?? null;
        if (before !== null && (typeof before !== 'string' || !validId(before))) {
            return reply.code(400).send({ error: 'invalid_cursor' });
        }
        return listProfilePosts(session.userId, before, false, session.userId);
    });

    server.get<{ Params: { userId: string }; Querystring: { before?: string } }>('/api/v1/profiles/:userId/posts', async (request, reply) => {
        const userId = request.params.userId;
        const before = request.query.before ?? null;
        if (!validId(userId)) return reply.code(404).send({ error: 'profile_not_found' });
        if (before !== null && (typeof before !== 'string' || !validId(before))) {
            return reply.code(400).send({ error: 'invalid_cursor' });
        }
        const visible = await pool.query(
            `SELECT 1 FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             WHERE account.id = $1 AND account.status = 'active'`,
            [userId]
        );
        if (visible.rowCount === 0) return reply.code(404).send({ error: 'profile_not_found' });
        const viewerUserId = await findOptionalSessionUserId(request, pool);
        return listProfilePosts(userId, before, true, viewerUserId);
    });

    server.get('/api/v1/profile', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const [profileResult, areasResult] = await Promise.all([
            pool.query(
                `SELECT account.id::text AS id, account.display_name, account.email, account.created_at,
                        profile.headline, profile.bio, profile.location, profile.occupation,
                        profile.organization, profile.website_url, profile.skills,
                        profile.impact_area_id::text AS impact_area_id, profile.custom_impact_area,
                        profile.is_public, COALESCE(NULLIF(profile.custom_impact_area, ''), area.name) AS impact_area,
                        avatar.id::text AS avatar_id, cover.id::text AS cover_id,
                        COALESCE((
                            SELECT json_object_agg(document.document_type, json_build_object(
                                'url', '/api/v1/profiles/' || account.id::text || '/documents/' || document.document_type,
                                'byteSize', document.byte_size,
                                'updatedAt', document.updated_at
                            ))
                            FROM impacta.profile_documents AS document
                            WHERE document.user_id = account.id
                        ), '{}'::json) AS documents,
                        (SELECT count(*)::int FROM impacta.impactation_requests AS connection
                         WHERE connection.status = 'accepted'
                           AND (connection.requester_user_id = account.id OR connection.recipient_user_id = account.id))
                            AS impactation_count
                 FROM impacta.users AS account
                 JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
                 LEFT JOIN impacta.impact_areas AS area ON area.id = profile.impact_area_id
                 LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
                     AND avatar.status = 'available' AND avatar.media_type = 'image'
                 LEFT JOIN impacta.media AS cover ON cover.id = profile.cover_media_id
                     AND cover.status = 'available' AND cover.media_type = 'image'
                 WHERE account.id = $1 AND account.status = 'active'`,
                [session.userId]
            ),
            pool.query<{ id: string; name: string }>(
                'SELECT id::text AS id, name FROM impacta.impact_areas WHERE is_active ORDER BY name'
            )
        ]);
        const profile = profileResult.rows[0];
        if (!profile) return reply.code(404).send({ error: 'profile_not_found' });
        return {
            profile: {
                id: profile.id,
                displayName: profile.display_name,
                email: profile.email,
                createdAt: profile.created_at,
                headline: profile.headline,
                bio: profile.bio,
                location: profile.location ?? '',
                occupation: profile.occupation,
                organization: profile.organization,
                websiteUrl: profile.website_url,
                skills: profile.skills,
                impactAreaId: profile.impact_area_id,
                customImpactArea: profile.custom_impact_area,
                impactArea: profile.impact_area,
                isPublic: profile.is_public,
                avatarUrl: avatarUrl(profile.avatar_id),
                coverUrl: avatarUrl(profile.cover_id),
                documents: profile.documents ?? {},
                impactationCount: profile.impactation_count
            },
            impactAreas: areasResult.rows
        };
    });

    server.get('/api/v1/profile/projects', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query(
            `SELECT project.id::text AS id, project.title, project.description, project.status,
                    (project.owner_user_id = $1) AS is_owner,
                    project.community_id::text AS community_id,
                    project.impact_area_id::text AS impact_area_id,
                    project.review_reason, project.reviewed_at,
                    to_char(project.starts_at AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD') AS starts_at,
                    CASE WHEN project.ends_at IS NULL THEN NULL
                         ELSE to_char((project.ends_at - interval '1 millisecond') AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD')
                    END AS ends_at,
                    project.location_city, project.location_neighborhood, project.location_municipality,
                    project.location_province, project.location_commune,
                    community.name AS community_name, area.name AS impact_area,
                    (SELECT count(member.project_id)::int FROM impacta.project_members AS member
                     WHERE member.project_id = project.id AND member.membership_role = 'contributor') AS applicant_count
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE (project.owner_user_id = $1 AND project.status IN ('review', 'active', 'rejected'))
                OR (project.status = 'active'
                    AND (project.starts_at IS NULL OR project.starts_at <= now())
                    AND (project.ends_at IS NULL OR project.ends_at >= now())
                    AND EXISTS (SELECT 1 FROM impacta.project_members AS membership
                                WHERE membership.project_id = project.id AND membership.user_id = $1))
             ORDER BY project.created_at DESC, project.id DESC
             LIMIT 50`,
            [session.userId]
        );
        return { items: result.rows };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/profiles/:userId/projects', async (request, reply) => {
        const userId = request.params.userId;
        if (!validId(userId)) return reply.code(404).send({ error: 'profile_not_found' });
        const visible = await pool.query(
            `SELECT 1 FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             WHERE account.id = $1 AND account.status = 'active'`,
            [userId]
        );
        if (visible.rowCount === 0) return reply.code(404).send({ error: 'profile_not_found' });
        const result = await pool.query(
            `SELECT project.id::text AS id, project.title, project.description, project.status,
                    (project.owner_user_id = $1 OR community.owner_user_id = $1) AS is_owner,
                    project.community_id::text AS community_id,
                    project.impact_area_id::text AS impact_area_id,
                    project.location_city, project.location_neighborhood, project.location_municipality,
                    project.location_province, project.location_commune,
                    community.name AS community_name, area.name AS impact_area,
                    (SELECT count(member.project_id)::int FROM impacta.project_members AS member
                     WHERE member.project_id = project.id AND member.membership_role = 'contributor') AS applicant_count
             FROM impacta.projects AS project
             JOIN impacta.users AS account ON account.id = $1 AND account.status = 'active'
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE project.status = 'active'
               AND (project.starts_at IS NULL OR project.starts_at <= now())
               AND (project.ends_at IS NULL OR project.ends_at >= now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
               AND (project.owner_user_id = $1 OR community.owner_user_id = $1 OR EXISTS (
                    SELECT 1 FROM impacta.project_members AS membership
                    WHERE membership.project_id = project.id AND membership.user_id = $1))
             ORDER BY project.created_at DESC, project.id DESC
             LIMIT 100`,
            [userId]
        );
        return { items: result.rows };
    });

    server.get('/api/v1/profile/communities', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query(
            `SELECT community.id::text AS id, community.name, community.description,
                    area.name AS impact_area, owner.display_name AS moderator_name,
                    (community.owner_user_id = $1 OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    )) AS is_moderator,
                    (SELECT count(member.user_id)::int FROM impacta.community_members AS member
                     WHERE member.community_id = community.id AND member.status = 'active') AS member_count
             FROM impacta.communities AS community
             LEFT JOIN impacta.impact_areas AS area ON area.id = community.impact_area_id
             LEFT JOIN impacta.users AS owner ON owner.id = community.owner_user_id
             WHERE community.status = 'active'
               AND (community.owner_user_id = $1 OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS membership
                    WHERE membership.community_id = community.id AND membership.user_id = $1
                      AND membership.status = 'active'))
             ORDER BY community.name, community.id
             LIMIT 100`,
            [session.userId]
        );
        return { items: result.rows };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/profiles/:userId/communities', async (request, reply) => {
        const userId = request.params.userId;
        if (!validId(userId)) return reply.code(404).send({ error: 'profile_not_found' });
        const visible = await pool.query(
            `SELECT 1 FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             WHERE account.id = $1 AND account.status = 'active'`,
            [userId]
        );
        if (visible.rowCount === 0) return reply.code(404).send({ error: 'profile_not_found' });
        const result = await pool.query(
            `SELECT community.id::text AS id, community.name, community.description,
                    area.name AS impact_area, owner.display_name AS moderator_name,
                    (community.owner_user_id = $1 OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    )) AS is_moderator,
                    (SELECT count(member.user_id)::int FROM impacta.community_members AS member
                     WHERE member.community_id = community.id AND member.status = 'active') AS member_count
             FROM impacta.communities AS community
             JOIN impacta.users AS account ON account.id = $1 AND account.status = 'active'
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             LEFT JOIN impacta.impact_areas AS area ON area.id = community.impact_area_id
             LEFT JOIN impacta.users AS owner ON owner.id = community.owner_user_id
             WHERE community.status = 'active' AND community.visibility = 'public'
               AND (community.owner_user_id = $1 OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS membership
                    WHERE membership.community_id = community.id AND membership.user_id = $1
                      AND membership.status = 'active'))
             ORDER BY community.name, community.id
             LIMIT 100`,
            [userId]
        );
        return { items: result.rows };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/profiles/:userId', async (request, reply) => {
        const userId = request.params.userId;
        if (!validId(userId)) return reply.code(400).send({ error: 'invalid_user_id' });
        const result = await pool.query(
            `SELECT account.id::text AS id, account.display_name, account.created_at,
                    profile.headline, profile.bio, profile.location, profile.occupation,
                    profile.organization, profile.website_url, profile.skills,
                    profile.impact_area_id::text AS impact_area_id,
                    COALESCE(NULLIF(profile.custom_impact_area, ''), area.name) AS impact_area,
                    avatar.id::text AS avatar_id, cover.id::text AS cover_id,
                    COALESCE((
                        SELECT json_object_agg(document.document_type, json_build_object(
                            'url', '/api/v1/profiles/' || account.id::text || '/documents/' || document.document_type,
                            'byteSize', document.byte_size,
                            'updatedAt', document.updated_at
                        ))
                        FROM impacta.profile_documents AS document
                        WHERE document.user_id = account.id
                    ), '{}'::json) AS documents,
                    EXISTS (
                        SELECT 1 FROM impacta.user_roles AS assignment
                        JOIN impacta.roles AS role ON role.id = assignment.role_id
                        WHERE assignment.user_id = account.id
                          AND assignment.scope_type = 'platform' AND assignment.scope_id IS NULL
                          AND role.code = 'platform_admin'
                    ) AS is_platform_admin,
                    EXISTS (
                        SELECT 1 FROM impacta.account_verification_requests AS verification
                        WHERE verification.user_id = account.id AND verification.status = 'approved'
                          AND verification.proof_confirmed_at IS NOT NULL
                    ) AS is_identity_verified,
                    (SELECT count(*)::int FROM impacta.impactation_requests AS connection
                     WHERE connection.status = 'accepted'
                       AND (connection.requester_user_id = account.id OR connection.recipient_user_id = account.id))
                        AS impactation_count
             FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             LEFT JOIN impacta.impact_areas AS area ON area.id = profile.impact_area_id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
                 AND avatar.status = 'available' AND avatar.media_type = 'image'
             LEFT JOIN impacta.media AS cover ON cover.id = profile.cover_media_id
                 AND cover.status = 'available' AND cover.media_type = 'image'
             WHERE account.id = $1 AND account.status = 'active'`,
            [userId]
        );
        const profile = result.rows[0];
        if (!profile) return reply.code(404).send({ error: 'profile_not_found' });
        return {
            profile: {
                id: profile.id,
                displayName: profile.display_name,
                createdAt: profile.created_at,
                headline: profile.headline,
                bio: profile.bio,
                location: profile.location ?? '',
                occupation: profile.occupation,
                organization: profile.organization,
                websiteUrl: profile.website_url,
                skills: profile.skills,
                impactAreaId: profile.impact_area_id,
                impactArea: profile.impact_area,
                avatarUrl: avatarUrl(profile.avatar_id),
                coverUrl: avatarUrl(profile.cover_id),
                documents: profile.documents ?? {},
                isPlatformAdmin: profile.is_platform_admin === true,
                isIdentityVerified: profile.is_identity_verified === true,
                impactationCount: profile.impactation_count
            }
        };
    });

    server.get('/api/v1/profile/account-verification', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query<{
            id: string;
            category: string;
            evidence_url: string;
            request_note: string;
            status: string;
            review_reason: string | null;
            created_at: Date;
            reviewed_at: Date | null;
            proof_code: string | null;
            proof_expires_at: Date | null;
            can_renew_proof: boolean;
            has_confirmed_channel: boolean;
        }>(
            `SELECT id::text AS id, category, evidence_url, request_note, status,
                    review_reason, created_at, reviewed_at,
                    CASE WHEN proof_expires_at > now() THEN proof_code ELSE NULL END AS proof_code,
                    proof_expires_at,
                    (proof_code IS NULL OR proof_expires_at IS NULL OR proof_expires_at <= now()) AS can_renew_proof,
                    EXISTS (
                        SELECT 1 FROM impacta.account_verification_requests AS approved
                        WHERE approved.user_id = $1 AND approved.status = 'approved'
                          AND approved.proof_confirmed_at IS NOT NULL
                    ) AS has_confirmed_channel
             FROM impacta.account_verification_requests
             WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
            [session.userId]
        );
        const latest = result.rows[0];
        return {
            verified: latest?.has_confirmed_channel === true,
            latestRequest: latest ? {
                id: latest.id,
                category: latest.category,
                evidenceUrl: latest.evidence_url,
                note: latest.request_note,
                status: latest.status,
                reviewReason: latest.review_reason,
                createdAt: latest.created_at,
                reviewedAt: latest.reviewed_at,
                challengeCode: latest.status === 'pending' ? latest.proof_code : null,
                challengeExpiresAt: latest.proof_expires_at,
                canRenewChallenge: latest.status === 'pending' && latest.can_renew_proof
            } : null
        };
    });

    server.post('/api/v1/profile/account-verification', async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const body = request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return reply.code(400).send({ error: 'invalid_verification_request' });
        }
        const input = body as { category?: unknown; evidenceUrl?: unknown; note?: unknown };
        const category = input.category;
        const note = typeof input.note !== 'string' || !input.note.trim()
            ? 'Pedido enviado para confirmação do canal oficial.'
            : cleanText(input.note, 1500, false);
        if ((category !== 'public_figure' && category !== 'organization') || !note || note.length < 10) {
            return reply.code(400).send({ error: 'invalid_verification_request' });
        }
        if (typeof input.evidenceUrl !== 'string' || input.evidenceUrl.length > 2048 || input.evidenceUrl.includes('\u0000')) {
            return reply.code(400).send({ error: 'invalid_verification_request' });
        }
        let evidenceUrl: string;
        try {
            const parsed = new URL(input.evidenceUrl.trim());
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href.length > 2048) {
                throw new Error('invalid_url');
            }
            evidenceUrl = parsed.href;
        } catch {
            return reply.code(400).send({ error: 'invalid_verification_request' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtextextended('impacta:account-verification:' || $1::text, 0))",
                [session.userId]
            );
            const profile = await client.query<{ is_public: boolean }>(
                `SELECT profile.is_public FROM impacta.user_profiles AS profile
                 JOIN impacta.users AS account ON account.id = profile.user_id
                 WHERE account.id = $1 AND account.status = 'active' FOR UPDATE OF profile`,
                [session.userId]
            );
            if (profile.rows[0]?.is_public !== true) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'public_profile_required' });
            }
            const existing = await client.query<{ status: string; proof_confirmed_at: Date | null }>(
                `SELECT status, proof_confirmed_at FROM impacta.account_verification_requests
                 WHERE user_id = $1 AND status IN ('pending', 'approved')`,
                [session.userId]
            );
            if (existing.rows.some((item) => item.status === 'approved' && item.proof_confirmed_at !== null)) {
                await client.query('ROLLBACK');
                return reply.code(409).send({ error: 'account_already_verified' });
            }
            if (existing.rows.some((item) => item.status === 'pending')) {
                await client.query('ROLLBACK');
                return reply.code(409).send({ error: 'verification_request_pending' });
            }
            const attempts = await client.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM impacta.account_verification_requests
                 WHERE user_id = $1 AND created_at > now() - interval '30 days'`,
                [session.userId]
            );
            if ((attempts.rows[0]?.count ?? 0) >= 3) {
                await client.query('ROLLBACK');
                return reply.code(429).send({ error: 'verification_request_limit' });
            }
            const challengeCode = `IMPACTA-${randomBytes(12).toString('hex').toUpperCase()}`;
            const created = await client.query<{ id: string; proof_code: string; proof_expires_at: Date }>(
                `INSERT INTO impacta.account_verification_requests
                    (user_id, category, evidence_url, request_note, status, proof_code, proof_expires_at)
                 VALUES ($1, $2, $3, $4, 'pending', $5, now() + interval '30 days')
                 RETURNING id::text AS id, proof_code, proof_expires_at`,
                [session.userId, category, evidenceUrl, note, challengeCode]
            );
            await client.query('COMMIT');
            return reply.code(201).send({
                status: 'pending', requestId: created.rows[0]?.id,
                challengeCode: created.rows[0]?.proof_code,
                challengeExpiresAt: created.rows[0]?.proof_expires_at
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    });

    server.post<{ Params: { requestId: string } }>(
        '/api/v1/profile/account-verification/:requestId/challenge', async (request, reply) => {
            const session = await getSession(request, reply, pool, true);
            if (!session) return;
            const requestId = request.params.requestId;
            if (!validId(requestId)) return reply.code(400).send({ error: 'invalid_verification_request' });
            const challengeCode = `IMPACTA-${randomBytes(12).toString('hex').toUpperCase()}`;
            const renewed = await pool.query<{ proof_code: string; proof_expires_at: Date }>(
                `UPDATE impacta.account_verification_requests
                 SET proof_code = $3, proof_expires_at = now() + interval '30 days'
                 WHERE id = $1 AND user_id = $2 AND status = 'pending'
                   AND (proof_code IS NULL OR proof_expires_at IS NULL OR proof_expires_at <= now())
                 RETURNING proof_code, proof_expires_at`,
                [requestId, session.userId, challengeCode]
            );
            const challenge = renewed.rows[0];
            if (!challenge) return reply.code(409).send({ error: 'verification_challenge_not_renewable' });
            return {
                challengeCode: challenge.proof_code,
                challengeExpiresAt: challenge.proof_expires_at,
                canRenewChallenge: false
            };
        }
    );

    server.put<{ Body: ProfileInput }>('/api/v1/profile', async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const body = request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return reply.code(400).send({ error: 'invalid_profile' });
        }
        const input = body as ProfileInput;
        const displayName = cleanText(input.displayName, 80, false);
        const headline = cleanText(input.headline, 120);
        const bio = cleanText(input.bio, 600);
        const location = cleanText(input.location, 120);
        const occupation = cleanText(input.occupation, 120);
        const organization = cleanText(input.organization, 120);
        const rawWebsite = cleanText(input.websiteUrl, 2048);
        if (!displayName || headline === null || bio === null || location === null || occupation === null || organization === null || rawWebsite === null
            || typeof input.isPublic !== 'boolean') return reply.code(400).send({ error: 'invalid_profile' });

        let websiteUrl = rawWebsite;
        if (websiteUrl) {
            try {
                const parsed = new URL(websiteUrl);
                if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href.length > 2048) throw new Error('invalid_url');
                websiteUrl = parsed.href;
            } catch {
                return reply.code(400).send({ error: 'invalid_website_url' });
            }
        }

        if (!Array.isArray(input.skills) || input.skills.length > 12) return reply.code(400).send({ error: 'invalid_skills' });
        const skills: string[] = [];
        for (const value of input.skills) {
            const skill = cleanText(value, 40, false);
            if (!skill) return reply.code(400).send({ error: 'invalid_skills' });
            if (!skills.some((existing) => existing.toLocaleLowerCase('pt') === skill.toLocaleLowerCase('pt'))) skills.push(skill);
        }

        let impactAreaId: string | null = null;
        if (input.impactAreaId !== null && input.impactAreaId !== '') {
            if (typeof input.impactAreaId !== 'string' || !validId(input.impactAreaId)) return reply.code(400).send({ error: 'invalid_impact_area' });
            impactAreaId = input.impactAreaId;
        }
        const customImpactArea = input.customImpactArea === undefined || input.customImpactArea === null
            ? ''
            : cleanText(input.customImpactArea, 120);
        if (customImpactArea === null || (impactAreaId !== null && customImpactArea !== '')) {
            return reply.code(400).send({ error: 'invalid_impact_area' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (impactAreaId) {
                const area = await client.query(
                    'SELECT 1 FROM impacta.impact_areas WHERE id = $1 AND is_active', [impactAreaId]
                );
                if (area.rowCount === 0) {
                    await client.query('ROLLBACK');
                    return reply.code(400).send({ error: 'invalid_impact_area' });
                }
            }
            await client.query(
                'UPDATE impacta.users SET display_name = $2 WHERE id = $1 AND status = $3',
                [session.userId, displayName, 'active']
            );
            const updatedProfile = await client.query(
                `UPDATE impacta.user_profiles
                 SET headline = $2, bio = $3, location = NULLIF($4, ''), occupation = $5,
                     organization = $6, website_url = $7, skills = $8::text[],
                     impact_area_id = $9, custom_impact_area = $10, is_public = $11
                 WHERE user_id = $1`,
                [session.userId, headline, bio, location, occupation, organization, websiteUrl, skills, impactAreaId, customImpactArea, input.isPublic]
            );
            if (updatedProfile.rowCount !== 1) throw new Error('profile_not_found');
            await client.query('COMMIT');
            return { status: 'saved' };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    });

    server.post('/api/v1/profile/avatar', {
        bodyLimit: MAX_AVATAR_BYTES,
        onRequest: async (request, reply) => {
            // Reject anonymous uploads before Fastify buffers the request body.
            if (!await getSession(request, reply, pool, true)) return reply;
        }
    }, async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return reply.code(415).send({ error: 'unsupported_avatar_type' });
        if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > MAX_AVATAR_BYTES) {
            return reply.code(413).send({ error: 'avatar_too_large' });
        }
        const bytes = request.body;
        if (!validDimensions(imageDimensions(bytes, mimeType))) return reply.code(400).send({ error: 'invalid_avatar_image' });
        let storedBytes: Buffer;
        try {
            storedBytes = await optimizeProfileAvatar(bytes);
        } catch (error) {
            if (error instanceof MediaProcessingError) return reply.code(error.statusCode).send({ error: error.code });
            throw error;
        }

        const storageKey = `${randomUUID()}.webp`;
        const path = safeStoragePath(storageKey);
        if (!path) return reply.code(500).send({ error: 'avatar_storage_unavailable' });
        await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
        await writeFile(path, storedBytes, { flag: 'wx', mode: 0o600 });

        const client = await pool.connect();
        let previousStorageKey: string | null = null;
        let newAvatarId: string | null = null;
        try {
            await client.query('BEGIN');
            const old = await client.query<{ id: string; storage_key: string }>(
                `SELECT media.id::text AS id, media.storage_key
                 FROM impacta.user_profiles AS profile
                 JOIN impacta.media AS media ON media.id = profile.avatar_media_id
                 WHERE profile.user_id = $1 FOR UPDATE OF profile`,
                [session.userId]
            );
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO impacta.media
                    (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                 VALUES ($1, $2, 'image', 'image/webp', $3, $4, 'available')
                 RETURNING id::text AS id`,
                [session.userId, storageKey, storedBytes.length, createHash('sha256').update(storedBytes).digest('hex')]
            );
            newAvatarId = inserted.rows[0]?.id ?? null;
            if (!newAvatarId) throw new Error('avatar_store_failed');
            const updatedProfile = await client.query(
                'UPDATE impacta.user_profiles SET avatar_media_id = $2 WHERE user_id = $1',
                [session.userId, newAvatarId]
            );
            if (updatedProfile.rowCount !== 1) throw new Error('profile_not_found');
            if (old.rows[0]) {
                previousStorageKey = old.rows[0].storage_key;
                await client.query("UPDATE impacta.media SET status = 'deleted' WHERE id = $1", [old.rows[0].id]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            await unlink(path).catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
        if (previousStorageKey) {
            const previousPath = safeStoragePath(previousStorageKey);
            if (previousPath) await unlink(previousPath).catch(() => undefined);
        }
        return reply.code(201).send({ avatarUrl: avatarUrl(newAvatarId) });
    });

    server.delete('/api/v1/profile/avatar', async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const client = await pool.connect();
        let oldStorageKey: string | null = null;
        try {
            await client.query('BEGIN');
            const old = await client.query<{ id: string; storage_key: string }>(
                `SELECT media.id::text AS id, media.storage_key
                 FROM impacta.user_profiles AS profile
                 JOIN impacta.media AS media ON media.id = profile.avatar_media_id
                 WHERE profile.user_id = $1 FOR UPDATE OF profile`,
                [session.userId]
            );
            if (old.rows[0]) {
                oldStorageKey = old.rows[0].storage_key;
                await client.query('UPDATE impacta.user_profiles SET avatar_media_id = NULL WHERE user_id = $1', [session.userId]);
                await client.query("UPDATE impacta.media SET status = 'deleted' WHERE id = $1", [old.rows[0].id]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
        if (oldStorageKey) {
            const path = safeStoragePath(oldStorageKey);
            if (path) await unlink(path).catch(() => undefined);
        }
        return { status: 'removed' };
    });

    server.post('/api/v1/profile/cover', {
        bodyLimit: MAX_COVER_BYTES,
        onRequest: async (request, reply) => {
            if (!await getSession(request, reply, pool, true)) return reply;
        }
    }, async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return reply.code(415).send({ error: 'unsupported_cover_type' });
        if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > MAX_COVER_BYTES) {
            return reply.code(413).send({ error: 'cover_image_too_large' });
        }
        const bytes = request.body;
        if (!validCoverDimensions(imageDimensions(bytes, mimeType))) return reply.code(400).send({ error: 'invalid_cover_image' });
        let storedBytes: Buffer;
        try {
            storedBytes = await optimizeProfileCover(bytes);
        } catch (error) {
            if (error instanceof MediaProcessingError) return reply.code(error.statusCode).send({ error: error.code });
            throw error;
        }

        const storageKey = `${randomUUID()}.webp`;
        const path = safeStoragePath(storageKey);
        if (!path) return reply.code(500).send({ error: 'cover_storage_unavailable' });
        await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
        await writeFile(path, storedBytes, { flag: 'wx', mode: 0o600 });

        const client = await pool.connect();
        let previousStorageKey: string | null = null;
        let newCoverId: string | null = null;
        try {
            await client.query('BEGIN');
            const old = await client.query<{ id: string; storage_key: string }>(
                `SELECT media.id::text AS id, media.storage_key
                 FROM impacta.user_profiles AS profile
                 JOIN impacta.media AS media ON media.id = profile.cover_media_id
                 WHERE profile.user_id = $1 FOR UPDATE OF profile`,
                [session.userId]
            );
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO impacta.media
                    (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                 VALUES ($1, $2, 'image', 'image/webp', $3, $4, 'available')
                 RETURNING id::text AS id`,
                [session.userId, storageKey, storedBytes.length, createHash('sha256').update(storedBytes).digest('hex')]
            );
            newCoverId = inserted.rows[0]?.id ?? null;
            if (!newCoverId) throw new Error('cover_store_failed');
            const updatedProfile = await client.query(
                'UPDATE impacta.user_profiles SET cover_media_id = $2 WHERE user_id = $1',
                [session.userId, newCoverId]
            );
            if (updatedProfile.rowCount !== 1) throw new Error('profile_not_found');
            if (old.rows[0]) {
                previousStorageKey = old.rows[0].storage_key;
                await client.query("UPDATE impacta.media SET status = 'deleted' WHERE id = $1", [old.rows[0].id]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            await unlink(path).catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
        if (previousStorageKey) {
            const previousPath = safeStoragePath(previousStorageKey);
            if (previousPath) await unlink(previousPath).catch(() => undefined);
        }
        return reply.code(201).send({ coverUrl: avatarUrl(newCoverId) });
    });

    server.delete('/api/v1/profile/cover', async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const client = await pool.connect();
        let oldStorageKey: string | null = null;
        try {
            await client.query('BEGIN');
            const old = await client.query<{ id: string; storage_key: string }>(
                `SELECT media.id::text AS id, media.storage_key
                 FROM impacta.user_profiles AS profile
                 JOIN impacta.media AS media ON media.id = profile.cover_media_id
                 WHERE profile.user_id = $1 FOR UPDATE OF profile`,
                [session.userId]
            );
            if (old.rows[0]) {
                oldStorageKey = old.rows[0].storage_key;
                await client.query('UPDATE impacta.user_profiles SET cover_media_id = NULL WHERE user_id = $1', [session.userId]);
                await client.query("UPDATE impacta.media SET status = 'deleted' WHERE id = $1", [old.rows[0].id]);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
        if (oldStorageKey) {
            const path = safeStoragePath(oldStorageKey);
            if (path) await unlink(path).catch(() => undefined);
        }
        return { status: 'removed' };
    });

    server.post<{ Params: { documentType: string } }>(
        '/api/v1/profile/documents/:documentType',
        {
            bodyLimit: MAX_PROFILE_DOCUMENT_BYTES,
            onRequest: async (request, reply) => {
                if (!await getSession(request, reply, pool, true)) return reply;
            }
        },
        async (request, reply) => {
            const session = await getSession(request, reply, pool, true);
            if (!session) return;
            const documentType = request.params.documentType;
            if (!validProfileDocumentType(documentType)) return reply.code(400).send({ error: 'invalid_profile_document_type' });
            const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
            if (mimeType !== 'application/pdf') return reply.code(415).send({ error: 'unsupported_profile_document_type' });
            if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
                return reply.code(400).send({ error: 'invalid_profile_document' });
            }
            if (request.body.length > MAX_PROFILE_DOCUMENT_BYTES) {
                return reply.code(413).send({ error: 'profile_document_too_large' });
            }
            if (request.body.length < 5 || request.body.subarray(0, 5).toString('ascii') !== '%PDF-') {
                return reply.code(400).send({ error: 'invalid_profile_document' });
            }

            const storageKey = `profile-documents/${randomUUID()}.pdf`;
            const path = safeStoragePath(storageKey);
            if (!path) return reply.code(500).send({ error: 'profile_document_storage_unavailable' });
            try {
                await mkdir(resolve(storageDirectory, 'profile-documents'), { recursive: true, mode: 0o700 });
                await writeFile(path, request.body, { flag: 'wx', mode: 0o600 });
            } catch (error) {
                const code = typeof error === 'object' && error !== null && 'code' in error
                    ? String(error.code)
                    : 'unknown';
                request.log.error({ event: 'profile_document_storage_failed', requestId: request.id, code }, 'Profile document storage failed');
                return reply.code(503).send({ error: 'profile_document_storage_unavailable', requestId: request.id });
            }

            const client = await pool.connect();
            let previousStorageKey: string | null = null;
            let document: { byte_size: number; updated_at: string } | null = null;
            try {
                await client.query('BEGIN');
                const old = await client.query<{ storage_key: string }>(
                    `SELECT storage_key FROM impacta.profile_documents
                     WHERE user_id = $1 AND document_type = $2 FOR UPDATE`,
                    [session.userId, documentType]
                );
                previousStorageKey = old.rows[0]?.storage_key ?? null;
                const stored = await client.query<{ byte_size: number; updated_at: string }>(
                    `INSERT INTO impacta.profile_documents (user_id, document_type, storage_key, byte_size)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (user_id, document_type) DO UPDATE
                     SET storage_key = EXCLUDED.storage_key, byte_size = EXCLUDED.byte_size, updated_at = now()
                     RETURNING byte_size, updated_at`,
                    [session.userId, documentType, storageKey, request.body.length]
                );
                document = stored.rows[0] ?? null;
                if (!document) throw new Error('profile_document_store_failed');
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                await unlink(path).catch(() => undefined);
                const code = typeof error === 'object' && error !== null && 'code' in error
                    ? String(error.code)
                    : 'unknown';
                if (code === '42P01' || code === '42501') {
                    request.log.error({ event: 'profile_document_database_not_ready', requestId: request.id, code }, 'Profile document storage is not ready');
                    return reply.code(503).send({ error: 'profile_documents_not_ready', requestId: request.id });
                }
                throw error;
            } finally {
                client.release();
            }
            if (previousStorageKey) {
                const previousPath = safeStoragePath(previousStorageKey);
                if (previousPath) await unlink(previousPath).catch(() => undefined);
            }
            return reply.code(201).send({
                document: {
                    type: documentType,
                    url: `/api/v1/profiles/${encodeURIComponent(session.userId)}/documents/${documentType}`,
                    byteSize: document.byte_size,
                    updatedAt: document.updated_at
                }
            });
        }
    );

    server.delete<{ Params: { documentType: string } }>('/api/v1/profile/documents/:documentType', async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const documentType = request.params.documentType;
        if (!validProfileDocumentType(documentType)) return reply.code(400).send({ error: 'invalid_profile_document_type' });
        const client = await pool.connect();
        let oldStorageKey: string | null = null;
        try {
            await client.query('BEGIN');
            const removed = await client.query<{ storage_key: string }>(
                `DELETE FROM impacta.profile_documents
                 WHERE user_id = $1 AND document_type = $2
                 RETURNING storage_key`,
                [session.userId, documentType]
            );
            oldStorageKey = removed.rows[0]?.storage_key ?? null;
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
        if (oldStorageKey) {
            const path = safeStoragePath(oldStorageKey);
            if (path) await unlink(path).catch(() => undefined);
        }
        return { status: 'removed' };
    });

    server.get<{ Params: { userId: string; documentType: string } }>(
        '/api/v1/profiles/:userId/documents/:documentType',
        async (request, reply) => {
            const { userId, documentType } = request.params;
            if (!validId(userId) || !validProfileDocumentType(documentType)) {
                return reply.code(404).send({ error: 'profile_document_not_found' });
            }
            const result = await pool.query<{
                storage_key: string; byte_size: number; is_public: boolean; user_id: string;
            }>(
                `SELECT document.storage_key, document.byte_size, profile.is_public,
                        account.id::text AS user_id
                 FROM impacta.profile_documents AS document
                 JOIN impacta.user_profiles AS profile ON profile.user_id = document.user_id
                 JOIN impacta.users AS account ON account.id = document.user_id AND account.status = 'active'
                 WHERE document.user_id = $1 AND document.document_type = $2
                 LIMIT 1`,
                [userId, documentType]
            );
            const document = result.rows[0];
            if (!document) return reply.code(404).send({ error: 'profile_document_not_found' });
            if (!document.is_public) {
                if (!readCookie(request.headers.cookie, 'impacta_session')) {
                    return reply.code(404).send({ error: 'profile_document_not_found' });
                }
                const session = await getSession(request, reply, pool, false);
                if (!session) return;
                if (session.userId !== document.user_id) return reply.code(404).send({ error: 'profile_document_not_found' });
            }
            const path = safeStoragePath(document.storage_key);
            if (!path) return reply.code(404).send({ error: 'profile_document_not_found' });
            try {
                const file = await stat(path);
                const fileName = documentType === 'cv' ? 'curriculo.pdf' : 'portfolio.pdf';
                return reply
                    .type('application/pdf')
                    .header('content-disposition', `attachment; filename="${fileName}"`)
                    .header('content-length', String(file.size))
                    .header('cache-control', 'private, no-store')
                    .send(createReadStream(path));
            } catch {
                return reply.code(404).send({ error: 'profile_document_not_found' });
            }
        }
    );

    server.get<{ Params: { mediaId: string } }>('/api/v1/media/:mediaId', async (request, reply) => {
        const mediaId = request.params.mediaId;
        if (!validId(mediaId)) return reply.code(404).send({ error: 'media_not_found' });
        const result = await pool.query<{
            storage_key: string; mime_type: string; media_type: string;
            avatar_is_public: boolean | null; avatar_owner_user_id: string | null;
            cover_is_public: boolean | null; cover_owner_user_id: string | null;
            is_public_post_media: boolean; is_public_promotion_media: boolean;
        }>(
            `SELECT media.storage_key, media.mime_type, media.media_type,
                    CASE WHEN avatar_owner.id IS NOT NULL THEN avatar_profile.is_public END AS avatar_is_public,
                    CASE WHEN avatar_owner.id IS NOT NULL THEN avatar_profile.user_id::text END AS avatar_owner_user_id,
                    CASE WHEN cover_owner.id IS NOT NULL THEN cover_profile.is_public END AS cover_is_public,
                    CASE WHEN cover_owner.id IS NOT NULL THEN cover_profile.user_id::text END AS cover_owner_user_id,
                    EXISTS (
                        SELECT 1
                        FROM impacta.post_media AS relation
                        JOIN impacta.posts AS post ON post.id = relation.post_id
                        LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                        LEFT JOIN impacta.projects AS project ON project.id = post.project_id
                        LEFT JOIN impacta.communities AS project_community ON project_community.id = project.community_id
                        LEFT JOIN impacta.users AS post_author ON post_author.id = post.author_user_id
                        WHERE relation.media_id = media.id
                          AND post.status = 'published' AND post.moderation_status = 'approved' AND post.deleted_at IS NULL
                          AND (post.author_user_id IS NULL OR post_author.status = 'active')
                          AND (post.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                          AND (post.project_id IS NULL OR
                               (project.status IN ('active', 'completed') AND
                                (project.community_id IS NULL OR
                                 (project_community.status = 'active' AND project_community.visibility = 'public'))))
                    ) AS is_public_post_media,
                    (
                        EXISTS (
                            SELECT 1 FROM impacta.announcements AS announcement
                            WHERE announcement.image_media_id = media.id
                              AND announcement.status IN ('published', 'scheduled')
                              AND (announcement.publish_at IS NULL OR announcement.publish_at <= now())
                              AND (announcement.expires_at IS NULL OR announcement.expires_at > now())
                              AND announcement.audience->>'type' = 'all'
                        ) OR EXISTS (
                            SELECT 1 FROM impacta.platform_settings AS setting
                            WHERE setting.key = 'homepage.notice.image'
                              AND setting.value #>> '{}' = media.id::text
                              AND EXISTS (
                                  SELECT 1 FROM impacta.platform_settings AS notice
                                  WHERE notice.key = 'homepage.notice'
                                    AND length(btrim(notice.value #>> '{}')) > 0
                              )
                        )
                    ) AS is_public_promotion_media
             FROM impacta.media AS media
             LEFT JOIN impacta.user_profiles AS avatar_profile ON avatar_profile.avatar_media_id = media.id
             LEFT JOIN impacta.users AS avatar_owner ON avatar_owner.id = avatar_profile.user_id AND avatar_owner.status = 'active'
             LEFT JOIN impacta.user_profiles AS cover_profile ON cover_profile.cover_media_id = media.id
             LEFT JOIN impacta.users AS cover_owner ON cover_owner.id = cover_profile.user_id AND cover_owner.status = 'active'
             WHERE media.id = $1 AND media.status = 'available'
               AND (avatar_owner.id IS NOT NULL OR cover_owner.id IS NOT NULL OR EXISTS (
                   SELECT 1 FROM impacta.post_media AS relation
                   JOIN impacta.posts AS post ON post.id = relation.post_id
                   LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                   LEFT JOIN impacta.projects AS project ON project.id = post.project_id
                   LEFT JOIN impacta.communities AS project_community ON project_community.id = project.community_id
                   LEFT JOIN impacta.users AS post_author ON post_author.id = post.author_user_id
                   WHERE relation.media_id = media.id AND post.status = 'published'
                     AND post.moderation_status = 'approved' AND post.deleted_at IS NULL
                     AND (post.author_user_id IS NULL OR post_author.status = 'active')
                     AND (post.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                     AND (post.project_id IS NULL OR
                          (project.status IN ('active', 'completed') AND
                           (project.community_id IS NULL OR
                            (project_community.status = 'active' AND project_community.visibility = 'public'))))
               ) OR EXISTS (
                   SELECT 1 FROM impacta.announcements AS announcement
                   WHERE announcement.image_media_id = media.id
                     AND announcement.status IN ('published', 'scheduled')
                     AND (announcement.publish_at IS NULL OR announcement.publish_at <= now())
                     AND (announcement.expires_at IS NULL OR announcement.expires_at > now())
                     AND announcement.audience->>'type' = 'all'
               ) OR EXISTS (
                   SELECT 1 FROM impacta.platform_settings AS setting
                   WHERE setting.key = 'homepage.notice.image'
                     AND setting.value #>> '{}' = media.id::text
                     AND EXISTS (
                         SELECT 1 FROM impacta.platform_settings AS notice
                         WHERE notice.key = 'homepage.notice'
                           AND length(btrim(notice.value #>> '{}')) > 0
                     )
               ))
             LIMIT 1`,
            [mediaId]
        );
        const media = result.rows[0];
        if (!media) return reply.code(404).send({ error: 'media_not_found' });
        const privateMediaOwner = media.avatar_owner_user_id && !media.avatar_is_public
            ? media.avatar_owner_user_id
            : media.cover_owner_user_id && !media.cover_is_public
                ? media.cover_owner_user_id
                : null;
        if (privateMediaOwner
            && !media.is_public_post_media && !media.is_public_promotion_media) {
            const session = await getSession(request, reply, pool, false);
            if (!session) {
                if (reply.sent) return;
                return reply.code(404).send({ error: 'media_not_found' });
            }
            if (session.userId !== privateMediaOwner) return reply.code(404).send({ error: 'media_not_found' });
        }
        const path = safeStoragePath(media.storage_key);
        if (!path) return reply.code(404).send({ error: 'media_not_found' });
        try {
            if (media.media_type === 'video') {
                const file = await stat(path);
                const range = request.headers.range;
                if (range) {
                    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                    if (!match || (!match[1] && !match[2])) {
                        return reply.code(416).header('content-range', `bytes */${file.size}`).send();
                    }
                    let start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
                    let end = match[2] && match[1] ? Number(match[2]) : file.size - 1;
                    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= file.size || end < start) {
                        return reply.code(416).header('content-range', `bytes */${file.size}`).send();
                    }
                    end = Math.min(end, file.size - 1);
                    return reply.code(206)
                        .type(media.mime_type)
                        .header('accept-ranges', 'bytes')
                        .header('content-range', `bytes ${start}-${end}/${file.size}`)
                        .header('content-length', String(end - start + 1))
                        .header('cache-control', 'private, no-store')
                        .send(createReadStream(path, { start, end }));
                }
                return reply.type(media.mime_type)
                    .header('accept-ranges', 'bytes')
                    .header('content-length', String(file.size))
                    .header('cache-control', 'private, no-store')
                    .send(createReadStream(path));
            }
            const bytes = await readFile(path);
            return reply.type(media.mime_type).header('cache-control', 'private, no-store').send(bytes);
        } catch {
            return reply.code(404).send({ error: 'media_not_found' });
        }
    });
}

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { findFeedPolicyViolation } from './community-content-policy.js';
import {
    MAX_POST_IMAGE_BYTES,
    MAX_POST_VIDEO_BYTES,
    COMMUNITY_CHAT_MEDIA_DIRECTORY,
    MediaProcessingError,
    acquireVideoProcessingSlot,
    POST_MEDIA_DIRECTORY,
    communityChatMediaStoragePath,
    optimizePostImage,
    optimizePostVideo,
    postMediaStoragePath,
    type ProcessedPostMedia
} from './media-processing.js';

interface SessionRecord {
    user_id: string;
    display_name: string;
    csrf_token_hash: string | null;
    mfa_verified_at: Date | null;
}

export interface AuthenticatedSession {
    userId: string;
    displayName: string;
    csrfTokenHash: string | null;
    mfaVerified: boolean;
}

const videoProcessingSlots = new WeakMap<FastifyRequest, () => void>();

function releaseVideoProcessingSlotForRequest(request: FastifyRequest): void {
    const release = videoProcessingSlots.get(request);
    if (!release) return;
    videoProcessingSlots.delete(request);
    release();
}

const POST_CATEGORY_CODE = /^[a-z][a-z0-9_]{0,39}$/;
const PROJECT_ACTIVITY_NOTIFICATION_TYPES = [
    'project_member_joined', 'project_challenge_created', 'project_challenge_submission',
    'project_challenge_participation_reviewed'
];

function readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function tokenHash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

function validId(id: string): boolean {
    if (!/^[1-9]\d{0,18}$/.test(id)) return false;
    try {
        return BigInt(id) <= 9223372036854775807n;
    } catch {
        return false;
    }
}

function resourceOffset(value: string | undefined): number | null {
    const raw = value ?? '0';
    if (!/^(0|[1-9]\d{0,6})$/.test(raw)) return null;
    const offset = Number(raw);
    return Number.isSafeInteger(offset) && offset <= 500_000 ? offset : null;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.trim();
    const length = Array.from(cleaned).length;
    if (!cleaned || length > maxLength || cleaned.includes('\u0000')) return undefined;
    return cleaned;
}

function cleanLocation(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return undefined;
    const location = value.trim().replace(/\s+/g, ' ');
    if (!location || Array.from(location).length > 100 || location.includes('\u0000')) return undefined;
    return location;
}

function cleanLocationFilter(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return undefined;
    const location = value.trim().replace(/\s+/g, ' ');
    if (Array.from(location).length > 100 || location.includes('\u0000')) return undefined;
    return location || null;
}

interface MentionTarget { id: string; display_name: string; is_public: boolean }

function mentionIdsInput(value: unknown): string[] | null {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 10
        || value.some((id) => typeof id !== 'string' || !validId(id))
        || new Set(value).size !== value.length) return null;
    return value as string[];
}

function bodyContainsMention(body: string, displayName: string): boolean {
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(body);
}

async function resolveMentionTargets(
    client: PoolClient,
    ids: string[],
    body: string,
    actorId: string
): Promise<MentionTarget[] | null> {
    if (!ids.length) return [];
    const result = await client.query<MentionTarget>(
        `SELECT account.id::text AS id, account.display_name, profile.is_public
         FROM impacta.users AS account
         JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
         WHERE account.id = ANY($1::bigint[]) AND account.status = 'active'
           AND profile.is_public AND account.id <> $2::bigint`,
        [ids, actorId]
    );
    if (result.rows.length !== ids.length) return null;
    const byId = new Map(result.rows.map((target) => [target.id, target]));
    const ordered = ids.map((id) => byId.get(id)).filter((target): target is MentionTarget => Boolean(target));
    const uniqueNames = new Set(ordered.map((target) => target.display_name.toLocaleLowerCase('pt')));
    return ordered.length === ids.length && uniqueNames.size === ids.length
        && ordered.every((target) => bodyContainsMention(body, target.display_name))
        ? ordered
        : null;
}

async function saveMentions(
    client: PoolClient,
    actorId: string,
    targetId: string,
    targetType: 'post' | 'comment',
    targets: MentionTarget[],
    notify: boolean,
    body: string,
    relatedPostId?: string
): Promise<void> {
    if (!targets.length) return;
    const targetColumn = targetType === 'post' ? 'post_id' : 'comment_id';
    await client.query(
        `INSERT INTO impacta.content_mentions (actor_user_id, mentioned_user_id, ${targetColumn})
         SELECT $1, mention.user_id, $2
         FROM unnest($3::bigint[]) AS mention(user_id)
         ON CONFLICT DO NOTHING`,
        [actorId, targetId, targets.map((target) => target.id)]
    );
    if (!notify) return;
    const excerpt = Array.from(body).slice(0, 180).join('');
    await client.query(
        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
         SELECT mention.user_id, $4,
                jsonb_build_object('actor_user_id', $1::text, 'post_id', $2::text,
                                   'comment_id', $3::text, 'excerpt', $5::text)
         FROM unnest($6::bigint[]) AS mention(user_id)
         WHERE mention.user_id <> $1::bigint`,
        [actorId, targetType === 'post' ? targetId : relatedPostId ?? null,
            targetType === 'comment' ? targetId : null,
            targetType === 'post' ? 'post_mention' : 'comment_mention', excerpt,
            targets.map((target) => target.id)]
    );
}

function mentionJsonSql(targetAlias: 'post' | 'comment'): string {
    const foreignKey = targetAlias === 'post' ? 'post_id' : 'comment_id';
    return `COALESCE((
        SELECT json_agg(json_build_object(
            'user_id', mention.mentioned_user_id::text,
            'display_name', mentioned.display_name,
            'is_public', mentioned_profile.is_public
        ) ORDER BY mentioned.display_name)
        FROM impacta.content_mentions AS mention
        JOIN impacta.users AS mentioned ON mentioned.id = mention.mentioned_user_id AND mentioned.status = 'active'
        JOIN impacta.user_profiles AS mentioned_profile
          ON mentioned_profile.user_id = mentioned.id AND mentioned_profile.is_public
        WHERE mention.${foreignKey} = ${targetAlias}.id
    ), '[]'::json) AS mentions`;
}

function cleanDate(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

function optionalLocation(value: unknown, maxLength: number): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return undefined;
    const cleaned = value.trim();
    if (!cleaned) return null;
    if (Array.from(cleaned).length > maxLength || cleaned.includes('\u0000')) return undefined;
    return cleaned;
}

function communitySlug(name: string): string {
    const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'comunidade';
    return `${base}-${randomUUID().slice(0, 8)}`;
}

async function findSession(request: FastifyRequest, pool: Pool, includeCsrf: boolean): Promise<AuthenticatedSession | null> {
    const token = readCookie(request.headers.cookie, 'impacta_session');
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;

    const csrfSelect = includeCsrf ? 'auth_session.csrf_token_hash' : 'NULL::text AS csrf_token_hash';
    let sessionRows: SessionRecord[];
    try {
        const result = await pool.query<SessionRecord>(
            `UPDATE impacta.auth_sessions AS auth_session
         SET last_seen_at = now(),
             idle_expires_at = LEAST(auth_session.absolute_expires_at, now() + interval '30 minutes')
         FROM impacta.users AS account
         WHERE auth_session.user_id = account.id
           AND auth_session.token_hash = $1
           AND auth_session.revoked_at IS NULL
           AND auth_session.idle_expires_at > now()
           AND auth_session.absolute_expires_at > now()
           AND account.status = 'active'
           AND (NOT account.mfa_required OR auth_session.mfa_verified_at IS NOT NULL)
         RETURNING auth_session.user_id::text AS user_id,
                   account.display_name,
                   auth_session.mfa_verified_at,
                       ${csrfSelect}`,
            [tokenHash(token)]
        );
        sessionRows = result.rows;
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        if (includeCsrf || code !== '42501') throw error;
        const result = await pool.query<SessionRecord>(
            `SELECT auth_session.user_id::text AS user_id,
                    account.display_name,
                    auth_session.mfa_verified_at,
                    NULL::text AS csrf_token_hash
             FROM impacta.auth_sessions AS auth_session
             JOIN impacta.users AS account ON account.id = auth_session.user_id
             WHERE auth_session.token_hash = $1
               AND auth_session.revoked_at IS NULL
               AND auth_session.idle_expires_at > now()
               AND auth_session.absolute_expires_at > now()
               AND account.status = 'active'
                       AND (NOT account.mfa_required OR auth_session.mfa_verified_at IS NOT NULL)
             LIMIT 1`,
            [tokenHash(token)]
        );
        sessionRows = result.rows;
    }
    const row = sessionRows[0];
    return row
        ? {
            userId: row.user_id,
            displayName: row.display_name,
            csrfTokenHash: row.csrf_token_hash,
            mfaVerified: row.mfa_verified_at !== null
        }
        : null;
}

export async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    requireCsrf: boolean
): Promise<AuthenticatedSession | null> {
    const session = await findSession(request, pool, requireCsrf);
    if (!session) {
        await reply.code(401).send({ error: 'authentication_required' });
        return null;
    }
    if (!requireCsrf) return session;

    const cookieToken = readCookie(request.headers.cookie, 'impacta_csrf');
    const headerToken = request.headers['x-csrf-token'];
    if (typeof headerToken !== 'string' || !cookieToken
        || !/^[a-f0-9]{64}$/i.test(cookieToken)
        || !/^[a-f0-9]{64}$/i.test(headerToken)) {
        await reply.code(403).send({ error: 'csrf_validation_failed' });
        return null;
    }

    const cookieBytes = Buffer.from(cookieToken, 'utf8');
    const headerBytes = Buffer.from(headerToken, 'utf8');
    const storedHash = session.csrfTokenHash;
    const storedBytes = storedHash && /^[a-f0-9]{64}$/i.test(storedHash)
        ? Buffer.from(storedHash, 'hex')
        : Buffer.alloc(0);
    const expectedHash = Buffer.from(tokenHash(cookieToken), 'hex');
    const headerMatchesCookie = cookieBytes.length === headerBytes.length
        && timingSafeEqual(cookieBytes, headerBytes);
    const cookieMatchesSession = storedBytes.length === expectedHash.length
        && timingSafeEqual(storedBytes, expectedHash);
    if (!headerMatchesCookie || !cookieMatchesSession) {
        await reply.code(403).send({ error: 'csrf_validation_failed' });
        return null;
    }
    return session;
}

export async function requireMfaSession(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    requireCsrf: boolean
): Promise<AuthenticatedSession | null> {
    const session = await requireSession(request, reply, pool, requireCsrf);
    if (!session) return null;
    if (!session.mfaVerified) {
        await reply.code(403).send({ error: 'mfa_required' });
        return null;
    }
    return session;
}

async function beginLimitedWrite(
    client: PoolClient,
    userId: string,
    action: 'post' | 'comment' | 'challenge' | 'challenge_create' | 'challenge_review' | 'resource' | 'project_edit' | 'report' | 'media' | 'community_media' | 'community_message' | 'community_join' | 'community_report' | 'share',
    limit: number
): Promise<boolean> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('impacta:write:' || $1 || ':' || $2, 0))",
        [userId, action]
    );
    const queries = {
        post: 'SELECT count(*)::int AS count FROM impacta.posts WHERE author_user_id = $1 AND created_at > now() - interval \'1 hour\'',
        comment: 'SELECT count(*)::int AS count FROM impacta.comments WHERE author_user_id = $1 AND created_at > now() - interval \'1 hour\'',
        challenge: 'SELECT count(*)::int AS count FROM impacta.challenge_participations WHERE user_id = $1 AND submitted_at > now() - interval \'1 hour\'',
        challenge_create: 'SELECT count(*)::int AS count FROM impacta.challenges WHERE created_by_user_id = $1 AND created_at > now() - interval \'1 hour\'',
        challenge_review: 'SELECT count(*)::int AS count FROM impacta.challenge_participations WHERE reviewed_by_user_id = $1 AND reviewed_at > now() - interval \'1 hour\'',
        resource: `SELECT (
            (SELECT count(*) FROM impacta.projects WHERE owner_user_id = $1 AND created_at > now() - interval '1 hour') +
            (SELECT count(*) FROM impacta.communities WHERE owner_user_id = $1 AND created_at > now() - interval '1 hour')
        )::int AS count`,
        project_edit: "SELECT count(*)::int AS count FROM impacta.projects WHERE owner_user_id = $1 AND updated_at > now() - interval '1 hour'",
        report: 'SELECT count(*)::int AS count FROM impacta.content_reports WHERE reporter_user_id = $1 AND created_at > now() - interval \'1 hour\'',
        media: 'SELECT count(*)::int AS count FROM impacta.media WHERE owner_user_id = $1 AND storage_key LIKE \'posts/%\' AND status <> \'deleted\' AND created_at > now() - interval \'1 hour\'',
        community_media: 'SELECT count(*)::int AS count FROM impacta.media WHERE owner_user_id = $1 AND storage_key LIKE \'community-chat/%\' AND status <> \'deleted\' AND created_at > now() - interval \'1 hour\'',
        community_message: `SELECT count(*)::int AS count FROM impacta.community_messages
                            WHERE (author_user_id = $1 AND created_at > now() - interval '1 hour')
                               OR (edited_by_user_id = $1 AND edited_at > now() - interval '1 hour')
                               OR (deleted_by_user_id = $1 AND deleted_at > now() - interval '1 hour')`,
        community_join: `SELECT count(*)::int AS count FROM impacta.community_members
                         WHERE user_id = $1 AND status IN ('pending', 'removed')
                           AND joined_at > now() - interval '1 hour'`,
        community_report: `SELECT count(*)::int AS count FROM impacta.community_reports
                           WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'`,
        share: 'SELECT count(*)::int AS count FROM impacta.post_shares WHERE sharer_user_id = $1 AND shared_at > now() - interval \'1 hour\''
    };
    const result = await client.query<{ count: number }>(queries[action], [userId]);
    return result.rows[0]?.count < limit;
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const value = await action(client);
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function cleanupOrphanPostMedia(pool: Pool, server: FastifyInstance): Promise<void> {
    const expired = await pool.query<{ storage_key: string }>(
        `UPDATE impacta.media AS media SET status = 'deleted'
         WHERE media.storage_key LIKE ANY(ARRAY['posts/%', 'community-chat/%']) AND media.status IN ('available', 'pending_scan')
           AND media.created_at < now() - interval '24 hours'
           AND NOT EXISTS (SELECT 1 FROM impacta.post_media AS relation WHERE relation.media_id = media.id)
           AND NOT EXISTS (SELECT 1 FROM impacta.community_messages AS message WHERE message.media_id = media.id)
         RETURNING media.storage_key`
    );
    await Promise.all(expired.rows.map(async (item) => {
        const path = item.storage_key.startsWith('community-chat/')
            ? communityChatMediaStoragePath(item.storage_key)
            : postMediaStoragePath(item.storage_key);
        if (path) await unlink(path).catch(() => undefined);
    }));
    if (expired.rowCount) server.log.info({ event: 'orphan_post_media_removed', count: expired.rowCount }, 'Expired unattached post media removed');
}

function requestId(request: FastifyRequest, key: string): string | undefined {
    const params = request.params as Record<string, string>;
    const id = params[key];
    return id && validId(id) ? id : undefined;
}

interface CommunityChatAccess {
    is_member: boolean;
    is_platform_admin: boolean;
    is_moderator: boolean;
    is_owner: boolean;
    chat_is_locked: boolean;
    chat_locked_until: Date | null;
}

async function communityChatAccess(pool: Pool, communityId: string, userId: string): Promise<CommunityChatAccess | null> {
    const result = await pool.query<CommunityChatAccess>(
        `SELECT (community.status = 'active' AND EXISTS (
                    SELECT 1 FROM impacta.community_members AS member
                    WHERE member.community_id = community.id AND member.user_id = $2 AND member.status = 'active'
                )) AS is_member,
                community.owner_user_id = $2 AS is_owner,
                COALESCE(community.chat_locked_until > now(), false) AS chat_is_locked,
                community.chat_locked_until,
                EXISTS (
                    SELECT 1 FROM impacta.user_roles AS assignment
                    JOIN impacta.roles AS role ON role.id = assignment.role_id
                    JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                    JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                    WHERE assignment.user_id = $2 AND assignment.scope_type = 'platform'
                      AND assignment.scope_id IS NULL
                      AND permission.code IN ('communities.manage', 'content.moderate', 'reports.manage')
                ) AS is_platform_admin,
                (community.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS manager
                    WHERE manager.community_id = community.id AND manager.user_id = $2
                      AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                )) AS is_moderator
         FROM impacta.communities AS community
         WHERE community.id = $1`,
        [communityId, userId]
    );
    return result.rows[0] ?? null;
}

/** Community content is read from PostgreSQL; all mutations require a live session and CSRF token. */
export function registerCommunityRoutes(server: FastifyInstance, pool: Pool): void {
    const mediaCleanupTimer = setInterval(() => {
        void cleanupOrphanPostMedia(pool, server).catch(() => {
            server.log.warn({ event: 'orphan_post_media_cleanup_failed' }, 'Unable to clean expired post media');
        });
    }, 6 * 60 * 60 * 1000);
    mediaCleanupTimer.unref();
    server.addHook('onClose', async () => clearInterval(mediaCleanupTimer));
    void cleanupOrphanPostMedia(pool, server).catch(() => {
        server.log.warn({ event: 'orphan_post_media_cleanup_failed' }, 'Unable to clean expired post media');
    });

    server.post('/api/v1/feed/media', {
        bodyLimit: MAX_POST_VIDEO_BYTES,
        handlerTimeout: 180_000,
        onRequest: async (request, reply) => {
            // Authenticate before Fastify buffers a potentially large upload body.
            const session = await requireSession(request, reply, pool, true);
            if (!session) return reply;
            if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase().startsWith('video/')) {
                const release = acquireVideoProcessingSlot();
                if (!release) {
                    return reply.header('retry-after', '30').code(429).send({ error: 'video_processing_busy' });
                }
                videoProcessingSlots.set(request, release);
            }
        },
        onResponse: async (request) => {
            releaseVideoProcessingSlotForRequest(request);
        }
    }, async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '');
        const isVideo = mimeType === 'video/mp4';
        if (!isImage && !isVideo) return reply.code(415).send({ error: 'unsupported_post_media_type' });
        if (!Buffer.isBuffer(request.body) || !request.body.length) {
            return reply.code(400).send({ error: 'invalid_post_media' });
        }
        const maxBytes = isImage ? MAX_POST_IMAGE_BYTES : MAX_POST_VIDEO_BYTES;
        if (request.body.length > maxBytes) return reply.code(413).send({ error: 'post_media_too_large' });

        let processed: ProcessedPostMedia;
        try {
            processed = isImage
                ? await optimizePostImage(request.body)
                : await optimizePostVideo(request.body);
        } catch (error) {
            if (error instanceof MediaProcessingError) {
                return reply.code(error.statusCode).send({ error: error.code });
            }
            throw error;
        }

        const storageKey = `posts/${randomUUID()}.${processed.extension}`;
        const path = postMediaStoragePath(storageKey);
        if (!path) return reply.code(500).send({ error: 'media_storage_unavailable' });
        await mkdir(POST_MEDIA_DIRECTORY, { recursive: true, mode: 0o700 });
        await writeFile(path, processed.bytes, { flag: 'wx', mode: 0o600 });

        try {
            const stored = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'media', 20)) return null;
                const result = await client.query<{ id: string }>(
                    `INSERT INTO impacta.media
                        (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                     VALUES ($1, $2, $3, $4, $5, $6, 'available')
                     RETURNING id::text AS id`,
                    [session.userId, storageKey, processed.mediaType, processed.mimeType, processed.bytes.length,
                        createHash('sha256').update(processed.bytes).digest('hex')]
                );
                return result.rows[0] ?? null;
            });
            if (!stored) {
                await unlink(path).catch(() => undefined);
                return reply.code(429).send({ error: 'media_rate_limit' });
            }
            return reply.code(201).send({
                id: stored.id,
                url: `/api/v1/media/${encodeURIComponent(stored.id)}`,
                mediaType: processed.mediaType,
                mimeType: processed.mimeType,
                byteSize: processed.bytes.length
            });
        } catch (error) {
            await unlink(path).catch(() => undefined);
            throw error;
        }
    });

    server.delete<{ Params: { mediaId: string } }>('/api/v1/feed/media/:mediaId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const mediaId = requestId(request, 'mediaId');
        if (!mediaId) return reply.code(400).send({ error: 'invalid_media_id' });
        const result = await pool.query<{ storage_key: string }>(
            `UPDATE impacta.media AS media SET status = 'deleted'
             WHERE media.id = $1 AND media.owner_user_id = $2 AND media.status IN ('available', 'pending_scan')
               AND media.storage_key LIKE 'posts/%'
               AND NOT EXISTS (SELECT 1 FROM impacta.post_media AS relation WHERE relation.media_id = media.id)
             RETURNING media.storage_key`,
            [mediaId, session.userId]
        );
        const media = result.rows[0];
        if (!media) return reply.code(404).send({ error: 'media_not_found' });
        const path = postMediaStoragePath(media.storage_key);
        if (path) await unlink(path).catch(() => undefined);
        return { status: 'removed' };
    });

    server.post<{ Params: { communityId: string } }>('/api/v1/communities/:communityId/media', {
        bodyLimit: MAX_POST_VIDEO_BYTES,
        handlerTimeout: 180_000,
        onRequest: async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access?.is_member) return reply.code(403).send({ error: 'community_membership_required' });
            if (access.chat_is_locked && !access.is_owner) return reply.code(403).send({ error: 'community_chat_locked' });
            if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase().startsWith('video/')) {
                const release = acquireVideoProcessingSlot();
                if (!release) {
                    return reply.header('retry-after', '30').code(429).send({ error: 'video_processing_busy' });
                }
                videoProcessingSlots.set(request, release);
            }
        },
        onResponse: async (request) => {
            releaseVideoProcessingSlotForRequest(request);
        }
    }, async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const communityId = requestId(request, 'communityId');
        if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
        const access = await communityChatAccess(pool, communityId, session.userId);
        if (!access?.is_member) return reply.code(403).send({ error: 'community_membership_required' });
        if (access.chat_is_locked && !access.is_owner) return reply.code(403).send({ error: 'community_chat_locked' });

        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '');
        const isVideo = ['video/mp4', 'video/quicktime'].includes(mimeType ?? '');
        if (!isImage && !isVideo) return reply.code(415).send({ error: 'unsupported_community_media_type' });
        if (!Buffer.isBuffer(request.body) || !request.body.length) {
            return reply.code(400).send({ error: 'invalid_community_media' });
        }
        const maxBytes = isImage ? MAX_POST_IMAGE_BYTES : MAX_POST_VIDEO_BYTES;
        if (request.body.length > maxBytes) return reply.code(413).send({ error: 'community_media_too_large' });

        let processed: ProcessedPostMedia;
        try {
            processed = isImage
                ? await optimizePostImage(request.body)
                : await optimizePostVideo(request.body);
        } catch (error) {
            if (error instanceof MediaProcessingError) {
                return reply.code(error.statusCode).send({ error: error.code });
            }
            throw error;
        }

        const storageKey = `community-chat/${randomUUID()}.${processed.extension}`;
        const path = communityChatMediaStoragePath(storageKey);
        if (!path) return reply.code(500).send({ error: 'media_storage_unavailable' });
        await mkdir(COMMUNITY_CHAT_MEDIA_DIRECTORY, { recursive: true, mode: 0o700 });
        await writeFile(path, processed.bytes, { flag: 'wx', mode: 0o600 });
        try {
            const stored = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'community_media', 20)) return null;
                const result = await client.query<{ id: string }>(
                    `INSERT INTO impacta.media
                        (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                     VALUES ($1, $2, $3, $4, $5, $6, 'pending_scan')
                     RETURNING id::text AS id`,
                    [session.userId, storageKey, processed.mediaType, processed.mimeType,
                        processed.bytes.length, createHash('sha256').update(processed.bytes).digest('hex')]
                );
                return result.rows[0] ?? null;
            });
            if (!stored) {
                await unlink(path).catch(() => undefined);
                return reply.code(429).send({ error: 'community_media_rate_limit' });
            }
            return reply.code(201).send({
                id: stored.id,
                mediaType: processed.mediaType,
                mimeType: processed.mimeType,
                byteSize: processed.bytes.length
            });
        } catch (error) {
            await unlink(path).catch(() => undefined);
            throw error;
        }
    });

    server.delete<{ Params: { communityId: string; mediaId: string } }>(
        '/api/v1/communities/:communityId/media/:mediaId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const mediaId = requestId(request, 'mediaId');
            if (!communityId || !mediaId) return reply.code(400).send({ error: 'invalid_community_media' });
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access?.is_member) return reply.code(403).send({ error: 'community_membership_required' });
            const result = await pool.query<{ storage_key: string }>(
                `UPDATE impacta.media AS media SET status = 'deleted'
                 WHERE media.id = $1 AND media.owner_user_id = $2 AND media.status IN ('available', 'pending_scan')
                   AND media.storage_key LIKE 'community-chat/%'
                   AND NOT EXISTS (SELECT 1 FROM impacta.community_messages AS message WHERE message.media_id = media.id)
                 RETURNING media.storage_key`,
                [mediaId, session.userId]
            );
            const media = result.rows[0];
            if (!media) return reply.code(404).send({ error: 'media_not_found' });
            const path = communityChatMediaStoragePath(media.storage_key);
            if (path) await unlink(path).catch(() => undefined);
            return { status: 'removed' };
        }
    );

    server.post<{ Params: { communityId: string }; Body: { durationMinutes?: unknown } }>(
        '/api/v1/communities/:communityId/chat-lock', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const durationMinutes = request.body?.durationMinutes;
            if (!communityId || ![0, 15, 60, 360, 1440].includes(Number(durationMinutes))) {
                return reply.code(400).send({ error: 'invalid_community_chat_lock' });
            }
            const row = await transaction(pool, async (client) => {
                const result = await client.query<{ chat_locked_until: Date | null }>(
                    `UPDATE impacta.communities
                     SET chat_locked_until = CASE WHEN $3::int = 0 THEN NULL
                                                  ELSE now() + make_interval(mins => $3::int) END,
                         updated_at = now()
                     WHERE id = $1 AND owner_user_id = $2 AND status = 'active'
                     RETURNING chat_locked_until`,
                    [communityId, session.userId, Number(durationMinutes)]
                );
                const current = result.rows[0];
                if (current) {
                    const decision = Number(durationMinutes) === 0
                        ? 'Reabertura da conversa da comunidade.'
                        : `Conversa pausada por ${Number(durationMinutes)} minuto(s).`;
                    await client.query(
                        `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                         VALUES ($1, $2, 'community', $3, $4)`,
                        [session.userId, Number(durationMinutes) === 0 ? 'community.chat.unlocked' : 'community.chat.locked', communityId, decision]
                    );
                }
                return current;
            });
            if (!row) return reply.code(404).send({ error: 'community_not_found' });
            return {
                status: row.chat_locked_until ? 'locked' : 'unlocked',
                chat_locked_until: row.chat_locked_until
            };
        }
    );

    server.get<{ Params: { communityId: string }; Querystring: { after?: string; before?: string; recent?: string } }>(
        '/api/v1/communities/:communityId/messages', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const after = request.query?.after;
            const before = request.query?.before;
            const recent = request.query?.recent === '1';
            if (!communityId || (after !== undefined && after !== '0' && !validId(after))
                || (before !== undefined && !validId(before)) || (after !== undefined && before !== undefined)
                || (recent && (after !== undefined || before !== undefined))) {
                return reply.code(400).send({ error: 'invalid_community_messages_query' });
            }
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access || (!access.is_member && !access.is_platform_admin)) {
                return reply.code(404).send({ error: 'community_not_found' });
            }
            if (access.is_platform_admin && !session.mfaVerified) {
                return reply.code(403).send({ error: 'mfa_required' });
            }
            if (access.is_platform_admin && before === undefined && after === undefined && !recent) {
                await pool.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, 'community.chat.read', 'community', $2, 'Leitura administrativa da conversa da comunidade.')`,
                    [session.userId, communityId]
                );
            }
            const query = `SELECT message.id::text AS id,
                                  message.author_user_id::text AS author_user_id,
                                  message.body,
                                  message.created_at,
                                  message.edited_at,
                                  message.moderation_status,
                                  message.deleted_at,
                                  COALESCE(author.display_name, 'Conta encerrada') AS author,
                                  media.media_type,
                                  media.mime_type AS media_mime_type,
                                  CASE WHEN media.id IS NULL THEN NULL
                                       ELSE '/api/v1/communities/' || message.community_id::text || '/media/' || media.id::text END AS media_url
                           FROM impacta.community_messages AS message
                           LEFT JOIN impacta.users AS author ON author.id = message.author_user_id
                           LEFT JOIN impacta.media AS media ON media.id = message.media_id
                               AND media.status IN ('available', 'pending_scan') AND message.deleted_at IS NULL
                           WHERE message.community_id = $1
                             AND (message.moderation_status = 'approved'
                                  OR message.author_user_id = $2
                                  OR $3::boolean)`;
            const baseParams = [communityId, session.userId, access.is_platform_admin];
            const result = after
                ? await pool.query(`${query} AND message.id > $4 ORDER BY message.id ASC LIMIT 100`, [...baseParams, after])
                : before
                    ? await pool.query(`${query} AND message.id < $4 ORDER BY message.id DESC LIMIT 61`, [...baseParams, before])
                    : await pool.query(`${query} ORDER BY message.id DESC LIMIT ${recent ? 60 : 61}`, baseParams);
            const hasMore = !after && !recent && result.rows.length > 60;
            const rows = hasMore ? result.rows.slice(0, 60) : result.rows;
            const items = (after ? rows : rows.reverse()).map((message: Record<string, any>) => {
                const isAuthor = message.author_user_id === session.userId;
                const isDeleted = Boolean(message.deleted_at);
                const edited = Boolean(message.edited_at);
                const { author_user_id: _authorUserId, deleted_at: _deletedAt, edited_at: _editedAt, ...item } = message;
                return {
                    ...item,
                    body: isDeleted ? null : item.body,
                    media_type: isDeleted ? null : item.media_type,
                    media_mime_type: isDeleted ? null : item.media_mime_type,
                    media_url: isDeleted ? null : item.media_url,
                    is_author: isAuthor,
                    is_deleted: isDeleted,
                    edited,
                    is_pending_review: message.moderation_status === 'pending_review',
                    can_edit: isAuthor && !isDeleted && Boolean(message.body),
                    can_delete: !isDeleted && (isAuthor || access.is_moderator || access.is_platform_admin)
                };
            });
            const canSend = access.is_member && (!access.chat_is_locked || access.is_owner);
            return {
                items, has_more: hasMore, is_member: access.is_member, is_owner: access.is_owner,
                can_send: canSend, chat_is_locked: access.chat_is_locked,
                chat_locked_until: access.chat_is_locked ? access.chat_locked_until : null
            };
        }
    );

    server.put<{ Params: { communityId: string } }>(
        '/api/v1/communities/:communityId/read-messages', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access || (!access.is_member && !access.is_owner)) {
                return reply.code(404).send({ error: 'community_not_found' });
            }
            const result = await pool.query<{ last_read_message_id: string }>(
                `INSERT INTO impacta.community_message_reads (community_id, user_id, last_read_message_id)
                 SELECT $1, $2, COALESCE(max(message.id), 0)
                 FROM impacta.community_messages AS message
                 WHERE message.community_id = $1
                   AND message.deleted_at IS NULL
                   AND message.moderation_status = 'approved'
                 ON CONFLICT (community_id, user_id) DO UPDATE
                 SET last_read_message_id = GREATEST(
                         impacta.community_message_reads.last_read_message_id,
                         EXCLUDED.last_read_message_id
                     ),
                     updated_at = now()
                 RETURNING last_read_message_id::text AS last_read_message_id`,
                [communityId, session.userId]
            );
            return { last_read_message_id: result.rows[0]?.last_read_message_id ?? '0' };
        }
    );

    server.post<{ Params: { communityId: string }; Body: { body?: unknown; mediaId?: unknown } }>(
        '/api/v1/communities/:communityId/messages', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
            const rawMediaId = request.body?.mediaId;
            const mediaId = rawMediaId === undefined || rawMediaId === null || rawMediaId === ''
                ? null
                : typeof rawMediaId === 'string' && validId(rawMediaId) ? rawMediaId : undefined;
            if (!communityId || mediaId === undefined || Array.from(body).length > 2000
                || body.includes('\u0000') || (!body && !mediaId)) {
                return reply.code(400).send({ error: 'invalid_community_message' });
            }
            if (body && findFeedPolicyViolation(body)) {
                return reply.code(422).send({ error: 'community_content_not_allowed' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'community_message', 60)) {
                    return { status: 'rate_limit' as const };
                }
                const membership = await client.query<{ chat_is_locked: boolean; is_owner: boolean }>(
                    `SELECT community.id,
                            COALESCE(community.chat_locked_until > now(), false) AS chat_is_locked,
                            community.owner_user_id = $2 AS is_owner
                     FROM impacta.communities AS community
                     JOIN impacta.community_members AS member ON member.community_id = community.id
                     WHERE community.id = $1 AND community.status = 'active'
                       AND member.user_id = $2 AND member.status = 'active'
                     FOR SHARE OF community`,
                    [communityId, session.userId]
                );
                if (!membership.rowCount) return { status: 'membership_required' as const };
                if (membership.rows[0].chat_is_locked && !membership.rows[0].is_owner) {
                    return { status: 'chat_locked' as const };
                }
                if (mediaId) {
                    const media = await client.query(
                        `SELECT media.id FROM impacta.media AS media
                         WHERE media.id = $1 AND media.owner_user_id = $2 AND media.status IN ('available', 'pending_scan')
                           AND media.storage_key LIKE 'community-chat/%'
                           AND NOT EXISTS (SELECT 1 FROM impacta.community_messages AS message WHERE message.media_id = media.id)
                         FOR UPDATE OF media`,
                        [mediaId, session.userId]
                    );
                    if (!media.rowCount) return { status: 'invalid_media' as const };
                }
                const inserted = await client.query<{ id: string; moderation_status: string }>(
                    `INSERT INTO impacta.community_messages
                        (community_id, author_user_id, body, media_id, moderation_status)
                     VALUES ($1, $2, $3, $4, CASE WHEN $4::bigint IS NULL THEN 'approved' ELSE 'pending_review' END)
                     RETURNING id::text AS id, moderation_status`,
                    [communityId, session.userId, body || null, mediaId]
                );
                return { status: 'sent' as const, id: inserted.rows[0].id,
                    moderationStatus: inserted.rows[0].moderation_status };
            });
            if (result.status === 'rate_limit') return reply.code(429).send({ error: 'community_message_rate_limit' });
            if (result.status === 'membership_required') return reply.code(403).send({ error: 'community_membership_required' });
            if (result.status === 'chat_locked') return reply.code(403).send({ error: 'community_chat_locked' });
            if (result.status === 'invalid_media') return reply.code(400).send({ error: 'invalid_community_media' });
            const message = await pool.query(
                `SELECT message.id::text AS id, message.body, message.created_at, message.edited_at,
                        message.moderation_status,
                        author.display_name AS author, media.media_type,
                        media.mime_type AS media_mime_type,
                        CASE WHEN media.id IS NULL THEN NULL
                             ELSE '/api/v1/communities/' || message.community_id::text || '/media/' || media.id::text END AS media_url
                 FROM impacta.community_messages AS message
                 JOIN impacta.users AS author ON author.id = message.author_user_id
                 LEFT JOIN impacta.media AS media ON media.id = message.media_id AND media.status IN ('available', 'pending_scan')
                 WHERE message.id = $1`,
                [result.id]
            );
            return reply.code(201).send({ item: {
                ...message.rows[0], is_author: true, edited: Boolean(message.rows[0]?.edited_at),
                can_edit: Boolean(body), can_delete: true, is_deleted: false,
                is_pending_review: result.moderationStatus === 'pending_review'
            } });
        }
    );

    server.put<{ Params: { communityId: string; messageId: string }; Body: { body?: unknown } }>(
        '/api/v1/communities/:communityId/messages/:messageId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const messageId = requestId(request, 'messageId');
            const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
            if (!communityId || !messageId || !body || Array.from(body).length > 2000 || body.includes('\u0000')) {
                return reply.code(400).send({ error: 'invalid_community_message' });
            }
            if (findFeedPolicyViolation(body)) {
                return reply.code(422).send({ error: 'community_content_not_allowed' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'community_message', 60)) return null;
                const access = await client.query<{ chat_is_locked: boolean; is_owner: boolean }>(
                    `SELECT COALESCE(community.chat_locked_until > now(), false) AS chat_is_locked,
                            community.owner_user_id = $2 AS is_owner
                     FROM impacta.communities AS community
                     JOIN impacta.community_members AS member ON member.community_id = community.id
                     WHERE community.id = $1 AND community.status = 'active'
                       AND member.user_id = $2 AND member.status = 'active'
                     FOR SHARE OF community`,
                    [communityId, session.userId]
                );
                if (!access.rowCount) return false;
                if (access.rows[0].chat_is_locked && !access.rows[0].is_owner) return 'chat_locked' as const;
                const updated = await client.query<{ id: string; body: string; created_at: Date; edited_at: Date }>(
                    `UPDATE impacta.community_messages AS message
                     SET body = $4, edited_at = now(), edited_by_user_id = $3
                     WHERE message.id = $1 AND message.community_id = $2
                       AND message.author_user_id = $3 AND message.deleted_at IS NULL
                       AND EXISTS (
                           SELECT 1 FROM impacta.communities AS community
                           JOIN impacta.community_members AS member ON member.community_id = community.id
                           WHERE community.id = message.community_id AND community.status = 'active'
                             AND member.user_id = $3 AND member.status = 'active'
                       )
                     RETURNING message.id::text AS id, message.body, message.created_at,
                               message.edited_at`,
                    [messageId, communityId, session.userId, body]
                );
                return updated.rows[0] ?? false;
            });
            if (result === null) return reply.code(429).send({ error: 'community_message_rate_limit' });
            if (result === 'chat_locked') return reply.code(403).send({ error: 'community_chat_locked' });
            if (!result) return reply.code(404).send({ error: 'community_message_not_found' });
            return { item: { ...result, author: session.displayName, edited: true,
                is_author: true, is_deleted: false, can_edit: true, can_delete: true } };
        }
    );

    server.delete<{ Params: { communityId: string; messageId: string } }>(
        '/api/v1/communities/:communityId/messages/:messageId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const messageId = requestId(request, 'messageId');
            if (!communityId || !messageId) return reply.code(400).send({ error: 'invalid_community_message' });
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access || (!access.is_member && !access.is_platform_admin)) {
                return reply.code(404).send({ error: 'community_not_found' });
            }
            if (access.is_platform_admin && !session.mfaVerified) {
                return reply.code(403).send({ error: 'mfa_required' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'community_message', 60)) return null;
                const removed = await client.query<{
                    id: string; created_at: Date; author_user_id: string; media_id: string | null;
                    moderation_status: string;
                }>(
                    `UPDATE impacta.community_messages AS message
                     SET deleted_at = now(), deleted_by_user_id = $3,
                         moderation_status = CASE WHEN message.moderation_status = 'pending_review' THEN 'removed'
                                                  ELSE message.moderation_status END
                     WHERE message.id = $1 AND message.community_id = $2 AND message.deleted_at IS NULL
                       AND (message.author_user_id = $3 OR $4::boolean OR EXISTS (
                           SELECT 1 FROM impacta.communities AS community
                           WHERE community.id = message.community_id
                             AND (community.owner_user_id = $3 OR EXISTS (
                                 SELECT 1 FROM impacta.community_members AS manager
                                 WHERE manager.community_id = community.id AND manager.user_id = $3
                                   AND manager.status = 'active'
                                   AND manager.membership_role IN ('manager', 'moderator')
                             ))
                       ))
                     RETURNING message.id::text AS id, message.created_at,
                               message.author_user_id::text AS author_user_id,
                               message.media_id::text AS media_id, message.moderation_status`,
                    [messageId, communityId, session.userId, access.is_platform_admin]
                );
                if (removed.rows[0] && removed.rows[0].author_user_id !== session.userId) {
                    await client.query(
                        `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                         VALUES ($1, 'community.message.moderate', 'community_message', $2, $3)`,
                        [session.userId, messageId, `Mensagem moderada na comunidade ${communityId}.`]
                    );
                }
                if (removed.rows[0]?.media_id) {
                    await client.query(
                        `UPDATE impacta.media SET status = 'quarantined'
                         WHERE id = $1 AND status IN ('available', 'pending_scan')`,
                        [removed.rows[0].media_id]
                    );
                }
                return removed.rows[0] ?? false;
            });
            if (result === null) return reply.code(429).send({ error: 'community_message_rate_limit' });
            if (!result) return reply.code(404).send({ error: 'community_message_not_found' });
            return { item: { id: result.id, created_at: result.created_at, is_deleted: true, is_author: false, can_edit: false, can_delete: false } };
        }
    );

    server.get<{ Params: { communityId: string; mediaId: string } }>(
        '/api/v1/communities/:communityId/media/:mediaId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const mediaId = requestId(request, 'mediaId');
            if (!communityId || !mediaId) return reply.code(404).send({ error: 'media_not_found' });
            const access = await communityChatAccess(pool, communityId, session.userId);
            if (!access || (!access.is_member && !access.is_platform_admin)) {
                return reply.code(404).send({ error: 'media_not_found' });
            }
            if (access.is_platform_admin && !session.mfaVerified) {
                return reply.code(403).send({ error: 'mfa_required' });
            }
            const result = await pool.query<{ storage_key: string; media_type: 'image' | 'video'; mime_type: string }>(
                `SELECT media.storage_key, media.media_type, media.mime_type
                 FROM impacta.media AS media
                 JOIN impacta.community_messages AS message ON message.media_id = media.id
                 WHERE media.id = $1 AND message.community_id = $2
                   AND message.deleted_at IS NULL
                   AND ((media.status = 'available' AND message.moderation_status = 'approved')
                        OR (media.status = 'pending_scan'
                            AND (message.author_user_id = $3 OR $4::boolean)))`,
                [mediaId, communityId, session.userId, access.is_platform_admin]
            );
            const media = result.rows[0];
            const path = media ? communityChatMediaStoragePath(media.storage_key) : null;
            if (!media || !path) return reply.code(404).send({ error: 'media_not_found' });
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
                        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
                            || start < 0 || start >= file.size || end < start) {
                            return reply.code(416).header('content-range', `bytes */${file.size}`).send();
                        }
                        end = Math.min(end, file.size - 1);
                        return reply.code(206).type(media.mime_type)
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
                return reply.type(media.mime_type).header('cache-control', 'private, no-store').send(await readFile(path));
            } catch {
                return reply.code(404).send({ error: 'media_not_found' });
            }
        }
    );

    server.get<{ Querystring: { category?: string } }>('/api/v1/feed/categories', async () => {
        const result = await pool.query(
            `SELECT code, name, description
             FROM impacta.post_categories
             WHERE is_active
             ORDER BY sort_order, name`
        );
        return { items: result.rows };
    });

    server.get('/api/v1/notifications', async (request, reply) => {
        const session = await requireSession(request, reply, pool, false);
        if (!session) return;
        const notificationTypes = [
            'post_reaction', 'post_comment', 'post_share', 'space_proposal_reviewed',
            'post_mention', 'comment_mention', 'impactation_request',
            'impactation_accepted', 'impactation_declined'
        ];
        const [items, unread] = await Promise.all([
            pool.query<{
                id: string; type: string; actor_name: string; post_id: string;
                actor_id: string; request_id: string; comment_excerpt: string;
                request_status: string | null; payload: Record<string, unknown>; created_at: Date; read_at: Date | null;
            }>(
                `SELECT notification.id::text AS id,
                        notification.notification_type AS type,
                        COALESCE(actor.display_name, 'Membro') AS actor_name,
                        COALESCE(notification.payload->>'actor_user_id', '') AS actor_id,
                        COALESCE(notification.payload->>'request_id', '') AS request_id,
                        COALESCE(notification.payload->>'post_id', '') AS post_id,
                        COALESCE(notification.payload->>'excerpt', '') AS comment_excerpt,
                        impactation_request.status AS request_status,
                        notification.payload,
                        notification.created_at,
                        notification.read_at
                 FROM impacta.notifications AS notification
                 LEFT JOIN impacta.users AS actor
                   ON actor.id::text = notification.payload->>'actor_user_id'
                 LEFT JOIN impacta.impactation_requests AS impactation_request
                   ON notification.notification_type = 'impactation_request'
                  AND impactation_request.id::text = notification.payload->>'request_id'
                 WHERE notification.user_id = $1
                   AND notification.notification_type = ANY($2::text[])
                 ORDER BY notification.created_at DESC, notification.id DESC
                 LIMIT 30`,
                [session.userId, notificationTypes]
            ),
            pool.query<{ count: number }>(
                `SELECT count(*)::int AS count
                 FROM impacta.notifications
                 WHERE user_id = $1 AND read_at IS NULL
                   AND notification_type = ANY($2::text[])`,
                [session.userId, notificationTypes]
            )
        ]);
        return { items: items.rows, unreadCount: unread.rows[0]?.count ?? 0 };
    });

    server.get('/api/v1/activity/badges', async (request, reply) => {
        const session = await findSession(request, pool, false);
        if (!session) return { communities: [], projects: [] };
        const [communities, projects, projectMessages] = await Promise.all([
            pool.query<{ id: string; unread_count: number }>(
                `SELECT message.community_id::text AS id, count(*)::int AS unread_count
                 FROM impacta.community_messages AS message
                 JOIN impacta.communities AS community ON community.id = message.community_id
                 LEFT JOIN impacta.community_members AS member
                   ON member.community_id = community.id AND member.user_id = $1 AND member.status = 'active'
                 LEFT JOIN impacta.community_message_reads AS message_read
                   ON message_read.community_id = community.id AND message_read.user_id = $1
                 WHERE community.status = 'active'
                   AND (member.user_id IS NOT NULL OR community.owner_user_id = $1)
                   AND message.author_user_id <> $1
                   AND message.deleted_at IS NULL
                   AND message.moderation_status = 'approved'
                   AND message.id > COALESCE(message_read.last_read_message_id, 0)
                 GROUP BY message.community_id
                 HAVING count(*) > 0`,
                [session.userId]
            ),
            pool.query<{ id: string; unread_count: number }>(
                `SELECT notification.payload->>'project_id' AS id, count(*)::int AS unread_count
                 FROM impacta.notifications AS notification
                 WHERE notification.user_id = $1
                   AND notification.read_at IS NULL
                   AND notification.notification_type = ANY($2::text[])
                   AND notification.payload->>'project_id' ~ '^[1-9][0-9]{0,18}$'
                 GROUP BY notification.payload->>'project_id'`,
                [session.userId, PROJECT_ACTIVITY_NOTIFICATION_TYPES]
            ),
            pool.query<{ id: string; unread_count: number }>(
                `SELECT message.project_id::text AS id, count(*)::int AS unread_count
                 FROM impacta.project_messages AS message
                 JOIN impacta.projects AS project ON project.id = message.project_id
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 LEFT JOIN impacta.project_members AS member
                   ON member.project_id = project.id AND member.user_id = $1
                 LEFT JOIN impacta.project_message_reads AS message_read
                   ON message_read.project_id = project.id AND message_read.user_id = $1
                 LEFT JOIN impacta.project_message_preferences AS preference
                   ON preference.project_id = project.id AND preference.user_id = $1
                 WHERE (member.user_id IS NOT NULL OR project.owner_user_id = $1
                        OR community.owner_user_id = $1 OR EXISTS (
                            SELECT 1 FROM impacta.community_members AS manager
                            WHERE manager.community_id = community.id AND manager.user_id = $1
                              AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                        ))
                   AND project.status IN ('active', 'completed')
                   AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                   AND message.author_user_id <> $1
                   AND message.deleted_at IS NULL
                   AND message.id > COALESCE(message_read.last_read_message_id, 0)
                   AND COALESCE(preference.muted, false) = false
                 GROUP BY message.project_id
                 HAVING count(*) > 0`,
                [session.userId]
            )
        ]);
        return { communities: communities.rows, projects: projects.rows, projectMessages: projectMessages.rows };
    });

    server.get<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/notifications', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const projectId = requestId(request, 'projectId');
            if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
            const [items, unread] = await Promise.all([
                pool.query<{
                    id: string; type: string; actor_name: string; challenge_title: string | null;
                    decision: string | null; created_at: Date; read_at: Date | null;
                }>(
                    `SELECT notification.id::text AS id,
                            notification.notification_type AS type,
                            COALESCE(actor.display_name, 'Membro') AS actor_name,
                            challenge.title AS challenge_title,
                            notification.payload->>'decision' AS decision,
                            notification.created_at,
                            notification.read_at
                     FROM impacta.notifications AS notification
                     LEFT JOIN impacta.users AS actor
                       ON actor.id::text = notification.payload->>'actor_user_id'
                     LEFT JOIN impacta.challenges AS challenge
                       ON challenge.id::text = notification.payload->>'challenge_id'
                     WHERE notification.user_id = $1
                       AND notification.payload->>'project_id' = $2
                       AND notification.notification_type = ANY($3::text[])
                     ORDER BY notification.created_at DESC, notification.id DESC
                     LIMIT 25`,
                    [session.userId, projectId, PROJECT_ACTIVITY_NOTIFICATION_TYPES]
                ),
                pool.query<{ count: number }>(
                    `SELECT count(*)::int AS count
                     FROM impacta.notifications
                     WHERE user_id = $1 AND read_at IS NULL
                       AND payload->>'project_id' = $2
                       AND notification_type = ANY($3::text[])`,
                    [session.userId, projectId, PROJECT_ACTIVITY_NOTIFICATION_TYPES]
                )
            ]);
            return { items: items.rows, unreadCount: unread.rows[0]?.count ?? 0 };
        }
    );

    server.post<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/notifications/read-all', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const projectId = requestId(request, 'projectId');
            if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
            const result = await pool.query(
                `UPDATE impacta.notifications SET read_at = now()
                 WHERE user_id = $1 AND read_at IS NULL
                   AND payload->>'project_id' = $2
                   AND notification_type = ANY($3::text[])`,
                [session.userId, projectId, PROJECT_ACTIVITY_NOTIFICATION_TYPES]
            );
            return { updated: result.rowCount ?? 0 };
        }
    );

    server.put<{ Params: { notificationId: string } }>(
        '/api/v1/notifications/:notificationId/read', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const notificationId = requestId(request, 'notificationId');
            if (!notificationId) return reply.code(400).send({ error: 'invalid_notification_id' });
            const result = await pool.query<{ read_at: Date }>(
                `UPDATE impacta.notifications SET read_at = COALESCE(read_at, now())
                 WHERE id = $1 AND user_id = $2
                 RETURNING read_at`,
                [notificationId, session.userId]
            );
            if (!result.rows[0]) return reply.code(404).send({ error: 'notification_not_found' });
            return { read_at: result.rows[0].read_at };
        }
    );

    server.post('/api/v1/notifications/read-all', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const result = await pool.query(
            `UPDATE impacta.notifications SET read_at = now()
             WHERE user_id = $1 AND read_at IS NULL
               AND notification_type IN (
                   'post_reaction', 'post_comment', 'post_share', 'space_proposal_reviewed',
                   'post_mention', 'comment_mention', 'impactation_request',
                   'impactation_accepted', 'impactation_declined'
               )`,
            [session.userId]
        );
        return { updated: result.rowCount ?? 0 };
    });

    server.get<{ Params: { postId: string; mediaId: string } }>(
        '/api/v1/feed/posts/:postId/pending-media/:mediaId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const postId = requestId(request, 'postId');
            const mediaId = requestId(request, 'mediaId');
            if (!postId || !mediaId) return reply.code(404).send({ error: 'media_not_found' });
            const result = await pool.query<{ storage_key: string; mime_type: string; media_type: 'image' | 'video' }>(
                `SELECT media.storage_key, media.mime_type, media.media_type
                 FROM impacta.posts AS post
                 JOIN impacta.post_media AS relation ON relation.post_id = post.id
                 JOIN impacta.media AS media ON media.id = relation.media_id
                 WHERE post.id = $1 AND media.id = $2 AND post.author_user_id = $3
                   AND post.moderation_status = 'pending_review' AND post.status = 'published'
                   AND media.status IN ('available', 'pending_scan')`,
                [postId, mediaId, session.userId]
            );
            const media = result.rows[0];
            const path = media ? postMediaStoragePath(media.storage_key) : null;
            if (!media || !path) return reply.code(404).send({ error: 'media_not_found' });
            try {
                return reply.type(media.mime_type).header('cache-control', 'private, no-store')
                    .send(createReadStream(path));
            } catch {
                return reply.code(404).send({ error: 'media_not_found' });
            }
        }
    );

    server.get<{ Querystring: { category?: string; offset?: string } }>('/api/v1/feed/posts', async (request, reply) => {
        const categoryCode = request.query.category?.trim() ?? '';
        if (categoryCode && !POST_CATEGORY_CODE.test(categoryCode)) {
            return reply.code(400).send({ error: 'invalid_post_category' });
        }
        const offsetValue = request.query.offset ?? '0';
        if (!/^(0|[1-9]\d{0,6})$/.test(offsetValue) || Number(offsetValue) > 500000) {
            return reply.code(400).send({ error: 'invalid_post_offset' });
        }
        const offset = Number(offsetValue);
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT post.id::text AS id,
                    post.body,
                    post.moderation_status,
                    post.category_code,
                    post.custom_category,
                    COALESCE(NULLIF(post.custom_category, ''), post_category.name) AS category,
                    post.created_at,
                    (post.updated_at > post.created_at) AS edited,
                    author.id::text AS author_id,
                    COALESCE(author.display_name, 'Conta encerrada') AS author,
                    profile.headline AS author_headline,
                    profile.is_public AS author_profile_public,
                    EXISTS (
                        SELECT 1 FROM impacta.user_roles AS assignment
                        JOIN impacta.roles AS role ON role.id = assignment.role_id
                        WHERE assignment.user_id = author.id
                          AND assignment.scope_type = 'platform' AND assignment.scope_id IS NULL
                          AND role.code = 'platform_admin'
                    ) AS author_is_platform_admin,
                    EXISTS (
                        SELECT 1 FROM impacta.account_verification_requests AS verification
                        WHERE verification.user_id = author.id AND verification.status = 'approved'
                          AND verification.proof_confirmed_at IS NOT NULL
                    ) AS author_is_identity_verified,
                    avatar.id::text AS avatar_id,
                    community.name AS community,
                    project.id::text AS project_id,
                    project.title AS project,
                    ${mentionJsonSql('post')},
                    (post.author_user_id = $1::bigint) AS is_author,
                    EXISTS (SELECT 1 FROM impacta.reactions AS viewer_reaction
                            WHERE viewer_reaction.post_id = post.id
                              AND viewer_reaction.user_id = $1::bigint) AS supported_by_viewer,
                    (SELECT count(reaction.user_id)::int FROM impacta.reactions AS reaction
                     WHERE reaction.post_id = post.id) AS support_count,
                    (SELECT count(comment.id)::int FROM impacta.comments AS comment
                     WHERE comment.post_id = post.id AND comment.status = 'published'
                       AND comment.deleted_at IS NULL) AS comment_count,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'id', media.id::text,
                            'url', CASE WHEN post.moderation_status = 'pending_review'
                                             AND post.author_user_id = $1::bigint
                                       THEN '/api/v1/feed/posts/' || post.id::text || '/pending-media/' || media.id::text
                                       ELSE '/api/v1/media/' || media.id::text END,
                            'media_type', media.media_type,
                            'mime_type', media.mime_type
                        ) ORDER BY post_media.position)
                        FROM impacta.post_media AS post_media
                        JOIN impacta.media AS media ON media.id = post_media.media_id
                        WHERE post_media.post_id = post.id
                          AND (media.status = 'available' OR
                               (media.status = 'pending_scan' AND post.moderation_status = 'pending_review'
                                AND post.author_user_id = $1::bigint))
                    ), '[]'::json) AS media
             FROM impacta.posts AS post
             LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = author.id AND profile.is_public
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
                 AND avatar.status = 'available' AND avatar.media_type = 'image'
             LEFT JOIN impacta.communities AS community ON community.id = post.community_id
             LEFT JOIN impacta.projects AS project ON project.id = post.project_id
             LEFT JOIN impacta.communities AS project_community ON project_community.id = project.community_id
             JOIN impacta.post_categories AS post_category ON post_category.code = post.category_code
             WHERE post.status = 'published' AND post.deleted_at IS NULL
               AND (post.moderation_status = 'approved'
                    OR (post.moderation_status = 'pending_review' AND post.author_user_id = $1::bigint))
               AND post_category.is_active
               AND ($2::text IS NULL OR post.category_code = $2)
               AND (post.author_user_id IS NULL OR author.status = 'active')
               AND (post.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
               AND (post.project_id IS NULL OR
                    (project.status IN ('active', 'completed') AND
                     (project.community_id IS NULL OR
                      (project_community.status = 'active' AND project_community.visibility = 'public'))))
             ORDER BY post.created_at DESC, post.id DESC
             LIMIT 51 OFFSET $3`,
            [session?.userId ?? null, categoryCode || null, offset]
        );
        return { items: result.rows.slice(0, 50), hasMore: result.rows.length > 50 };
    });

    server.post<{ Body: { body?: unknown; mediaIds?: unknown; categoryCode?: unknown; customCategory?: unknown; mentionUserIds?: unknown; projectId?: unknown } }>('/api/v1/feed/posts', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const body = cleanText(request.body?.body, 2000);
        if (!body) return reply.code(400).send({ error: 'invalid_post_body' });
        const mentionIds = mentionIdsInput(request.body?.mentionUserIds);
        if (!mentionIds) return reply.code(400).send({ error: 'invalid_mentions' });
        const rawCategoryCode = request.body?.categoryCode;
        const categoryCode = rawCategoryCode === undefined
            ? 'community'
            : typeof rawCategoryCode === 'string' ? rawCategoryCode.trim() : '';
        if (!POST_CATEGORY_CODE.test(categoryCode)) {
            return reply.code(400).send({ error: 'invalid_post_category' });
        }
        const rawCustomCategory = request.body?.customCategory;
        const customCategory = rawCustomCategory === undefined
            ? ''
            : typeof rawCustomCategory === 'string' ? rawCustomCategory.trim() : null;
        if (customCategory === null || Array.from(customCategory).length > 60
            || customCategory.includes('\u0000') || (customCategory && categoryCode !== 'other')) {
            return reply.code(400).send({ error: 'invalid_post_custom_category' });
        }
        const requiresContentReview = Boolean(findFeedPolicyViolation(`${body} ${customCategory}`));
        const rawMediaIds = request.body?.mediaIds;
        if (rawMediaIds !== undefined && (!Array.isArray(rawMediaIds)
            || rawMediaIds.length > 4
            || rawMediaIds.some((id: unknown) => typeof id !== 'string' || !validId(id))
            || new Set(rawMediaIds).size !== rawMediaIds.length)) {
            return reply.code(400).send({ error: 'invalid_post_media' });
        }
        const mediaIds = (rawMediaIds ?? []) as string[];
        const rawProjectId = request.body?.projectId;
        const projectId = rawProjectId === undefined || rawProjectId === null || rawProjectId === ''
            ? null
            : typeof rawProjectId === 'string' && validId(rawProjectId) ? rawProjectId : undefined;
        if (projectId === undefined) return reply.code(400).send({ error: 'invalid_project_id' });

        let publicationStage = 'begin_transaction';
        const post = await transaction(pool, async (client) => {
            publicationStage = 'category_lookup';
            const category = await client.query<{ name: string }>(
                `SELECT name FROM impacta.post_categories WHERE code = $1 AND is_active`,
                [categoryCode]
            );
            if (!category.rows[0]) return { invalidCategory: true as const };
            publicationStage = 'post_rate_limit';
            if (!await beginLimitedWrite(client, session.userId, 'post', 10)) return null;
            const mentions = await resolveMentionTargets(client, mentionIds, body, session.userId);
            if (!mentions) return { invalidMentions: true as const };
            let projectTitle: string | null = null;
            if (projectId) {
                publicationStage = 'project_access_validation';
                const project = await client.query<{ title: string }>(
                    `SELECT project.title
                     FROM impacta.projects AS project
                     LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                     WHERE project.id = $1 AND project.status IN ('active', 'completed')
                       AND (project.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))
                       AND (project.owner_user_id = $2::bigint OR EXISTS (
                           SELECT 1 FROM impacta.project_members AS member
                           WHERE member.project_id = project.id AND member.user_id = $2::bigint
                       ) OR EXISTS (
                           SELECT 1 FROM impacta.community_members AS manager
                           WHERE manager.community_id = project.community_id AND manager.user_id = $2::bigint
                             AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                       ) OR EXISTS (
                           SELECT 1 FROM impacta.user_roles AS assignment
                           JOIN impacta.roles AS role ON role.id = assignment.role_id
                           JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                           JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                           WHERE assignment.user_id = $2::bigint AND permission.code = 'projects.review'
                             AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                               OR (assignment.scope_type = 'community' AND assignment.scope_id = project.community_id))
                       ))
                     FOR SHARE OF project`,
                    [projectId, session.userId]
                );
                if (!project.rows[0]) return { projectUnavailable: true as const };
                projectTitle = project.rows[0].title;
            }
            publicationStage = 'media_validation';
            const mediaRows = mediaIds.length
                ? await client.query<{ id: string; media_type: 'image' | 'video'; mime_type: string }>(
                    `SELECT media.id::text AS id, media.media_type, media.mime_type
                     FROM impacta.media AS media
                     WHERE media.id = ANY($1::bigint[]) AND media.owner_user_id = $2
                       AND media.status = 'available' AND media.storage_key LIKE 'posts/%'
                       AND NOT EXISTS (
                           SELECT 1 FROM impacta.post_media AS linked WHERE linked.media_id = media.id
                       )
                     ORDER BY array_position($1::bigint[], media.id)
                     FOR UPDATE OF media`,
                    [mediaIds, session.userId]
                )
                : { rows: [] as Array<{ id: string; media_type: 'image' | 'video'; mime_type: string }> };
            const videoCount = mediaRows.rows.filter((media) => media.media_type === 'video').length;
            if (mediaRows.rows.length !== mediaIds.length || videoCount > 1
                || (videoCount > 0 && mediaRows.rows.length > 1)) return { invalidMedia: true as const };
            publicationStage = 'post_insert';
            const inserted = await client.query<{
                id: string; created_at: Date; category_code: string; custom_category: string; moderation_status: string;
            }>(
                `INSERT INTO impacta.posts (author_user_id, project_id, body, category_code, custom_category, moderation_status)
                 VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN 'pending_review' ELSE 'approved' END)
                 RETURNING id::text AS id, created_at, category_code, custom_category, moderation_status`,
                [session.userId, projectId, body, categoryCode, customCategory, requiresContentReview]
            );
            const createdPost = inserted.rows[0];
            await saveMentions(client, session.userId, createdPost.id, 'post', mentions, true, body);
            if (mediaIds.length) {
                publicationStage = 'attachment_insert';
                await client.query(
                    `INSERT INTO impacta.post_media (post_id, media_id, position)
                     SELECT $1, attachment.media_id, (attachment.position - 1)::smallint
                     FROM unnest($2::bigint[]) WITH ORDINALITY AS attachment(media_id, position)`,
                    [createdPost.id, mediaIds]
                );
                if (requiresContentReview) {
                    await client.query(
                        `UPDATE impacta.media SET status = 'pending_scan'
                         WHERE id = ANY($1::bigint[]) AND owner_user_id = $2 AND status = 'available'`,
                        [mediaIds, session.userId]
                    );
                }
            }
            publicationStage = 'transaction_commit';
            return {
                post: createdPost,
                project: projectTitle,
                category: customCategory || category.rows[0].name,
                mentions,
                media: mediaRows.rows.map((media) => ({
                    id: media.id,
                    url: createdPost.moderation_status === 'pending_review'
                        ? `/api/v1/feed/posts/${encodeURIComponent(createdPost.id)}/pending-media/${encodeURIComponent(media.id)}`
                        : `/api/v1/media/${encodeURIComponent(media.id)}`,
                    media_type: media.media_type,
                    mime_type: media.mime_type
                }))
            };
        }).catch((error: unknown) => {
            const databaseError = typeof error === 'object' && error !== null
                ? error as { code?: string; schema?: string; table?: string; column?: string; constraint?: string }
                : {};
            request.log.error({
                event: 'post_publication_failed',
                stage: publicationStage,
                code: databaseError.code ?? 'unknown',
                schema: databaseError.schema,
                table: databaseError.table,
                column: databaseError.column,
                constraint: databaseError.constraint
            }, 'PostgreSQL failed to publish a community post');
            throw error;
        });
        if (!post) return reply.code(429).send({ error: 'post_rate_limit' });
        if ('invalidCategory' in post) return reply.code(400).send({ error: 'invalid_post_category' });
        if ('invalidMedia' in post) return reply.code(400).send({ error: 'invalid_post_media' });
        if ('invalidMentions' in post) return reply.code(400).send({ error: 'invalid_mentions' });
        if ('projectUnavailable' in post) return reply.code(403).send({ error: 'project_update_access_required' });
        return reply.code(201).send({
            id: post.post.id,
            body,
            category_code: post.post.category_code,
            custom_category: post.post.custom_category,
            category: post.category,
            created_at: post.post.created_at,
            edited: false,
            moderation_status: post.post.moderation_status,
            project_id: projectId,
            project: post.project,
            author: session.displayName,
            author_id: session.userId,
            author_headline: null,
            author_profile_public: false,
            avatar_id: null,
            community: null,
            is_author: true,
            supported_by_viewer: false,
            support_count: 0,
            comment_count: 0,
            media: post.media,
            mentions: post.mentions.map((target) => ({
                user_id: target.id, display_name: target.display_name, is_public: target.is_public
            }))
        });
    });

    server.put<{ Params: { postId: string }; Body: { body?: unknown; categoryCode?: unknown; customCategory?: unknown; mentionUserIds?: unknown } }>(
        '/api/v1/feed/posts/:postId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const postId = requestId(request, 'postId');
            const body = cleanText(request.body?.body, 2000);
            if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
            if (!body) return reply.code(400).send({ error: 'invalid_post_body' });
            const mentionIds = request.body?.mentionUserIds === undefined
                ? null
                : mentionIdsInput(request.body.mentionUserIds);
            if (mentionIds === null && request.body?.mentionUserIds !== undefined) {
                return reply.code(400).send({ error: 'invalid_mentions' });
            }

            const rawCategory = request.body?.categoryCode;
            if (rawCategory !== undefined && typeof rawCategory !== 'string') {
                return reply.code(400).send({ error: 'invalid_post_category' });
            }
            const rawCustomCategory = request.body?.customCategory;
            if (rawCustomCategory !== undefined && typeof rawCustomCategory !== 'string') {
                return reply.code(400).send({ error: 'invalid_post_custom_category' });
            }

            const result = await transaction(pool, async (client) => {
                const existing = await client.query<{
                    body: string; category_code: string; custom_category: string; created_at: Date; updated_at: Date;
                    moderation_status: string;
                }>(
                    `SELECT post.body, post.category_code, post.custom_category, post.created_at, post.updated_at,
                            post.moderation_status
                     FROM impacta.posts AS post
                     LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                     WHERE post.id = $1 AND post.author_user_id = $2
                       AND post.status = 'published' AND post.deleted_at IS NULL
                       AND (post.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))
                     FOR UPDATE OF post`,
                    [postId, session.userId]
                );
                const current = existing.rows[0];
                if (!current) return null;

                const mentions = mentionIds === null
                    ? null
                    : await resolveMentionTargets(client, mentionIds, body, session.userId);
                if (mentionIds !== null && !mentions) return { invalidMentions: true as const };

                const categoryCode = rawCategory === undefined ? current.category_code : rawCategory.trim();
                if (!POST_CATEGORY_CODE.test(categoryCode)) return { invalidCategory: true as const };
                const customCategory = rawCustomCategory === undefined
                    ? (categoryCode === 'other' ? current.custom_category : '')
                    : (rawCustomCategory as string).trim();
                if (Array.from(customCategory).length > 60 || customCategory.includes('\u0000')
                    || (customCategory && categoryCode !== 'other')) {
                    return { invalidCustomCategory: true as const };
                }
                const requiresContentReview = Boolean(findFeedPolicyViolation(`${body} ${customCategory}`));
                const category = await client.query<{ name: string }>(
                    'SELECT name FROM impacta.post_categories WHERE code = $1 AND is_active',
                    [categoryCode]
                );
                if (!category.rows[0]) return { invalidCategory: true as const };

                let post = current;
                if (current.body !== body || current.category_code !== categoryCode
                    || current.custom_category !== customCategory
                    || (requiresContentReview && current.moderation_status !== 'pending_review')) {
                    const updated = await client.query<{
                        body: string; category_code: string; custom_category: string; created_at: Date; updated_at: Date;
                        moderation_status: string;
                    }>(
                        `UPDATE impacta.posts
                         SET body = $3, category_code = $4, custom_category = $5,
                             moderation_status = CASE WHEN $6::boolean THEN 'pending_review' ELSE moderation_status END,
                             updated_at = now()
                         WHERE id = $1 AND author_user_id = $2
                         RETURNING body, category_code, custom_category, created_at, updated_at, moderation_status`,
                        [postId, session.userId, body, categoryCode, customCategory, requiresContentReview]
                    );
                    post = updated.rows[0];
                }
                if (requiresContentReview) {
                    await client.query(
                        `UPDATE impacta.media AS media SET status = 'pending_scan'
                         FROM impacta.post_media AS relation
                         WHERE relation.post_id = $1 AND relation.media_id = media.id
                           AND media.status = 'available'`,
                        [postId]
                    );
                }
                if (mentions) {
                    await client.query('DELETE FROM impacta.content_mentions WHERE post_id = $1', [postId]);
                    await saveMentions(client, session.userId, postId, 'post', mentions, false, body);
                }
                return { post, category: customCategory || category.rows[0].name, mentions };
            });

            if (!result) return reply.code(404).send({ error: 'post_not_found' });
            if ('invalidCategory' in result) return reply.code(400).send({ error: 'invalid_post_category' });
            if ('invalidCustomCategory' in result) return reply.code(400).send({ error: 'invalid_post_custom_category' });
            if ('invalidMentions' in result) return reply.code(400).send({ error: 'invalid_mentions' });
            return {
                id: postId,
                body: result.post.body,
                category_code: result.post.category_code,
                custom_category: result.post.custom_category,
                category: result.category,
                moderation_status: result.post.moderation_status,
                created_at: result.post.created_at,
                edited: result.post.updated_at > result.post.created_at,
                is_author: true,
                ...(result.mentions ? { mentions: result.mentions.map((target) => ({
                    user_id: target.id, display_name: target.display_name, is_public: target.is_public
                })) } : {})
            };
        }
    );

    server.delete<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
        const removed = await transaction(pool, async (client) => {
            const post = await client.query(
                `UPDATE impacta.posts
                 SET status = 'removed', deleted_at = now()
                 WHERE id = $1 AND author_user_id = $2 AND status = 'published' AND deleted_at IS NULL
                 RETURNING id`,
                [postId, session.userId]
            );
            if (post.rowCount === 0) return null;
            const media = await client.query<{ id: string; storage_key: string }>(
                `UPDATE impacta.media AS media SET status = 'deleted'
                 WHERE media.id IN (
                     SELECT relation.media_id FROM impacta.post_media AS relation
                     WHERE relation.post_id = $1
                 ) AND media.owner_user_id = $2 AND media.status IN ('available', 'pending_scan')
                 RETURNING media.id::text AS id, media.storage_key`,
                [postId, session.userId]
            );
            return media.rows;
        });
        if (!removed) return reply.code(404).send({ error: 'post_not_found' });
        await Promise.all(removed.map(async (media) => {
            const path = postMediaStoragePath(media.storage_key);
            if (path) await unlink(path).catch(() => undefined);
        }));
        return { status: 'removed' };
    });

    server.post<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId/support', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });

        const result = await transaction(pool, async (client) => {
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtextextended('impacta:support:' || $1 || ':' || $2, 0))",
                [session.userId, postId]
            );
            const visible = await client.query(
                `SELECT post.author_user_id::text AS author_user_id
                 FROM impacta.posts AS post
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE post.id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
                   AND post.moderation_status = 'approved'
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))`,
                [postId]
            );
            const post = visible.rows[0] as { author_user_id: string | null } | undefined;
            if (!post) return null;

            const removed = await client.query(
                'DELETE FROM impacta.reactions WHERE user_id = $1 AND post_id = $2 RETURNING user_id',
                [session.userId, postId]
            );
            const supported = removed.rowCount === 0;
            if (supported) {
                await client.query(
                    "INSERT INTO impacta.reactions (user_id, post_id, reaction_type) VALUES ($1, $2, 'support') ON CONFLICT (user_id, post_id) DO NOTHING",
                    [session.userId, postId]
                );
                if (post.author_user_id && post.author_user_id !== session.userId) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         VALUES ($1, 'post_reaction', jsonb_build_object(
                             'actor_user_id', $2::text, 'post_id', $3::text
                         ))`,
                        [post.author_user_id, session.userId, postId]
                    );
                }
            }
            const count = await client.query<{ support_count: number }>(
                'SELECT count(*)::int AS support_count FROM impacta.reactions WHERE post_id = $1',
                [postId]
            );
            return { supported, supportCount: count.rows[0].support_count };
        });
        if (!result) return reply.code(404).send({ error: 'post_not_found' });
        return result;
    });

    server.post<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId/share', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });

        const result = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'share', 30)) return 'rate_limit' as const;
            const visible = await client.query<{ author_user_id: string | null }>(
                `SELECT post.author_user_id::text AS author_user_id
                 FROM impacta.posts AS post
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE post.id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
                   AND post.moderation_status = 'approved'
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))`,
                [postId]
            );
            const post = visible.rows[0];
            if (!post) return null;
            const inserted = await client.query(
                `INSERT INTO impacta.post_shares (post_id, sharer_user_id)
                 VALUES ($1, $2)
                 ON CONFLICT (post_id, sharer_user_id) DO NOTHING
                 RETURNING post_id`,
                [postId, session.userId]
            );
            if (inserted.rowCount && post.author_user_id && post.author_user_id !== session.userId) {
                await client.query(
                    `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                     VALUES ($1, 'post_share', jsonb_build_object(
                         'actor_user_id', $2::text, 'post_id', $3::text
                     ))`,
                    [post.author_user_id, session.userId, postId]
                );
            }
            return { shared: Boolean(inserted.rowCount), alreadyShared: !inserted.rowCount };
        });
        if (result === 'rate_limit') return reply.code(429).send({ error: 'share_rate_limit' });
        if (!result) return reply.code(404).send({ error: 'post_not_found' });
        return result;
    });

    server.get<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId/comments', async (request, reply) => {
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT comment.id::text AS id,
                    comment.body,
                    comment.created_at,
                    (comment.updated_at > comment.created_at) AS edited,
                    COALESCE(comment.author_user_id = $2::bigint, false) AS is_author,
                    COALESCE(author.display_name, 'Conta encerrada') AS author,
                    ${mentionJsonSql('comment')}
             FROM (
                 SELECT comment.id, comment.body, comment.created_at, comment.updated_at, comment.author_user_id
                 FROM impacta.comments AS comment
                 JOIN impacta.posts AS post ON post.id = comment.post_id
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE comment.post_id = $1 AND comment.status = 'published' AND comment.deleted_at IS NULL
                   AND post.status = 'published' AND post.deleted_at IS NULL
                   AND post.moderation_status = 'approved'
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))
                 ORDER BY comment.created_at DESC, comment.id DESC
                 LIMIT 50
             ) AS comment
             LEFT JOIN impacta.users AS author ON author.id = comment.author_user_id
             ORDER BY comment.created_at, comment.id`,
            [postId, session?.userId ?? null]
        );
        return { items: result.rows };
    });

    server.post<{ Params: { postId: string }; Body: { body?: unknown; mentionUserIds?: unknown } }>(
        '/api/v1/feed/posts/:postId/comments', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const postId = requestId(request, 'postId');
            if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
            const body = cleanText(request.body?.body, 1000);
            if (!body) return reply.code(400).send({ error: 'invalid_comment_body' });
            if (findFeedPolicyViolation(body)) return reply.code(400).send({ error: 'feed_content_not_allowed' });
            const mentionIds = mentionIdsInput(request.body?.mentionUserIds);
            if (!mentionIds) return reply.code(400).send({ error: 'invalid_mentions' });

            const comment = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'comment', 30)) return null;
                const visible = await client.query(
                    `SELECT post.author_user_id::text AS author_user_id
                     FROM impacta.posts AS post
                     LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                     WHERE post.id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
                       AND post.moderation_status = 'approved'
                       AND (post.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))`,
                    [postId]
                );
                const post = visible.rows[0] as { author_user_id: string | null } | undefined;
                if (!post) return undefined;
                const mentions = await resolveMentionTargets(client, mentionIds, body, session.userId);
                if (!mentions) return { invalidMentions: true as const };
                const inserted = await client.query<{ id: string; created_at: Date }>(
                    `INSERT INTO impacta.comments (post_id, author_user_id, body)
                     VALUES ($1, $2, $3)
                     RETURNING id::text AS id, created_at`,
                    [postId, session.userId, body]
                );
                await saveMentions(client, session.userId, inserted.rows[0].id, 'comment', mentions, true, body, postId);
                if (post.author_user_id && post.author_user_id !== session.userId
                    && !mentions.some((target) => target.id === post.author_user_id)) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         VALUES ($1, 'post_comment', jsonb_build_object(
                             'actor_user_id', $2::text,
                             'post_id', $3::text,
                             'comment_id', $4::text,
                             'excerpt', $5::text
                         ))`,
                        [post.author_user_id, session.userId, postId, inserted.rows[0].id, Array.from(body).slice(0, 180).join('')]
                    );
                }
                return { ...inserted.rows[0], mentions };
            });
            if (comment === null) return reply.code(429).send({ error: 'comment_rate_limit' });
            if (!comment) return reply.code(404).send({ error: 'post_not_found' });
            if ('invalidMentions' in comment) return reply.code(400).send({ error: 'invalid_mentions' });
            return reply.code(201).send({
                id: comment.id, body, created_at: comment.created_at,
                author: session.displayName, edited: false, is_author: true,
                mentions: comment.mentions.map((target) => ({
                    user_id: target.id, display_name: target.display_name, is_public: target.is_public
                }))
            });
        }
    );

    server.put<{ Params: { commentId: string }; Body: { body?: unknown; mentionUserIds?: unknown } }>(
        '/api/v1/feed/comments/:commentId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const commentId = requestId(request, 'commentId');
            const body = cleanText(request.body?.body, 1000);
            if (!commentId) return reply.code(400).send({ error: 'invalid_comment_id' });
            if (!body) return reply.code(400).send({ error: 'invalid_comment_body' });
            if (findFeedPolicyViolation(body)) return reply.code(400).send({ error: 'feed_content_not_allowed' });
            const mentionIds = request.body?.mentionUserIds === undefined
                ? null
                : mentionIdsInput(request.body.mentionUserIds);
            if (mentionIds === null && request.body?.mentionUserIds !== undefined) {
                return reply.code(400).send({ error: 'invalid_mentions' });
            }

            const comment = await transaction(pool, async (client) => {
                const existing = await client.query<{
                    body: string; created_at: Date; updated_at: Date;
                }>(
                    `SELECT comment.body, comment.created_at, comment.updated_at
                     FROM impacta.comments AS comment
                     JOIN impacta.posts AS post ON post.id = comment.post_id
                     WHERE comment.id = $1 AND comment.author_user_id = $2
                       AND comment.status = 'published' AND comment.deleted_at IS NULL
                       AND post.status = 'published' AND post.deleted_at IS NULL
                       AND post.moderation_status = 'approved'
                       AND (post.community_id IS NULL OR
                            EXISTS (SELECT 1 FROM impacta.communities AS community
                                    WHERE community.id = post.community_id
                                      AND community.status = 'active' AND community.visibility = 'public'))
                     FOR UPDATE OF comment`,
                    [commentId, session.userId]
                );
                const current = existing.rows[0];
                if (!current) return null;
                const mentions = mentionIds === null
                    ? null
                    : await resolveMentionTargets(client, mentionIds, body, session.userId);
                if (mentionIds !== null && !mentions) return { invalidMentions: true as const };
                let saved = current;
                if (current.body !== body) {
                    const updated = await client.query<{
                    body: string; created_at: Date; updated_at: Date;
                    }>(
                        `UPDATE impacta.comments SET body = $2, updated_at = now()
                         WHERE id = $1 AND author_user_id = $3
                         RETURNING body, created_at, updated_at`,
                        [commentId, body, session.userId]
                    );
                    if (!updated.rows[0]) return null;
                    saved = updated.rows[0];
                }
                if (mentions) {
                    await client.query('DELETE FROM impacta.content_mentions WHERE comment_id = $1', [commentId]);
                    await saveMentions(client, session.userId, commentId, 'comment', mentions, false, body);
                }
                return { ...saved, mentions };
            });
            if (!comment) return reply.code(404).send({ error: 'comment_not_found' });
            if ('invalidMentions' in comment) return reply.code(400).send({ error: 'invalid_mentions' });
            return {
                id: commentId,
                body: comment.body,
                created_at: comment.created_at,
                edited: comment.updated_at > comment.created_at,
                is_author: true,
                author: session.displayName,
                ...('mentions' in comment && comment.mentions
                    ? { mentions: comment.mentions.map((target) => ({
                        user_id: target.id, display_name: target.display_name, is_public: target.is_public
                    })) }
                    : {})
            };
        }
    );

    server.post<{ Params: { postId: string }; Body: { reasonCode?: unknown; details?: unknown } }>(
        '/api/v1/feed/posts/:postId/reports', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const postId = requestId(request, 'postId');
            const reasonCode = cleanText(request.body?.reasonCode, 40);
            const rawDetails = request.body?.details;
            const details = rawDetails === undefined || rawDetails === ''
                ? ''
                : cleanText(rawDetails, 500);
            if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
            if (!reasonCode || !['spam', 'harassment', 'harmful', 'sexual_content', 'misinformation', 'other'].includes(reasonCode)) {
                return reply.code(400).send({ error: 'invalid_report_reason' });
            }
            if (details === undefined) return reply.code(400).send({ error: 'invalid_report_details' });
            const report = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'report', 10)) return null;
                await client.query(
                    "SELECT pg_advisory_xact_lock(hashtextextended('impacta:report-escalation:post:' || $1::text, 0))",
                    [postId]
                );
                const before = await client.query<{ reporter_count: number }>(
                    `SELECT count(DISTINCT reporter_user_id)::int AS reporter_count
                     FROM impacta.content_reports
                     WHERE post_id = $1 AND status IN ('open', 'reviewing')`,
                    [postId]
                );
                const inserted = await client.query<{ id: string }>(
                `INSERT INTO impacta.content_reports (reporter_user_id, post_id, reason_code, details)
                 SELECT $1, post.id, $3, $4
                 FROM impacta.posts AS post
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE post.id = $2 AND post.status = 'published' AND post.deleted_at IS NULL
                   AND post.moderation_status = 'approved'
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))
                 RETURNING id::text AS id`,
                    [session.userId, postId, reasonCode, details]
                );
                const id = inserted.rows[0]?.id;
                if (!id) return undefined;
                const after = await client.query<{ reporter_count: number }>(
                    `SELECT count(DISTINCT reporter_user_id)::int AS reporter_count
                     FROM impacta.content_reports
                     WHERE post_id = $1 AND status IN ('open', 'reviewing')`,
                    [postId]
                );
                const beforeCount = before.rows[0]?.reporter_count ?? 0;
                const reporterCount = after.rows[0]?.reporter_count ?? 0;
                const urgent = reporterCount > 5;
                if (beforeCount <= 5 && urgent) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         SELECT DISTINCT assignment.user_id, 'urgent_post_report',
                                jsonb_build_object('postId', $1::text, 'reporterCount', $2::int)
                         FROM impacta.user_roles AS assignment
                         JOIN impacta.roles AS role ON role.id = assignment.role_id
                         JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                         JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                         JOIN impacta.users AS account ON account.id = assignment.user_id
                         WHERE assignment.scope_type = 'platform' AND assignment.scope_id IS NULL
                           AND permission.code = 'reports.manage' AND account.status = 'active'
                           AND NOT EXISTS (
                               SELECT 1 FROM impacta.notifications AS existing
                               WHERE existing.user_id = assignment.user_id
                                 AND existing.notification_type = 'urgent_post_report'
                                 AND existing.payload->>'postId' = $1::text
                           )`,
                        [postId, reporterCount]
                    );
                }
                return { id, urgent, reporterCount };
            });
            if (report === null) return reply.code(429).send({ error: 'report_rate_limit' });
            if (!report) return reply.code(404).send({ error: 'post_not_found' });
            return reply.code(201).send({
                status: 'reported',
                id: report.id,
                urgent: report.urgent,
                reporterCount: report.reporterCount
            });
        }
    );

    server.post<{ Params: { commentId: string }; Body: { reasonCode?: unknown; details?: unknown } }>(
        '/api/v1/feed/comments/:commentId/reports', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const commentId = requestId(request, 'commentId');
            const reasonCode = cleanText(request.body?.reasonCode, 40);
            const rawDetails = request.body?.details;
            const details = rawDetails === undefined || rawDetails === '' ? '' : cleanText(rawDetails, 500);
            if (!commentId) return reply.code(400).send({ error: 'invalid_comment_id' });
            if (!reasonCode || !['spam', 'harassment', 'harmful', 'sexual_content', 'misinformation', 'other'].includes(reasonCode)) {
                return reply.code(400).send({ error: 'invalid_report_reason' });
            }
            if (details === undefined) return reply.code(400).send({ error: 'invalid_report_details' });
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'report', 10)) return 'rate_limit' as const;
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO impacta.content_reports (reporter_user_id, comment_id, reason_code, details)
                     SELECT $1, comment.id, $3, $4
                     FROM impacta.comments AS comment
                     JOIN impacta.posts AS post ON post.id = comment.post_id
                     LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                     WHERE comment.id = $2 AND comment.author_user_id <> $1
                       AND comment.status = 'published' AND comment.deleted_at IS NULL
                       AND post.status = 'published' AND post.moderation_status = 'approved'
                       AND post.deleted_at IS NULL
                       AND (post.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))
                     RETURNING id::text AS id`,
                    [session.userId, commentId, reasonCode, details]
                );
                return inserted.rows[0]?.id ?? 'not_found';
            });
            if (result === 'rate_limit') return reply.code(429).send({ error: 'report_rate_limit' });
            if (result === 'not_found') return reply.code(404).send({ error: 'comment_not_found' });
            return reply.code(201).send({ status: 'reported', id: result });
        }
    );

    server.get('/api/v1/impact-areas', async () => {
        const result = await pool.query(
            `SELECT id::text AS id, name
             FROM impacta.impact_areas
             WHERE is_active
             ORDER BY name, id`
        );
        return { items: result.rows };
    });

    server.post<{ Body: {
        name?: unknown; description?: unknown; impactAreaId?: unknown;
        locationProvince?: unknown; locationMunicipality?: unknown; locationCommune?: unknown;
        locationNeighborhood?: unknown; locationCity?: unknown;
    } }>(
        '/api/v1/communities', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const name = cleanText(request.body?.name, 100);
            const description = cleanText(request.body?.description, 2000);
            const rawAreaId = request.body?.impactAreaId;
            const impactAreaId = rawAreaId === undefined || rawAreaId === null || rawAreaId === ''
                ? null
                : typeof rawAreaId === 'string' && validId(rawAreaId) ? rawAreaId : undefined;
            const locationProvince = cleanLocation(request.body?.locationProvince);
            const locationMunicipality = cleanLocation(request.body?.locationMunicipality);
            const locationCommune = cleanLocation(request.body?.locationCommune);
            const locationNeighborhood = cleanLocation(request.body?.locationNeighborhood);
            const locationCity = cleanLocation(request.body?.locationCity);
            if (!name || !description || impactAreaId === undefined
                || locationProvince === undefined || locationMunicipality === undefined
                || locationCommune === undefined || locationNeighborhood === undefined || locationCity === undefined) {
                return reply.code(400).send({ error: 'invalid_community' });
            }
            if (findFeedPolicyViolation(`${name}\n${description}`)) {
                return reply.code(422).send({ error: 'community_content_not_allowed' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'resource', 5)) return { status: 'rate_limit' as const };
                if (impactAreaId) {
                    const area = await client.query('SELECT 1 FROM impacta.impact_areas WHERE id = $1 AND is_active', [impactAreaId]);
                    if (area.rowCount === 0) return { status: 'invalid_impact_area' as const };
                }
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO impacta.communities (
                         owner_user_id, impact_area_id, name, slug, description, status, visibility,
                         location_province, location_municipality, location_commune,
                         location_neighborhood, location_city
                     ) VALUES ($1, $2, $3, $4, $5, 'pending', 'public', $6, $7, $8, $9, $10)
                     RETURNING id::text AS id`,
                    [session.userId, impactAreaId, name, communitySlug(name), description,
                        locationProvince, locationMunicipality, locationCommune, locationNeighborhood, locationCity]
                );
                return { status: 'pending_review' as const, id: inserted.rows[0].id };
            });
            if (result.status === 'rate_limit') return reply.code(429).send({ error: 'resource_rate_limit' });
            if (result.status === 'invalid_impact_area') return reply.code(400).send({ error: 'invalid_impact_area' });
            return reply.code(201).send(result);
        }
    );

    server.post<{ Body: {
        title?: unknown; description?: unknown; impactAreaId?: unknown; communityId?: unknown;
        startsAt?: unknown; endsAt?: unknown; locationCity?: unknown; locationNeighborhood?: unknown;
        locationMunicipality?: unknown; locationProvince?: unknown; locationCommune?: unknown;
    } }>(
        '/api/v1/projects', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const title = cleanText(request.body?.title, 120);
            const description = cleanText(request.body?.description, 5000);
            const rawAreaId = request.body?.impactAreaId;
            const impactAreaId = rawAreaId === undefined || rawAreaId === null || rawAreaId === ''
                ? null
                : typeof rawAreaId === 'string' && validId(rawAreaId) ? rawAreaId : undefined;
            const rawCommunityId = request.body?.communityId;
            const communityId = rawCommunityId === undefined || rawCommunityId === null || rawCommunityId === ''
                ? null
                : typeof rawCommunityId === 'string' && validId(rawCommunityId) ? rawCommunityId : undefined;
            const startsAt = cleanDate(request.body?.startsAt);
            const endsAt = cleanDate(request.body?.endsAt);
            const locationCity = optionalLocation(request.body?.locationCity, 100);
            const locationNeighborhood = optionalLocation(request.body?.locationNeighborhood, 100);
            const locationMunicipality = optionalLocation(request.body?.locationMunicipality, 100);
            const locationProvince = optionalLocation(request.body?.locationProvince, 100);
            const locationCommune = optionalLocation(request.body?.locationCommune, 100);
            if (!title || !description || impactAreaId === undefined || communityId === undefined
                || startsAt === undefined || endsAt === undefined
                || locationCity === undefined || locationNeighborhood === undefined
                || locationMunicipality === undefined || locationProvince === undefined || locationCommune === undefined
                || (startsAt && endsAt && endsAt < startsAt)) {
                return reply.code(400).send({ error: 'invalid_project' });
            }
            if (findFeedPolicyViolation(`${title}\n${description}`)) {
                return reply.code(422).send({ error: 'feed_content_not_allowed' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'resource', 5)) return { status: 'rate_limit' as const };
                if (impactAreaId) {
                    const area = await client.query('SELECT 1 FROM impacta.impact_areas WHERE id = $1 AND is_active', [impactAreaId]);
                    if (area.rowCount === 0) return { status: 'invalid_impact_area' as const };
                }
                if (communityId) {
                    const membership = await client.query(
                        `SELECT 1 FROM impacta.communities AS community
                         JOIN impacta.community_members AS membership ON membership.community_id = community.id
                         WHERE community.id = $1 AND community.status = 'active' AND community.visibility = 'public'
                           AND membership.user_id = $2 AND membership.status = 'active'`,
                        [communityId, session.userId]
                    );
                    if (membership.rowCount === 0) return { status: 'community_membership_required' as const };
                }
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO impacta.projects (
                         community_id, owner_user_id, impact_area_id, title, description, status, starts_at, ends_at,
                         location_city, location_neighborhood, location_municipality, location_province, location_commune
                     )
                     VALUES ($1, $2, $3, $4, $5, 'review',
                             $6::date::timestamp AT TIME ZONE 'Africa/Luanda',
                             CASE WHEN $7::date IS NULL THEN NULL
                                  ELSE ($7::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda' END,
                             $8, $9, $10, $11, $12)
                     RETURNING id::text AS id`,
                    [communityId, session.userId, impactAreaId, title, description, startsAt, endsAt,
                        locationCity, locationNeighborhood, locationMunicipality, locationProvince, locationCommune]
                );
                return { status: 'pending_review' as const, id: inserted.rows[0].id };
            });
            if (result.status === 'rate_limit') return reply.code(429).send({ error: 'resource_rate_limit' });
            if (result.status === 'invalid_impact_area') return reply.code(400).send({ error: 'invalid_impact_area' });
            if (result.status === 'community_membership_required') return reply.code(403).send({ error: 'community_membership_required' });
            return reply.code(201).send(result);
        }
    );

    server.put<{ Params: { projectId: string }; Body: {
        title?: unknown; description?: unknown; impactAreaId?: unknown;
        startsAt?: unknown; endsAt?: unknown; locationCity?: unknown; locationNeighborhood?: unknown;
        locationMunicipality?: unknown; locationProvince?: unknown; locationCommune?: unknown;
    } }>(
        '/api/v1/projects/:projectId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const projectId = requestId(request, 'projectId');
            const title = cleanText(request.body?.title, 120);
            const description = cleanText(request.body?.description, 5000);
            const rawAreaId = request.body?.impactAreaId;
            const impactAreaId = rawAreaId === undefined || rawAreaId === null || rawAreaId === ''
                ? null
                : typeof rawAreaId === 'string' && validId(rawAreaId) ? rawAreaId : undefined;
            const startsAt = cleanDate(request.body?.startsAt);
            const endsAt = cleanDate(request.body?.endsAt);
            const locationCity = optionalLocation(request.body?.locationCity, 100);
            const locationNeighborhood = optionalLocation(request.body?.locationNeighborhood, 100);
            const locationMunicipality = optionalLocation(request.body?.locationMunicipality, 100);
            const locationProvince = optionalLocation(request.body?.locationProvince, 100);
            const locationCommune = optionalLocation(request.body?.locationCommune, 100);
            if (!projectId || !title || !description || impactAreaId === undefined
                || startsAt === undefined || endsAt === undefined
                || locationCity === undefined || locationNeighborhood === undefined
                || locationMunicipality === undefined || locationProvince === undefined || locationCommune === undefined
                || (startsAt && endsAt && endsAt < startsAt)) {
                return reply.code(400).send({ error: 'invalid_project' });
            }
            if (findFeedPolicyViolation(`${title}\n${description}`)) {
                return reply.code(422).send({ error: 'feed_content_not_allowed' });
            }

            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'project_edit', 10)) return { status: 'rate_limit' as const };
                const owned = await client.query(
                    `SELECT id FROM impacta.projects
                     WHERE id = $1 AND owner_user_id = $2 AND status IN ('review', 'active', 'rejected')
                     FOR UPDATE`,
                    [projectId, session.userId]
                );
                if (owned.rowCount === 0) return { status: 'not_found' as const };
                if (impactAreaId) {
                    const area = await client.query('SELECT 1 FROM impacta.impact_areas WHERE id = $1 AND is_active', [impactAreaId]);
                    if (area.rowCount === 0) return { status: 'invalid_impact_area' as const };
                }
                await client.query(
                    `UPDATE impacta.projects
                     SET impact_area_id = $3, title = $4, description = $5, status = 'review',
                         starts_at = $6::date::timestamp AT TIME ZONE 'Africa/Luanda',
                         ends_at = CASE WHEN $7::date IS NULL THEN NULL
                                        ELSE ($7::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda' END,
                         location_city = $8, location_neighborhood = $9,
                         location_municipality = $10, location_province = $11, location_commune = $12,
                         updated_at = now(), reviewed_at = NULL, reviewed_by_user_id = NULL, review_reason = NULL
                     WHERE id = $1 AND owner_user_id = $2`,
                    [projectId, session.userId, impactAreaId, title, description, startsAt, endsAt,
                        locationCity, locationNeighborhood, locationMunicipality, locationProvince, locationCommune]
                );
                return { status: 'pending_review' as const, id: projectId };
            });
            if (result.status === 'rate_limit') return reply.code(429).send({ error: 'project_edit_rate_limit' });
            if (result.status === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
            if (result.status === 'invalid_impact_area') return reply.code(400).send({ error: 'invalid_impact_area' });
            return result;
        }
    );

    server.get<{ Querystring: { impactAreaId?: string; location?: string; offset?: string } }>('/api/v1/challenges', async (request, reply) => {
        const areaId = request.query.impactAreaId?.trim() || null;
        if (areaId && !validId(areaId)) return reply.code(400).send({ error: 'invalid_impact_area' });
        const location = cleanLocationFilter(request.query.location);
        if (location === undefined) return reply.code(400).send({ error: 'invalid_location_filter' });
        const offset = resourceOffset(request.query.offset);
        if (offset === null) return reply.code(400).send({ error: 'invalid_resource_offset' });
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT challenge.id::text AS id,
                    challenge.title,
                    challenge.description,
                    challenge.status,
                    to_char(challenge.opens_at AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD') AS opens_at,
                    CASE WHEN challenge.closes_at IS NULL THEN NULL
                         ELSE to_char((challenge.closes_at - interval '1 millisecond') AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD')
                    END AS closes_at,
                    area.name AS impact_area,
                    project.location_city,
                    project.location_neighborhood,
                    project.location_municipality,
                    project.location_commune,
                    project.location_province,
                    (challenge.status IN ('open', 'draft')
                     AND (challenge.opens_at IS NULL OR challenge.opens_at <= now())
                     AND (challenge.closes_at IS NULL OR challenge.closes_at > now())) AS can_participate,
                    (SELECT mine.status FROM impacta.challenge_participations AS mine
                     WHERE mine.challenge_id = challenge.id AND mine.user_id = $1::bigint) AS viewer_participation_status,
                    EXISTS (SELECT 1 FROM impacta.challenge_participations AS mine
                            WHERE mine.challenge_id = challenge.id AND mine.user_id = $1::bigint
                              AND mine.status IN ('submitted', 'approved')) AS viewer_participates,
                    (SELECT count(participation.id)::int FROM impacta.challenge_participations AS participation
                     WHERE participation.challenge_id = challenge.id
                       AND participation.status IN ('submitted', 'approved')) AS participant_count
             FROM impacta.challenges AS challenge
             LEFT JOIN impacta.projects AS project ON project.id = challenge.project_id
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE (challenge.status = 'open'
                    OR (challenge.status = 'draft' AND challenge.opens_at IS NOT NULL))
               AND (challenge.project_id IS NULL OR (project.status = 'active' AND (project.ends_at IS NULL OR project.ends_at >= now())))
               AND (challenge.closes_at IS NULL OR challenge.closes_at > now())
               AND ($2::bigint IS NULL OR project.impact_area_id = $2::bigint)
               AND ($3::text IS NULL OR concat_ws(' ', project.location_city,
                    project.location_neighborhood, project.location_commune,
                    project.location_municipality, project.location_province) ILIKE '%' || $3 || '%')
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY challenge.opens_at NULLS FIRST, challenge.id DESC
             LIMIT 31 OFFSET $4`,
            [session?.userId ?? null, areaId, location, offset]
        );
        return { items: result.rows.slice(0, 30), hasMore: result.rows.length > 30 };
    });

    server.post<{ Params: { challengeId: string }; Body: { submission?: unknown } }>(
        '/api/v1/challenges/:challengeId/participations', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const challengeId = requestId(request, 'challengeId');
            const submission = cleanText(request.body?.submission, 2000);
            if (!challengeId) return reply.code(400).send({ error: 'invalid_challenge_id' });
            if (!submission) return reply.code(400).send({ error: 'invalid_submission' });
            if (findFeedPolicyViolation(submission)) return reply.code(422).send({ error: 'feed_content_not_allowed' });

            const status = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'challenge', 10)) return 'rate_limit';
                const open = await client.query<{ project_id: string | null }>(
                    `SELECT challenge.project_id::text AS project_id FROM impacta.challenges AS challenge
                     LEFT JOIN impacta.projects AS project ON project.id = challenge.project_id
                     LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                     WHERE challenge.id = $1
                       AND (challenge.status = 'open'
                            OR (challenge.status = 'draft' AND challenge.opens_at IS NOT NULL))
                       AND (challenge.opens_at IS NULL OR challenge.opens_at <= now())
                       AND (challenge.closes_at IS NULL OR challenge.closes_at > now())
                       AND (challenge.project_id IS NULL OR (project.status = 'active' AND (project.ends_at IS NULL OR project.ends_at >= now())))
                       AND (project.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))`,
                    [challengeId]
                );
                if (open.rowCount === 0) return 'not_found';
                const inserted = await client.query(
                    `INSERT INTO impacta.challenge_participations AS existing (challenge_id, user_id, submission)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (challenge_id, user_id) DO UPDATE
                     SET submission = EXCLUDED.submission, status = 'submitted', submitted_at = now(),
                         reviewed_by_user_id = NULL, reviewed_at = NULL, review_reason = NULL
                     WHERE existing.status IN ('rejected', 'withdrawn')
                     RETURNING id`,
                    [challengeId, session.userId, submission]
                );
                if (!inserted.rowCount) return 'already_participating';
                const projectId = open.rows[0]?.project_id;
                if (projectId) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         SELECT DISTINCT recipient.user_id, 'project_challenge_submission',
                                jsonb_build_object('actor_user_id', $2::text, 'project_id', $1::text,
                                                   'challenge_id', $3::text)
                         FROM (
                             SELECT project.owner_user_id AS user_id
                             FROM impacta.projects AS project
                             WHERE project.id = $1 AND project.owner_user_id IS NOT NULL
                             UNION
                             SELECT community.owner_user_id AS user_id
                             FROM impacta.projects AS project
                             JOIN impacta.communities AS community ON community.id = project.community_id
                             WHERE project.id = $1 AND community.owner_user_id IS NOT NULL
                         ) AS recipient
                         WHERE recipient.user_id <> $2::bigint`,
                        [projectId, session.userId, challengeId]
                    );
                }
                return 'submitted';
            }).catch((error: unknown) => {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
                    return 'already_participating';
                }
                throw error;
            });
            if (status === 'rate_limit') return reply.code(429).send({ error: 'challenge_rate_limit' });
            if (status === 'not_found') return reply.code(404).send({ error: 'challenge_not_found' });
            if (status === 'already_participating') return reply.code(409).send({ error: 'already_participating' });
            return reply.code(201).send({ status });
        }
    );

    server.get<{ Querystring: { impactAreaId?: string; location?: string; offset?: string; mine?: string; projectId?: string } }>('/api/v1/projects', async (request, reply) => {
        const areaId = request.query.impactAreaId?.trim() || null;
        if (areaId && !validId(areaId)) return reply.code(400).send({ error: 'invalid_impact_area' });
        const location = cleanLocationFilter(request.query.location);
        if (location === undefined) return reply.code(400).send({ error: 'invalid_location_filter' });
        const offset = resourceOffset(request.query.offset);
        if (offset === null) return reply.code(400).send({ error: 'invalid_resource_offset' });
        if (request.query.mine !== undefined && request.query.mine !== 'true' && request.query.mine !== 'false') {
            return reply.code(400).send({ error: 'invalid_project_scope' });
        }
        const mineOnly = request.query.mine === 'true';
        const projectId = request.query.projectId?.trim() || null;
        if (projectId && !validId(projectId)) return reply.code(400).send({ error: 'invalid_project_id' });
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT project.id::text AS id,
                    project.title,
                    project.description,
                    to_char(project.starts_at AT TIME ZONE 'Africa/Luanda', 'YYYY-MM-DD') AS starts_at,
                    (project.starts_at > now()) AS is_upcoming,
                    project.status,
                    (project.status = 'active' AND (project.ends_at IS NULL OR project.ends_at >= now())) AS registration_open,
                    area.name AS impact_area,
                    community.name AS community,
                    COALESCE(project_owner.display_name, community_owner.display_name) AS moderator_name,
                    project.location_city,
                    project.location_neighborhood,
                    project.location_municipality,
                    project.location_province,
                    project.location_commune,
                    (project.owner_user_id = $1::bigint OR community.owner_user_id = $1::bigint OR EXISTS (
                        SELECT 1 FROM impacta.project_members AS mine
                        WHERE mine.project_id = project.id AND mine.user_id = $1::bigint
                    )) AS viewer_participates,
                    (project.owner_user_id = $1::bigint OR community.owner_user_id = $1::bigint OR EXISTS (
                        SELECT 1 FROM impacta.project_members AS mine
                        WHERE mine.project_id = project.id AND mine.user_id = $1::bigint
                    ) OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1::bigint
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    )) AS viewer_can_chat,
                    (project.owner_user_id = $1::bigint OR community.owner_user_id = $1::bigint OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1::bigint
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    ) OR EXISTS (
                        SELECT 1 FROM impacta.user_roles AS assignment
                        JOIN impacta.roles AS role ON role.id = assignment.role_id
                        JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                        JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                        WHERE assignment.user_id = $1::bigint AND permission.code = 'projects.review'
                          AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                            OR (assignment.scope_type = 'community' AND assignment.scope_id = community.id))
                    )) AS viewer_can_manage,
                    (project.owner_user_id = $1::bigint OR community.owner_user_id = $1::bigint OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1::bigint
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    )) AS viewer_is_moderator,
                    (SELECT count(member.project_id)::int FROM impacta.project_members AS member
                     WHERE member.project_id = project.id AND member.membership_role = 'contributor') AS participant_count
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.users AS project_owner ON project_owner.id = project.owner_user_id
             LEFT JOIN impacta.users AS community_owner ON community_owner.id = community.owner_user_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE project.status IN ('active', 'completed')
               AND (project.status = 'completed' OR project.ends_at IS NULL OR project.ends_at >= now())
               AND ($2::bigint IS NULL OR project.impact_area_id = $2::bigint)
                AND ($6::bigint IS NULL OR project.id = $6::bigint)
               AND ($3::text IS NULL OR concat_ws(' ', project.location_city,
                    project.location_neighborhood, project.location_commune,
                    project.location_municipality, project.location_province) ILIKE '%' || $3 || '%')
               AND (NOT $4::boolean OR project.owner_user_id = $1::bigint OR community.owner_user_id = $1::bigint
                    OR EXISTS (SELECT 1 FROM impacta.project_members AS mine
                               WHERE mine.project_id = project.id AND mine.user_id = $1::bigint)
                    OR EXISTS (SELECT 1 FROM impacta.community_members AS manager
                               WHERE manager.community_id = community.id AND manager.user_id = $1::bigint
                                 AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator'))
                    OR EXISTS (SELECT 1 FROM impacta.user_roles AS assignment
                               JOIN impacta.roles AS role ON role.id = assignment.role_id
                               JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                               JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                               WHERE assignment.user_id = $1::bigint AND permission.code = 'projects.review'
                                 AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                                   OR (assignment.scope_type = 'community' AND assignment.scope_id = community.id))))
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY (project.status = 'completed') ASC, project.created_at DESC, project.id DESC
             LIMIT 31 OFFSET $5`,
            [session?.userId ?? null, areaId, location, mineOnly, offset, projectId]
        );
        return { items: result.rows.slice(0, 30), hasMore: result.rows.length > 30 };
    });

    server.post<{ Params: { projectId: string }; Body: { title?: unknown; description?: unknown; opensAt?: unknown; closesAt?: unknown } }>(
        '/api/v1/projects/:projectId/challenges', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const projectId = requestId(request, 'projectId');
            const title = cleanText(request.body?.title, 120);
            const description = cleanText(request.body?.description, 3000);
            const opensAt = cleanDate(request.body?.opensAt);
            const closesAt = cleanDate(request.body?.closesAt);
            if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
            if (!title || !description || opensAt === undefined || closesAt === undefined || (opensAt && closesAt && closesAt < opensAt)) {
                return reply.code(400).send({ error: 'invalid_challenge' });
            }
            if (findFeedPolicyViolation(`${title}\n${description}`)) {
                return reply.code(422).send({ error: 'feed_content_not_allowed' });
            }
            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'challenge_create', 5)) return { status: 'rate_limit' as const };
                const manageable = await client.query<{ registration_open: boolean; challenge_schedule_open: boolean }>(
                    `SELECT (project.ends_at IS NULL OR project.ends_at >= now()) AS registration_open,
                            (project.ends_at IS NULL OR
                             (COALESCE($3::date::timestamp AT TIME ZONE 'Africa/Luanda', now()) < project.ends_at
                              AND ($4::date IS NULL OR
                                   (($4::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda') <= project.ends_at))) AS challenge_schedule_open
                     FROM impacta.projects AS project
                     LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                     WHERE project.id = $1 AND project.status = 'active'
                       AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                       AND (project.owner_user_id = $2 OR community.owner_user_id = $2 OR EXISTS (
                           SELECT 1 FROM impacta.community_members AS manager
                           WHERE manager.community_id = community.id AND manager.user_id = $2
                             AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                       ) OR EXISTS (
                           SELECT 1 FROM impacta.user_roles AS assignment
                           JOIN impacta.roles AS role ON role.id = assignment.role_id
                           JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                           JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                           WHERE assignment.user_id = $2 AND permission.code = 'projects.review'
                             AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                               OR (assignment.scope_type = 'community' AND assignment.scope_id = community.id))
                       ))`,
                    [projectId, session.userId, opensAt, closesAt]
                );
                if (manageable.rowCount === 0) return { status: 'project_not_manageable' as const };
                if (!manageable.rows[0].registration_open) return { status: 'project_closed' as const };
                if (!manageable.rows[0].challenge_schedule_open) return { status: 'challenge_dates_outside_project' as const };
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO impacta.challenges (project_id, created_by_user_id, title, description, status, opens_at, closes_at)
                     VALUES ($1, $2, $3, $4, 'open',
                             COALESCE($5::date::timestamp AT TIME ZONE 'Africa/Luanda', now()),
                             CASE WHEN $6::date IS NULL THEN NULL
                                  ELSE ($6::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda' END)
                     RETURNING id::text AS id`,
                    [projectId, session.userId, title, description, opensAt, closesAt]
                );
                await client.query(
                    `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                     SELECT DISTINCT recipient.user_id, 'project_challenge_created',
                            jsonb_build_object('actor_user_id', $2::text, 'project_id', $1::text,
                                               'challenge_id', $3::text)
                     FROM (
                         SELECT member.user_id
                         FROM impacta.project_members AS member
                         WHERE member.project_id = $1
                         UNION
                         SELECT project.owner_user_id AS user_id
                         FROM impacta.projects AS project
                         WHERE project.id = $1 AND project.owner_user_id IS NOT NULL
                         UNION
                         SELECT community.owner_user_id AS user_id
                         FROM impacta.projects AS project
                         JOIN impacta.communities AS community ON community.id = project.community_id
                         WHERE project.id = $1 AND community.owner_user_id IS NOT NULL
                     ) AS recipient
                     WHERE recipient.user_id <> $2::bigint`,
                    [projectId, session.userId, inserted.rows[0].id]
                );
                return { status: 'open' as const, id: inserted.rows[0].id };
            });
            if (result.status === 'rate_limit') return reply.code(429).send({ error: 'challenge_create_rate_limit' });
            if (result.status === 'project_not_manageable') return reply.code(403).send({ error: 'project_management_required' });
            if (result.status === 'project_closed') return reply.code(409).send({ error: 'project_not_open' });
            if (result.status === 'challenge_dates_outside_project') return reply.code(400).send({ error: 'challenge_dates_outside_project' });
            return reply.code(201).send(result);
        }
    );

    server.post<{ Params: { projectId: string } }>('/api/v1/projects/:projectId/members', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = requestId(request, 'projectId');
        if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
        try {
            const result = await transaction(pool, async (client) => {
                const project = await client.query(
                    `SELECT project.status,
                            (project.ends_at IS NULL OR project.ends_at >= now()) AS registration_open,
                            (project.community_id IS NULL OR
                             (community.status = 'active' AND community.visibility = 'public')) AS community_available
                     FROM impacta.projects AS project
                     LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                     WHERE project.id = $1`,
                    [projectId]
                );
                const currentProject = project.rows[0] as {
                    status: string;
                    registration_open: boolean;
                    community_available: boolean;
                } | undefined;
                if (!currentProject) return 'not_found' as const;
                if (currentProject.status !== 'active' || !currentProject.registration_open) return 'closed' as const;
                if (!currentProject.community_available) return 'community_unavailable' as const;
                const joined = await client.query(
                    `INSERT INTO impacta.project_members (project_id, user_id, membership_role)
                     VALUES ($1, $2, 'contributor')
                     ON CONFLICT (project_id, user_id) DO NOTHING
                     RETURNING project_id`,
                    [projectId, session.userId]
                );
                if (joined.rowCount) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         SELECT DISTINCT recipient.user_id, 'project_member_joined',
                                jsonb_build_object('actor_user_id', $2::text, 'project_id', $1::text)
                         FROM (
                             SELECT project.owner_user_id AS user_id
                             FROM impacta.projects AS project
                             WHERE project.id = $1 AND project.owner_user_id IS NOT NULL
                             UNION
                             SELECT community.owner_user_id AS user_id
                             FROM impacta.projects AS project
                             JOIN impacta.communities AS community ON community.id = project.community_id
                             WHERE project.id = $1 AND community.owner_user_id IS NOT NULL
                         ) AS recipient
                         WHERE recipient.user_id <> $2::bigint`,
                        [projectId, session.userId]
                    );
                }
                return joined.rowCount ? 'joined' as const : 'already_member' as const;
            });
            if (result === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
            if (result === 'closed') return reply.code(409).send({ error: 'project_not_open' });
            if (result === 'community_unavailable') return reply.code(409).send({ error: 'project_community_unavailable' });
            return { status: result };
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code)
                : '';
            if (code === '42501') {
                request.log.error({ event: 'project_membership_permissions_missing', requestId: request.id },
                    'The application role cannot create project memberships');
                return reply.code(503).send({ error: 'project_membership_setup_required' });
            }
            throw error;
        }
    });

    server.get<{ Params: { projectId: string }; Querystring: { before?: string } }>(
        '/api/v1/projects/:projectId/challenge-participations', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const projectId = requestId(request, 'projectId');
            if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
            const before = request.query.before?.trim() || null;
            if (before && !validId(before)) return reply.code(400).send({ error: 'invalid_project_participation_cursor' });
            const manageable = await pool.query(
                `SELECT project.id
                 FROM impacta.projects AS project
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 WHERE project.id = $1 AND project.status IN ('active', 'completed')
                   AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                   AND (project.owner_user_id = $2::bigint OR community.owner_user_id = $2::bigint OR EXISTS (
                       SELECT 1 FROM impacta.community_members AS manager
                       WHERE manager.community_id = community.id AND manager.user_id = $2::bigint
                         AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                   ) OR EXISTS (
                       SELECT 1 FROM impacta.user_roles AS assignment
                       JOIN impacta.roles AS role ON role.id = assignment.role_id
                       JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                       JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                       WHERE assignment.user_id = $2::bigint AND permission.code = 'projects.review'
                         AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                           OR (assignment.scope_type = 'community' AND assignment.scope_id = community.id))
                   ))`,
                [projectId, session.userId]
            );
            if (!manageable.rowCount) return reply.code(404).send({ error: 'project_review_required' });
            const result = await pool.query(
                `SELECT participation.id::text AS id, participation.user_id::text AS user_id,
                        participation.status, participation.submission,
                        participation.submitted_at, participation.reviewed_at, participation.review_reason,
                        challenge.id::text AS challenge_id, challenge.title AS challenge_title,
                        account.display_name
                 FROM impacta.challenge_participations AS participation
                 JOIN impacta.challenges AS challenge ON challenge.id = participation.challenge_id
                 JOIN impacta.users AS account ON account.id = participation.user_id AND account.status = 'active'
                 WHERE challenge.project_id = $1 AND ($2::bigint IS NULL OR participation.id < $2::bigint)
                 ORDER BY participation.id DESC
                 LIMIT 101`,
                [projectId, before]
            );
            const items = result.rows.slice(0, 100);
            return { items, hasMore: result.rows.length > 100, nextBefore: items.at(-1)?.id ?? null };
        }
    );

    server.post<{
        Params: { projectId: string; participationId: string };
        Body: { decision?: unknown };
    }>('/api/v1/projects/:projectId/challenge-participations/:participationId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = requestId(request, 'projectId');
        const participationId = requestId(request, 'participationId');
        const decision = request.body?.decision;
        if (!projectId || !participationId || (decision !== 'approve' && decision !== 'reject')) {
            return reply.code(400).send({ error: 'invalid_challenge_participation_decision' });
        }
        const outcome = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'challenge_review', 60)) return 'rate_limit' as const;
            const participation = await client.query<{ id: string; challenge_id: string; user_id: string; status: string }>(
                `SELECT participation.id::text AS id, challenge.id::text AS challenge_id,
                        participation.user_id::text AS user_id,
                        participation.status, challenge.title AS challenge_title
                 FROM impacta.challenge_participations AS participation
                 JOIN impacta.challenges AS challenge ON challenge.id = participation.challenge_id
                 JOIN impacta.projects AS project ON project.id = challenge.project_id
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 WHERE participation.id = $1 AND project.id = $2
                   AND project.status IN ('active', 'completed')
                   AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
                   AND (project.owner_user_id = $3::bigint OR community.owner_user_id = $3::bigint OR EXISTS (
                       SELECT 1 FROM impacta.community_members AS manager
                       WHERE manager.community_id = community.id AND manager.user_id = $3::bigint
                         AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                   ) OR EXISTS (
                       SELECT 1 FROM impacta.user_roles AS assignment
                       JOIN impacta.roles AS role ON role.id = assignment.role_id
                       JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                       JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                       WHERE assignment.user_id = $3::bigint AND permission.code = 'projects.review'
                         AND ((assignment.scope_type = 'platform' AND assignment.scope_id IS NULL)
                           OR (assignment.scope_type = 'community' AND assignment.scope_id = community.id))
                   ))
                 FOR UPDATE OF participation`,
                [participationId, projectId, session.userId]
            );
            const item = participation.rows[0];
            if (!item) return 'not_found' as const;
            if (item.user_id === session.userId) return 'own_participation' as const;
            if (item.status !== 'submitted') return 'already_reviewed' as const;
            const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
            await client.query(
                `UPDATE impacta.challenge_participations
                 SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), review_reason = NULL
                 WHERE id = $1`,
                [participationId, nextStatus, session.userId]
            );
            await client.query(
                `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                 VALUES ($1, 'project_challenge_participation_reviewed',
                         jsonb_build_object('actor_user_id', $2::text, 'project_id', $3::text,
                                            'challenge_id', $4::text, 'decision', $5::text))`,
                [item.user_id, session.userId, projectId, item.challenge_id, decision]
            );
            return nextStatus as 'approved' | 'rejected';
        });
        if (outcome === 'rate_limit') return reply.code(429).send({ error: 'challenge_review_rate_limit' });
        if (outcome === 'not_found') return reply.code(404).send({ error: 'project_participation_not_found' });
        if (outcome === 'own_participation') return reply.code(403).send({ error: 'cannot_review_own_participation' });
        if (outcome === 'already_reviewed') return reply.code(409).send({ error: 'challenge_participation_already_reviewed' });
        return { status: outcome };
    });

    server.get<{ Querystring: { impactAreaId?: string; location?: string; communityId?: string; offset?: string } }>('/api/v1/communities', async (request, reply) => {
        const areaId = request.query.impactAreaId?.trim() || null;
        if (areaId && !validId(areaId)) return reply.code(400).send({ error: 'invalid_impact_area' });
        const location = cleanLocationFilter(request.query.location);
        if (location === undefined) return reply.code(400).send({ error: 'invalid_location_filter' });
        const communityId = request.query.communityId?.trim() || null;
        if (communityId && !validId(communityId)) return reply.code(400).send({ error: 'invalid_community_id' });
        const offset = resourceOffset(request.query.offset);
        if (offset === null) return reply.code(400).send({ error: 'invalid_resource_offset' });
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT community.id::text AS id,
                    community.name,
                    community.slug,
                    community.description,
                    community.location_province,
                    community.location_municipality,
                    community.location_commune,
                    community.location_neighborhood,
                    community.location_city,
                    community.status AS community_status,
                    area.name AS impact_area,
                    owner.display_name AS moderator_name,
                    community.owner_user_id = $1::bigint AS viewer_is_owner,
                    (community.owner_user_id = $1::bigint OR EXISTS (
                        SELECT 1 FROM impacta.community_members AS manager
                        WHERE manager.community_id = community.id AND manager.user_id = $1::bigint
                          AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                    )) AS viewer_is_moderator,
                    EXISTS (SELECT 1 FROM impacta.community_members AS mine
                            WHERE mine.community_id = community.id AND mine.user_id = $1::bigint
                              AND mine.status = 'active') AS viewer_member,
                    EXISTS (SELECT 1 FROM impacta.community_members AS request
                            WHERE request.community_id = community.id AND request.user_id = $1::bigint
                              AND request.status = 'pending') AS viewer_request_pending,
                    EXISTS (
                        SELECT 1 FROM impacta.user_roles AS assignment
                        JOIN impacta.roles AS role ON role.id = assignment.role_id
                        JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                        JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                        WHERE assignment.user_id = $1::bigint AND assignment.scope_type = 'platform'
                      AND assignment.scope_id IS NULL
                      AND permission.code IN ('communities.manage', 'content.moderate', 'reports.manage')
                    ) AS viewer_is_platform_admin,
                    (SELECT count(member.user_id)::int FROM impacta.community_members AS member
                     WHERE member.community_id = community.id AND member.status = 'active') AS member_count,
                    CASE WHEN community.owner_user_id = $1::bigint THEN
                        (SELECT count(request.user_id)::int FROM impacta.community_members AS request
                         WHERE request.community_id = community.id AND request.status = 'pending')
                    ELSE 0 END AS pending_request_count
             FROM impacta.communities AS community
             LEFT JOIN impacta.impact_areas AS area ON area.id = community.impact_area_id
             LEFT JOIN impacta.users AS owner ON owner.id = community.owner_user_id
             WHERE (community.status = 'active' OR (community.status IN ('suspended', 'archived') AND EXISTS (
                   SELECT 1 FROM impacta.user_roles AS assignment
                   JOIN impacta.roles AS role ON role.id = assignment.role_id
                   JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                   JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                   WHERE assignment.user_id = $1::bigint AND assignment.scope_type = 'platform'
                     AND assignment.scope_id IS NULL
                     AND permission.code IN ('communities.manage', 'content.moderate', 'reports.manage')
             )))
               AND ($2::bigint IS NULL OR community.impact_area_id = $2::bigint)
               AND ($3::text IS NULL OR concat_ws(' ', community.location_city,
                    community.location_neighborhood, community.location_commune,
                    community.location_municipality, community.location_province) ILIKE '%' || $3 || '%')
               AND ($4::bigint IS NULL OR community.id = $4::bigint)
               AND (community.visibility = 'public' OR EXISTS (
                   SELECT 1 FROM impacta.user_roles AS assignment
                   JOIN impacta.roles AS role ON role.id = assignment.role_id
                   JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                   JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                   WHERE assignment.user_id = $1::bigint AND assignment.scope_type = 'platform'
                     AND assignment.scope_id IS NULL
                     AND permission.code IN ('communities.manage', 'content.moderate', 'reports.manage')
               ))
             ORDER BY community.name, community.id
             LIMIT 31 OFFSET $5`,
            [session?.userId ?? null, areaId, location, communityId, offset]
        );
        return { items: result.rows.slice(0, 30), hasMore: result.rows.length > 30 };
    });

    server.post<{ Params: { communityId: string }; Body: { messageId?: unknown; reasonCode?: unknown; details?: unknown } }>(
        '/api/v1/communities/:communityId/reports', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            const rawMessageId = request.body?.messageId;
            const messageId = rawMessageId === undefined || rawMessageId === null || rawMessageId === ''
                ? null
                : typeof rawMessageId === 'string' && validId(rawMessageId) ? rawMessageId : undefined;
            const reasonCode = typeof request.body?.reasonCode === 'string' ? request.body.reasonCode : '';
            const details = request.body?.details === undefined ? ''
                : typeof request.body.details === 'string' ? request.body.details.trim() : undefined;
            const allowedReasons = new Set([
                'adult_sexual_content', 'sexual_exploitation', 'harassment', 'hate',
                'threats_violence', 'spam_scam', 'illegal_activity', 'privacy', 'other'
            ]);
            if (!communityId || messageId === undefined || !allowedReasons.has(reasonCode)
                || details === undefined || Array.from(details).length > 1000 || details.includes('\u0000')) {
                return reply.code(400).send({ error: 'invalid_community_report' });
            }

            const result = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'community_report', 10)) return 'rate_limit' as const;
                await client.query(
                    "SELECT pg_advisory_xact_lock(hashtextextended('impacta:community-report:' || $1 || ':' || COALESCE($2, 'group') || ':' || $3, 0))",
                    [communityId, messageId, session.userId]
                );
                const community = await client.query(
                    `SELECT community.id FROM impacta.communities AS community
                     WHERE community.id = $1 AND community.status = 'active'
                       AND (community.visibility = 'public' OR EXISTS (
                           SELECT 1 FROM impacta.community_members AS member
                           WHERE member.community_id = community.id AND member.user_id = $2 AND member.status = 'active'
                       ))`,
                    [communityId, session.userId]
                );
                if (!community.rowCount) return 'not_found' as const;
                if (messageId) {
                    const message = await client.query<{ author_user_id: string }>(
                        `SELECT author_user_id::text AS author_user_id
                         FROM impacta.community_messages
                         WHERE id = $1 AND community_id = $2 AND deleted_at IS NULL`,
                        [messageId, communityId]
                    );
                    if (!message.rows[0]) return 'message_not_found' as const;
                    if (message.rows[0].author_user_id === session.userId) return 'own_message' as const;
                }
                const existing = await client.query(
                    `SELECT id FROM impacta.community_reports
                     WHERE reporter_user_id = $1 AND community_id = $2
                       AND message_id IS NOT DISTINCT FROM $3::bigint AND status IN ('open', 'reviewing')`,
                    [session.userId, communityId, messageId]
                );
                if (existing.rowCount) return 'already_reported' as const;
                await client.query(
                    `INSERT INTO impacta.community_reports
                        (reporter_user_id, community_id, message_id, reason_code, details)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [session.userId, communityId, messageId, reasonCode, details]
                );
                return 'reported' as const;
            });
            if (result === 'rate_limit') return reply.code(429).send({ error: 'community_report_rate_limit' });
            if (result === 'not_found' || result === 'message_not_found') return reply.code(404).send({ error: 'community_report_target_not_found' });
            if (result === 'own_message') return reply.code(400).send({ error: 'cannot_report_own_message' });
            if (result === 'already_reported') return reply.code(409).send({ error: result });
            return reply.code(201).send({ status: result });
        }
    );

    server.post<{ Params: { communityId: string } }>('/api/v1/communities/:communityId/members', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const communityId = requestId(request, 'communityId');
        if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
        const result = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'community_join', 10)) return 'rate_limit' as const;
            const community = await client.query(
                `SELECT id FROM impacta.communities
                 WHERE id = $1 AND status = 'active' AND visibility = 'public'
                 FOR SHARE`, [communityId]
            );
            if (!community.rowCount) return 'community_not_found' as const;
            const inserted = await client.query(
                `INSERT INTO impacta.community_members (community_id, user_id, status)
                 VALUES ($1, $2, 'pending')
                 ON CONFLICT (community_id, user_id) DO NOTHING
                 RETURNING status`, [communityId, session.userId]
            );
            if (inserted.rowCount) return 'requested' as const;
            const current = await client.query<{ status: string }>(
                `SELECT status FROM impacta.community_members
                 WHERE community_id = $1 AND user_id = $2 FOR UPDATE`, [communityId, session.userId]
            );
            const status = current.rows[0]?.status;
            if (status === 'active') return 'already_member' as const;
            if (status === 'pending') return 'already_pending' as const;
            if (status === 'blocked') return 'membership_blocked' as const;
            if (status === 'removed') {
                const renewed = await client.query(
                    `UPDATE impacta.community_members SET status = 'pending', joined_at = now()
                     WHERE community_id = $1 AND user_id = $2 AND status = 'removed'
                     RETURNING user_id`, [communityId, session.userId]
                );
                return renewed.rowCount ? 'requested' as const : 'already_pending' as const;
            }
            return 'community_not_found' as const;
        });
        if (result === 'rate_limit') return reply.code(429).send({ error: 'community_join_rate_limit' });
        if (result === 'community_not_found') return reply.code(404).send({ error: result });
        if (result === 'membership_blocked') return reply.code(403).send({ error: result });
        return { status: result };
    });

    server.get<{ Params: { communityId: string } }>(
        '/api/v1/communities/:communityId/membership-requests', async (request, reply) => {
            const session = await requireSession(request, reply, pool, false);
            if (!session) return;
            const communityId = requestId(request, 'communityId');
            if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
            const result = await pool.query(
                `SELECT member.user_id::text AS user_id, account.display_name, member.joined_at AS requested_at
                 FROM impacta.communities AS community
                 JOIN impacta.community_members AS member ON member.community_id = community.id
                 JOIN impacta.users AS account ON account.id = member.user_id AND account.status = 'active'
                 WHERE community.id = $1 AND community.owner_user_id = $2
                   AND community.status = 'active' AND member.status = 'pending'
                 ORDER BY member.joined_at, account.display_name LIMIT 100`,
                [communityId, session.userId]
            );
            const owner = await pool.query(
                `SELECT 1 FROM impacta.communities
                 WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
                [communityId, session.userId]
            );
            if (!owner.rowCount) return reply.code(404).send({ error: 'community_not_found' });
            return { items: result.rows };
        }
    );

    server.post<{
        Params: { communityId: string; userId: string };
        Body: { decision?: unknown };
    }>('/api/v1/communities/:communityId/membership-requests/:userId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const communityId = requestId(request, 'communityId');
        const userId = requestId(request, 'userId');
        const decision = request.body?.decision;
        if (!communityId || !userId || (decision !== 'approve' && decision !== 'reject')) {
            return reply.code(400).send({ error: 'invalid_membership_decision' });
        }
        const outcome = await transaction(pool, async (client) => {
            const community = await client.query(
                `SELECT id FROM impacta.communities
                 WHERE id = $1 AND owner_user_id = $2 AND status = 'active'
                 FOR UPDATE`, [communityId, session.userId]
            );
            if (!community.rowCount) return 'community_not_found' as const;
            const member = await client.query(
                `UPDATE impacta.community_members
                 SET status = $3, joined_at = CASE WHEN $3 = 'active' THEN now() ELSE joined_at END
                 WHERE community_id = $1 AND user_id = $2 AND status = 'pending'
                 RETURNING user_id`,
                [communityId, userId, decision === 'approve' ? 'active' : 'removed']
            );
            if (member.rowCount) {
                if (decision === 'approve') {
                    await client.query(
                        `INSERT INTO impacta.community_message_reads (community_id, user_id, last_read_message_id)
                         SELECT $1, $2, COALESCE(max(message.id), 0)
                         FROM impacta.community_messages AS message
                         WHERE message.community_id = $1
                           AND message.deleted_at IS NULL
                           AND message.moderation_status = 'approved'
                         ON CONFLICT (community_id, user_id) DO UPDATE
                         SET last_read_message_id = GREATEST(
                                 impacta.community_message_reads.last_read_message_id,
                                 EXCLUDED.last_read_message_id
                             ),
                             updated_at = now()`,
                        [communityId, userId]
                    );
                }
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, 'community_member', $3, $4)`,
                    [session.userId, decision === 'approve' ? 'community.member.approved' : 'community.member.rejected',
                        `${communityId}:${userId}`, `Pedido de adesão analisado na comunidade ${communityId}.`]
                );
            }
            return member.rowCount ? decision === 'approve' ? 'approved' as const : 'rejected' as const
                : 'request_not_pending' as const;
        });
        if (outcome === 'community_not_found') return reply.code(404).send({ error: outcome });
        if (outcome === 'request_not_pending') return reply.code(409).send({ error: outcome });
        return { status: outcome };
    });
}

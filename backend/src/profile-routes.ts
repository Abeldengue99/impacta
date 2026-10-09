import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const storageDirectory = resolve(process.env.IMPACTA_MEDIA_DIR ?? 'backend/storage/media');

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

function stripImageMetadata(bytes: Buffer, mimeType: string): Buffer | null {
    if (mimeType === 'image/png') {
        const signature = bytes.subarray(0, 8);
        const chunks = [signature];
        const retainedAncillary = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'bKGD', 'sBIT']);
        let offset = 8;
        let sawImageData = false;
        let sawEnd = false;
        while (offset + 12 <= bytes.length) {
            const length = bytes.readUInt32BE(offset);
            const end = offset + 12 + length;
            if (end > bytes.length) return null;
            const type = bytes.toString('ascii', offset + 4, offset + 8);
            const critical = (type.charCodeAt(0) & 0x20) === 0;
            if (critical || retainedAncillary.has(type)) chunks.push(bytes.subarray(offset, end));
            if (type === 'IDAT') sawImageData = true;
            offset = end;
            if (type === 'IEND') {
                sawEnd = true;
                break;
            }
        }
        return sawImageData && sawEnd ? Buffer.concat(chunks) : null;
    }

    if (mimeType !== 'image/jpeg') return null;
    const chunks = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const markerStart = offset;
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset++];
        if (marker === 0xd9) {
            chunks.push(bytes.subarray(markerStart, offset));
            return Buffer.concat(chunks);
        }
        if (marker === 0xda) {
            if (offset + 2 > bytes.length) return null;
            const scanLength = bytes.readUInt16BE(offset);
            const scanDataStart = offset + scanLength;
            if (scanLength < 2 || scanDataStart > bytes.length) return null;
            const endMarker = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]));
            if (endMarker < scanDataStart) return null;
            chunks.push(bytes.subarray(markerStart, endMarker + 2));
            return Buffer.concat(chunks);
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            chunks.push(bytes.subarray(markerStart, offset));
            continue;
        }
        if (offset + 2 > bytes.length) return null;
        const segmentLength = bytes.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
        const end = offset + segmentLength;
        if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) chunks.push(bytes.subarray(markerStart, end));
        offset = end;
    }
    return null;
}

function validDimensions(dimensions: AvatarDimensions | null): dimensions is AvatarDimensions {
    return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0
        && dimensions.width <= MAX_IMAGE_SIDE && dimensions.height <= MAX_IMAGE_SIDE
        && dimensions.width * dimensions.height <= MAX_IMAGE_PIXELS);
}

function safeStoragePath(storageKey: string): string | null {
    if (!/^[a-f0-9-]{36}\.(?:png|jpg)$/i.test(storageKey)) return null;
    const path = resolve(storageDirectory, storageKey);
    return dirname(path) === storageDirectory ? path : null;
}

function avatarUrl(id: string | null): string | null {
    return id ? `/api/v1/media/${encodeURIComponent(id)}` : null;
}

export function registerProfileRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/profile', async (request, reply) => {
        const session = await getSession(request, reply, pool, false);
        if (!session) return;
        const [profileResult, areasResult] = await Promise.all([
            pool.query(
                `SELECT account.id::text AS id, account.display_name, account.email, account.created_at,
                        profile.headline, profile.bio, profile.location, profile.occupation,
                        profile.organization, profile.website_url, profile.skills,
                        profile.impact_area_id::text AS impact_area_id, profile.is_public,
                        area.name AS impact_area, avatar.id::text AS avatar_id
                 FROM impacta.users AS account
                 JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
                 LEFT JOIN impacta.impact_areas AS area ON area.id = profile.impact_area_id
                 LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
                     AND avatar.status = 'available' AND avatar.media_type = 'image'
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
                impactArea: profile.impact_area,
                isPublic: profile.is_public,
                avatarUrl: avatarUrl(profile.avatar_id)
            },
            impactAreas: areasResult.rows
        };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/profiles/:userId', async (request, reply) => {
        const userId = request.params.userId;
        if (!validId(userId)) return reply.code(400).send({ error: 'invalid_user_id' });
        const result = await pool.query(
            `SELECT account.id::text AS id, account.display_name, account.created_at,
                    profile.headline, profile.bio, profile.location, profile.occupation,
                    profile.organization, profile.website_url, profile.skills,
                    profile.impact_area_id::text AS impact_area_id, area.name AS impact_area,
                    avatar.id::text AS avatar_id
             FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             LEFT JOIN impacta.impact_areas AS area ON area.id = profile.impact_area_id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
                 AND avatar.status = 'available' AND avatar.media_type = 'image'
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
                avatarUrl: avatarUrl(profile.avatar_id)
            }
        };
    });

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
                     impact_area_id = $9, is_public = $10
                 WHERE user_id = $1`,
                [session.userId, headline, bio, location, occupation, organization, websiteUrl, skills, impactAreaId, input.isPublic]
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

    server.post('/api/v1/profile/avatar', { bodyLimit: MAX_AVATAR_BYTES }, async (request, reply) => {
        const session = await getSession(request, reply, pool, true);
        if (!session) return;
        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return reply.code(415).send({ error: 'unsupported_avatar_type' });
        if (!Buffer.isBuffer(request.body) || request.body.length === 0 || request.body.length > MAX_AVATAR_BYTES) {
            return reply.code(413).send({ error: 'avatar_too_large' });
        }
        const bytes = request.body;
        if (!validDimensions(imageDimensions(bytes, mimeType))) return reply.code(400).send({ error: 'invalid_avatar_image' });
        const storedBytes = stripImageMetadata(bytes, mimeType);
        if (!storedBytes || storedBytes.length === 0 || storedBytes.length > MAX_AVATAR_BYTES) {
            return reply.code(400).send({ error: 'invalid_avatar_image' });
        }

        const extension = mimeType === 'image/png' ? 'png' : 'jpg';
        const storageKey = `${randomUUID()}.${extension}`;
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
                 VALUES ($1, $2, 'image', $3, $4, $5, 'available')
                 RETURNING id::text AS id`,
                [session.userId, storageKey, mimeType, storedBytes.length, createHash('sha256').update(storedBytes).digest('hex')]
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

    server.get<{ Params: { mediaId: string } }>('/api/v1/media/:mediaId', async (request, reply) => {
        const mediaId = request.params.mediaId;
        if (!validId(mediaId)) return reply.code(404).send({ error: 'media_not_found' });
        const result = await pool.query<{
            storage_key: string; mime_type: string; is_public: boolean; owner_user_id: string;
        }>(
            `SELECT media.storage_key, media.mime_type, profile.is_public,
                    profile.user_id::text AS owner_user_id
             FROM impacta.media AS media
             JOIN impacta.user_profiles AS profile ON profile.avatar_media_id = media.id
             JOIN impacta.users AS account ON account.id = profile.user_id AND account.status = 'active'
             WHERE media.id = $1 AND media.status = 'available' AND media.media_type = 'image'
             LIMIT 1`,
            [mediaId]
        );
        const avatar = result.rows[0];
        if (!avatar) return reply.code(404).send({ error: 'media_not_found' });
        if (!avatar.is_public) {
            const session = await getSession(request, reply, pool, false);
            if (!session) {
                if (reply.sent) return;
                return reply.code(404).send({ error: 'media_not_found' });
            }
            if (session.userId !== avatar.owner_user_id) return reply.code(404).send({ error: 'media_not_found' });
        }
        const path = safeStoragePath(avatar.storage_key);
        if (!path) return reply.code(404).send({ error: 'media_not_found' });
        try {
            const bytes = await readFile(path);
            return reply.type(avatar.mime_type).header('cache-control', 'no-store').send(bytes);
        } catch {
            return reply.code(404).send({ error: 'media_not_found' });
        }
    });
}

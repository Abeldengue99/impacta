import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { requireSession } from './community-routes.js';
import { findFeedPolicyViolation } from './community-content-policy.js';
import {
    DIRECT_MESSAGE_MEDIA_DIRECTORY,
    MAX_DIRECT_MESSAGE_IMAGE_BYTES,
    MAX_DIRECT_MESSAGE_VIDEO_BYTES,
    MediaProcessingError,
    acquireVideoProcessingSlot,
    directMessageMediaStoragePath,
    optimizeDirectMessageImage,
    optimizeDirectMessageVideo,
    type ProcessedPostMedia
} from './media-processing.js';

const MAX_ID = 9223372036854775807n;
const REQUEST_LIMIT = 5;
const REQUEST_INBOX_LIMIT = 50;
const REQUEST_COOLDOWN_DAYS = 30;
const videoProcessingSlots = new WeakMap<FastifyRequest, () => void>();

function releaseVideoProcessingSlot(request: FastifyRequest): void {
    const release = videoProcessingSlots.get(request);
    if (!release) return;
    videoProcessingSlots.delete(request);
    release();
}

function validId(value: string | undefined): value is string {
    if (!value || !/^[1-9]\d{0,18}$/.test(value)) return false;
    try { return BigInt(value) <= MAX_ID; } catch { return false; }
}

function cleanText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const body = value.replace(/\r\n?/g, '\n').trim();
    const length = Array.from(body).length;
    return length > 0 && length <= max ? body : null;
}

function validRequestText(value: unknown): string | null {
    const body = cleanText(value, 500);
    if (!body || /(?:\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|ao|co|io|app|dev|info|edu|gov|ly|me)(?:\/\S*)?)/i.test(body)) return null;
    return body;
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function lockPair(client: PoolClient, first: string, second: string): Promise<void> {
    await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(
            'impacta:direct-message:pair:' || LEAST($1::bigint, $2::bigint)::text || ':' ||
            GREATEST($1::bigint, $2::bigint)::text, 0))`,
        [first, second]
    );
}

async function isBlocked(client: PoolClient, first: string, second: string): Promise<boolean> {
    const result = await client.query(
        `SELECT 1 FROM impacta.direct_message_blocks
         WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
            OR (blocker_user_id = $2 AND blocked_user_id = $1) LIMIT 1`,
        [first, second]
    );
    return Boolean(result.rowCount);
}

async function isImpacta(client: PoolClient, first: string, second: string): Promise<boolean> {
    const result = await client.query(
        `SELECT 1 FROM impacta.impactation_requests
         WHERE status = 'accepted'
           AND LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
           AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)
         LIMIT 1`,
        [first, second]
    );
    return Boolean(result.rowCount);
}

async function ensureConversation(client: PoolClient, first: string, second: string): Promise<string> {
    const a = BigInt(first) < BigInt(second) ? first : second;
    const b = a === first ? second : first;
    await client.query(
        `INSERT INTO impacta.direct_conversations (user_a_id, user_b_id)
         VALUES ($1, $2) ON CONFLICT (user_a_id, user_b_id) DO NOTHING`, [a, b]
    );
    const result = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM impacta.direct_conversations
         WHERE user_a_id = $1 AND user_b_id = $2`, [a, b]
    );
    const conversationId = result.rows[0]?.id;
    if (!conversationId) throw new Error('direct_conversation_create_failed');
    await client.query(
        `INSERT INTO impacta.direct_conversation_members (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3) ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conversationId, a, b]
    );
    return conversationId;
}

async function insertMessage(
    client: PoolClient, conversationId: string, authorId: string, body: string | null, mediaId: string | null = null
): Promise<string> {
    const result = await client.query<{ id: string }>(
        `INSERT INTO impacta.direct_messages (conversation_id, author_user_id, body, media_id)
         VALUES ($1, $2, $3, $4) RETURNING id::text AS id`, [conversationId, authorId, body, mediaId]
    );
    const messageId = result.rows[0]?.id;
    if (!messageId) throw new Error('direct_message_create_failed');
    await client.query(
        `UPDATE impacta.direct_conversation_members
         SET last_read_message_id = CASE WHEN user_id = $2
                                         THEN GREATEST(last_read_message_id, $3::bigint)
                                         ELSE last_read_message_id END,
             archived_at = NULL, updated_at = now()
         WHERE conversation_id = $1`, [conversationId, authorId, messageId]
    );
    return messageId;
}

async function canSendMessage(client: PoolClient, userId: string): Promise<boolean> {
    await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('impacta:direct-message:send:' || $1, 0))`, [userId]
    );
    const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM impacta.direct_messages
         WHERE author_user_id = $1 AND created_at > now() - interval '1 hour'`, [userId]
    );
    return (result.rows[0]?.count ?? 60) < 60;
}

async function authenticated(request: FastifyRequest, reply: FastifyReply, pool: Pool, csrf: boolean) {
    return requireSession(request, reply, pool, csrf);
}

async function conversationPeer(pool: Pool, conversationId: string, userId: string): Promise<string | null> {
    const result = await pool.query<{ peer_id: string }>(
        `SELECT CASE WHEN conversation.user_a_id = $2 THEN conversation.user_b_id::text
                     ELSE conversation.user_a_id::text END AS peer_id
         FROM impacta.direct_conversations AS conversation
         JOIN impacta.direct_conversation_members AS member
           ON member.conversation_id = conversation.id AND member.user_id = $2
         JOIN impacta.users AS peer ON peer.id = CASE WHEN conversation.user_a_id = $2
                                                      THEN conversation.user_b_id ELSE conversation.user_a_id END
         WHERE conversation.id = $1
           AND NOT EXISTS (SELECT 1 FROM impacta.direct_message_blocks AS block
                           WHERE (block.blocker_user_id = $2 AND block.blocked_user_id = peer.id)
                              OR (block.blocker_user_id = peer.id AND block.blocked_user_id = $2))`, [conversationId, userId]
    );
    return result.rows[0]?.peer_id ?? null;
}

/** Private one-to-one conversations and consent-based first-contact requests. */
export function registerDirectMessageRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/direct-messages/summary', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query<{ unread_count: number; request_count: number }>(
            `SELECT
                (SELECT count(*)::int
                 FROM impacta.direct_conversation_members AS member
                 JOIN impacta.direct_messages AS message
                   ON message.conversation_id = member.conversation_id
                  AND message.id > member.last_read_message_id
                  AND message.author_user_id <> member.user_id AND message.deleted_at IS NULL
                 WHERE member.user_id = $1 AND member.archived_at IS NULL AND member.muted = false) AS unread_count,
                (SELECT count(*)::int FROM impacta.direct_message_requests
                 WHERE recipient_user_id = $1 AND status = 'pending') AS request_count`, [session.userId]
        );
        return result.rows[0] ?? { unread_count: 0, request_count: 0 };
    });

    server.get<{ Querystring: { box?: string } }>('/api/v1/direct-messages/conversations', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const box = request.query.box === 'archived' ? 'archived' : 'inbox';
        const result = await pool.query(
            `SELECT conversation.id::text AS id, peer.id::text AS peer_id, peer.display_name AS peer_name,
                    CASE WHEN profile.is_public AND avatar.status = 'available' AND avatar.media_type = 'image'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url,
                    CASE WHEN latest.deleted_at IS NOT NULL THEN 'Mensagem removida.'
                         WHEN latest.media_type = 'image' THEN COALESCE(latest.body, 'Fotografia')
                         WHEN latest.media_type = 'video' THEN COALESCE(latest.body, 'Vídeo')
                         ELSE latest.body END AS last_message,
                    latest.created_at AS last_message_at,
                    member.muted, member.archived_at IS NOT NULL AS archived,
                    (SELECT count(*)::int FROM impacta.direct_messages AS unseen
                     WHERE unseen.conversation_id = conversation.id
                       AND unseen.id > member.last_read_message_id
                       AND unseen.author_user_id <> $1 AND unseen.deleted_at IS NULL) AS unread_count
             FROM impacta.direct_conversation_members AS member
             JOIN impacta.direct_conversations AS conversation ON conversation.id = member.conversation_id
             JOIN impacta.users AS peer
               ON peer.id = CASE WHEN conversation.user_a_id = $1 THEN conversation.user_b_id ELSE conversation.user_a_id END
              AND peer.status = 'active'
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = peer.id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
             LEFT JOIN LATERAL (
                 SELECT message.body, message.created_at, message.deleted_at, media.media_type
                 FROM impacta.direct_messages AS message
                 LEFT JOIN impacta.media AS media ON media.id = message.media_id
                 WHERE message.conversation_id = conversation.id ORDER BY message.id DESC LIMIT 1
             ) AS latest ON true
             WHERE member.user_id = $1 AND member.archived_at IS ${box === 'archived' ? 'NOT NULL' : 'NULL'}
               AND NOT EXISTS (SELECT 1 FROM impacta.direct_message_blocks AS block
                               WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = peer.id)
                                  OR (block.blocker_user_id = peer.id AND block.blocked_user_id = $1))
             ORDER BY latest.created_at DESC NULLS LAST, conversation.id DESC LIMIT 100`, [session.userId]
        );
        return { items: result.rows };
    });

    server.get<{ Querystring: { box?: string } }>('/api/v1/direct-messages/requests', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const outgoing = request.query.box === 'outgoing';
        const ownerColumn = outgoing ? 'request.requester_user_id' : 'request.recipient_user_id';
        const peerColumn = outgoing ? 'request.recipient_user_id' : 'request.requester_user_id';
        const result = await pool.query(
            `SELECT request.id::text AS id, request.body, request.created_at, request.status,
                    peer.id::text AS peer_id, peer.display_name AS peer_name,
                    CASE WHEN profile.is_public AND avatar.status = 'available' AND avatar.media_type = 'image'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url
             FROM impacta.direct_message_requests AS request
             JOIN impacta.users AS peer ON peer.id = ${peerColumn} AND peer.status = 'active'
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = peer.id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
             WHERE ${ownerColumn} = $1 AND request.status = 'pending'
               AND NOT EXISTS (SELECT 1 FROM impacta.direct_message_blocks AS block
                               WHERE (block.blocker_user_id = $1 AND block.blocked_user_id = peer.id)
                                  OR (block.blocker_user_id = peer.id AND block.blocked_user_id = $1))
             ORDER BY request.created_at DESC LIMIT 100`, [session.userId]
        );
        return { items: result.rows };
    });

    server.post<{ Body: { recipientUserId?: unknown; body?: unknown } }>(
        '/api/v1/direct-messages/start', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const recipientId = typeof request.body?.recipientUserId === 'string' ? request.body.recipientUserId : '';
            const rawBody = request.body?.body;
            const body = cleanText(rawBody, 1200);
            if (!validId(recipientId) || recipientId === session.userId || !body) {
                return reply.code(400).send({ error: 'invalid_direct_message' });
            }

            const outcome = await transaction(pool, async (client) => {
                await lockPair(client, session.userId, recipientId);
                const target = await client.query<{ id: string; is_public: boolean }>(
                    `SELECT account.id::text AS id, COALESCE(profile.is_public, false) AS is_public
                     FROM impacta.users AS account
                     LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
                     WHERE account.id = $1 AND account.status = 'active'`, [recipientId]
                );
                const person = target.rows[0];
                if (!person) return { type: 'target_missing' as const };
                if (await isBlocked(client, session.userId, recipientId)) return { type: 'contact_unavailable' as const };

                const existing = await client.query<{ id: string }>(
                    `SELECT conversation.id::text AS id FROM impacta.direct_conversations AS conversation
                     JOIN impacta.direct_conversation_members AS member
                       ON member.conversation_id = conversation.id AND member.user_id = $1
                     WHERE conversation.user_a_id = LEAST($1::bigint, $2::bigint)
                       AND conversation.user_b_id = GREATEST($1::bigint, $2::bigint)`,
                    [session.userId, recipientId]
                );
                if (existing.rows[0]) {
                    const conversationId = existing.rows[0].id;
                    if (!await canSendMessage(client, session.userId)) return { type: 'message_limit' as const };
                    const messageId = await insertMessage(client, conversationId, session.userId, body);
                    return { type: 'message_sent' as const, conversationId, messageId };
                }

                const policy = await client.query<{ request_policy: string }>(
                    `SELECT COALESCE((SELECT request_policy FROM impacta.direct_message_preferences
                                      WHERE user_id = $1), 'requests') AS request_policy`, [recipientId]
                );
                const requestPolicy = policy.rows[0]?.request_policy ?? 'requests';
                if (await isImpacta(client, session.userId, recipientId)) {
                    if (requestPolicy === 'none') return { type: 'contact_unavailable' as const };
                    if (!await canSendMessage(client, session.userId)) return { type: 'message_limit' as const };
                    const conversationId = await ensureConversation(client, session.userId, recipientId);
                    const messageId = await insertMessage(client, conversationId, session.userId, body);
                    return { type: 'message_sent' as const, conversationId, messageId };
                }

                if (!person.is_public || requestPolicy !== 'requests') return { type: 'contact_unavailable' as const };
                const requestBody = validRequestText(rawBody);
                if (!requestBody) return { type: 'request_text_invalid' as const };
                await client.query(
                    `SELECT pg_advisory_xact_lock(hashtextextended('impacta:direct-message:inbox:' || $1, 0))`,
                    [recipientId]
                );
                const received = await client.query<{ count: number }>(
                    `SELECT count(*)::int AS count FROM impacta.direct_message_requests
                     WHERE recipient_user_id = $1 AND status = 'pending'`, [recipientId]
                );
                if ((received.rows[0]?.count ?? 0) >= REQUEST_INBOX_LIMIT) return { type: 'contact_unavailable' as const };

                const pending = await client.query<{ id: string; requester_user_id: string }>(
                    `SELECT id::text AS id, requester_user_id::text AS requester_user_id
                     FROM impacta.direct_message_requests
                     WHERE LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
                       AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)
                       AND status = 'pending' LIMIT 1`, [session.userId, recipientId]
                );
                if (pending.rows[0]) return { type: 'request_pending' as const, incoming: pending.rows[0].requester_user_id !== session.userId };

                const recentPair = await client.query(
                    `SELECT 1 FROM impacta.direct_message_requests
                     WHERE LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
                       AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)
                       AND created_at > now() - ($3::text || ' days')::interval LIMIT 1`,
                    [session.userId, recipientId, String(REQUEST_COOLDOWN_DAYS)]
                );
                if (recentPair.rowCount) return { type: 'request_cooldown' as const };

                await client.query(
                    `SELECT pg_advisory_xact_lock(hashtextextended('impacta:direct-message:requests:' || $1, 0))`,
                    [session.userId]
                );
                const sent = await client.query<{ count: number }>(
                    `SELECT count(*)::int AS count FROM impacta.direct_message_requests
                     WHERE requester_user_id = $1 AND created_at > now() - interval '24 hours'`, [session.userId]
                );
                if ((sent.rows[0]?.count ?? REQUEST_LIMIT) >= REQUEST_LIMIT) return { type: 'request_limit' as const };

                const created = await client.query<{ id: string }>(
                    `INSERT INTO impacta.direct_message_requests (requester_user_id, recipient_user_id, body)
                     VALUES ($1, $2, $3) RETURNING id::text AS id`, [session.userId, recipientId, requestBody]
                );
                return { type: 'request_sent' as const, requestId: created.rows[0]?.id };
            });

            if (outcome.type === 'target_missing') return reply.code(404).send({ error: 'profile_not_found' });
            if (outcome.type === 'contact_unavailable') return reply.code(403).send({ error: 'contact_unavailable' });
            if (outcome.type === 'request_text_invalid') return reply.code(400).send({ error: 'message_request_must_be_short_and_link_free' });
            if (outcome.type === 'request_cooldown') return reply.code(429).send({ error: 'contact_cooldown' });
            if (outcome.type === 'request_limit') return reply.code(429).send({ error: 'message_request_limit_reached' });
            if (outcome.type === 'message_limit') return reply.code(429).send({ error: 'message_limit_reached' });
            if (outcome.type === 'request_pending') return reply.code(409).send({ error: outcome.incoming ? 'incoming_request_exists' : 'request_already_pending' });
            if (outcome.type === 'request_sent') return reply.code(202).send({ status: 'request_sent', requestId: outcome.requestId });
            return reply.send({ status: 'message_sent', conversationId: outcome.conversationId, messageId: outcome.messageId });
        }
    );

    server.post<{ Params: { requestId: string } }>('/api/v1/direct-messages/requests/:requestId/accept', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const requestId = request.params.requestId;
        if (!validId(requestId)) return reply.code(400).send({ error: 'invalid_message_request_id' });
        const outcome = await transaction(pool, async (client) => {
            const locked = await client.query<{ requester_user_id: string; body: string }>(
                `SELECT requester_user_id::text AS requester_user_id, body
                 FROM impacta.direct_message_requests
                 WHERE id = $1 AND recipient_user_id = $2 AND status = 'pending' FOR UPDATE`, [requestId, session.userId]
            );
            const invitation = locked.rows[0];
            if (!invitation) return { type: 'not_found' as const };
            await lockPair(client, session.userId, invitation.requester_user_id);
            if (await isBlocked(client, session.userId, invitation.requester_user_id)) return { type: 'contact_unavailable' as const };
            const conversationId = await ensureConversation(client, session.userId, invitation.requester_user_id);
            const messageId = await insertMessage(client, conversationId, invitation.requester_user_id, invitation.body);
            await client.query(
                `UPDATE impacta.content_reports
                 SET direct_message_id = $2, direct_message_request_id = NULL
                 WHERE direct_message_request_id = $1 AND status IN ('open', 'reviewing')`, [requestId, messageId]
            );
            await client.query(
                `UPDATE impacta.direct_message_requests SET status = 'accepted', responded_at = now()
                 WHERE id = $1`, [requestId]
            );
            return { type: 'accepted' as const, conversationId, messageId };
        });
        if (outcome.type === 'not_found') return reply.code(404).send({ error: 'message_request_not_found' });
        if (outcome.type === 'contact_unavailable') return reply.code(404).send({ error: 'message_request_not_found' });
        return { status: outcome.type, conversationId: outcome.conversationId };
    });

    for (const action of ['decline', 'cancel'] as const) {
        server.post<{ Params: { requestId: string } }>(`/api/v1/direct-messages/requests/:requestId/${action}`, async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const requestId = request.params.requestId;
            if (!validId(requestId)) return reply.code(400).send({ error: 'invalid_message_request_id' });
            const ownerColumn = action === 'decline' ? 'recipient_user_id' : 'requester_user_id';
            const result = await pool.query(
                `UPDATE impacta.direct_message_requests
                 SET status = '${action === 'decline' ? 'declined' : 'cancelled'}', responded_at = now()
                 WHERE id = $1 AND ${ownerColumn} = $2 AND status = 'pending'`, [requestId, session.userId]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'message_request_not_found' });
            return { status: action === 'decline' ? 'declined' : 'cancelled' };
        });
    }

    server.post<{ Params: { requestId: string }; Body: { reasonCode?: unknown; details?: unknown } }>(
        '/api/v1/direct-messages/requests/:requestId/report', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const requestId = request.params.requestId;
            const reason = request.body?.reasonCode;
            const details = cleanText(request.body?.details, 500);
            if (!validId(requestId) || !['spam', 'harassment', 'threat', 'other'].includes(String(reason))
                || (request.body?.details !== undefined && request.body?.details !== '' && !details)) {
                return reply.code(400).send({ error: 'invalid_message_request_report' });
            }
            const target = await pool.query(
                `SELECT 1 FROM impacta.direct_message_requests
                 WHERE id = $1 AND recipient_user_id = $2 AND status = 'pending'`, [requestId, session.userId]
            );
            if (!target.rowCount) return reply.code(404).send({ error: 'message_request_not_found' });
            const count = await pool.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM impacta.content_reports
                 WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'`, [session.userId]
            );
            if ((count.rows[0]?.count ?? 0) >= 10) return reply.code(429).send({ error: 'report_limit_reached' });
            const report = await pool.query(
                `INSERT INTO impacta.content_reports (reporter_user_id, direct_message_request_id, reason_code, details)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (reporter_user_id, direct_message_request_id)
                 WHERE reporter_user_id IS NOT NULL AND direct_message_request_id IS NOT NULL
                   AND status IN ('open', 'reviewing') DO NOTHING`,
                [session.userId, requestId, reason, details || null]
            );
            return reply.code(report.rowCount ? 201 : 200).send({ status: report.rowCount ? 'reported' : 'already_reported' });
        }
    );

    server.get<{ Querystring: { policy?: string } }>('/api/v1/direct-messages/preferences', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query<{ request_policy: string }>(
            `SELECT COALESCE((SELECT request_policy FROM impacta.direct_message_preferences WHERE user_id = $1), 'requests') AS request_policy`,
            [session.userId]
        );
        return { requestPolicy: result.rows[0]?.request_policy ?? 'requests' };
    });

    server.put<{ Body: { requestPolicy?: unknown } }>('/api/v1/direct-messages/preferences', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const policy = request.body?.requestPolicy;
        if (!['requests', 'impactas', 'none'].includes(String(policy))) return reply.code(400).send({ error: 'invalid_message_request_policy' });
        await pool.query(
            `INSERT INTO impacta.direct_message_preferences (user_id, request_policy)
             VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE
             SET request_policy = EXCLUDED.request_policy, updated_at = now()`, [session.userId, policy]
        );
        return { requestPolicy: policy };
    });

    server.post<{ Params: { conversationId: string } }>(
        '/api/v1/direct-messages/conversations/:conversationId/media', {
            bodyLimit: MAX_DIRECT_MESSAGE_VIDEO_BYTES,
            handlerTimeout: 240_000,
            onRequest: async (request, reply) => {
                const session = await authenticated(request, reply, pool, true);
                if (!session) return;
                const conversationId = request.params.conversationId;
                if (!validId(conversationId)) return reply.code(400).send({ error: 'invalid_conversation_id' });
                const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
                if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(mimeType ?? '')) {
                    return reply.code(415).send({ error: 'unsupported_direct_message_media_type' });
                }
                if (!await conversationPeer(pool, conversationId, session.userId)) {
                    return reply.code(404).send({ error: 'conversation_not_found' });
                }
                const recentMessages = await pool.query<{ count: number }>(
                    `SELECT count(*)::int AS count FROM impacta.direct_messages
                     WHERE author_user_id = $1 AND created_at > now() - interval '1 hour'`, [session.userId]
                );
                if ((recentMessages.rows[0]?.count ?? 60) >= 60) {
                    return reply.code(429).send({ error: 'message_limit_reached' });
                }
                if (mimeType?.startsWith('video/')) {
                    const release = acquireVideoProcessingSlot();
                    if (!release) return reply.header('retry-after', '30').code(429).send({ error: 'video_processing_busy' });
                    videoProcessingSlots.set(request, release);
                }
            },
            onResponse: async (request) => releaseVideoProcessingSlot(request)
        }, async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const conversationId = request.params.conversationId;
            const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
            const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '');
            const isVideo = ['video/mp4', 'video/quicktime'].includes(mimeType ?? '');
            if (!validId(conversationId)) return reply.code(400).send({ error: 'invalid_conversation_id' });
            if (!isImage && !isVideo) return reply.code(415).send({ error: 'unsupported_direct_message_media_type' });
            if (!Buffer.isBuffer(request.body) || !request.body.length) {
                return reply.code(400).send({ error: 'invalid_direct_message_media' });
            }
            const maximumBytes = isImage ? MAX_DIRECT_MESSAGE_IMAGE_BYTES : MAX_DIRECT_MESSAGE_VIDEO_BYTES;
            if (request.body.length > maximumBytes) return reply.code(413).send({ error: 'direct_message_media_too_large' });

            const rawCaption = request.headers['x-direct-message-caption'];
            let caption: string | null = null;
            if (rawCaption !== undefined) {
                if (Array.isArray(rawCaption) || rawCaption.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(rawCaption)) {
                    return reply.code(400).send({ error: 'invalid_direct_message_caption' });
                }
                const decodedCaption = Buffer.from(rawCaption, 'base64url').toString('utf8');
                if (Buffer.from(decodedCaption, 'utf8').toString('base64url') !== rawCaption) {
                    return reply.code(400).send({ error: 'invalid_direct_message_caption' });
                }
                caption = cleanText(decodedCaption, 1200);
                if (!caption) return reply.code(400).send({ error: 'invalid_direct_message_caption' });
            }
            if (caption && findFeedPolicyViolation(caption)) {
                return reply.code(422).send({ error: 'feed_content_not_allowed' });
            }

            let processed: ProcessedPostMedia;
            try {
                processed = isImage
                    ? await optimizeDirectMessageImage(request.body)
                    : await optimizeDirectMessageVideo(request.body);
            } catch (error) {
                if (error instanceof MediaProcessingError) return reply.code(error.statusCode).send({ error: error.code });
                throw error;
            }

            const storageKey = `direct-messages/${randomUUID()}.${processed.extension}`;
            const path = directMessageMediaStoragePath(storageKey);
            if (!path) return reply.code(500).send({ error: 'media_storage_unavailable' });
            await mkdir(DIRECT_MESSAGE_MEDIA_DIRECTORY, { recursive: true, mode: 0o700 });
            await writeFile(path, processed.bytes, { flag: 'wx', mode: 0o600 });

            try {
                const outcome = await transaction(pool, async (client) => {
                    const access = await client.query<{ peer_id: string }>(
                        `SELECT CASE WHEN conversation.user_a_id = $2 THEN conversation.user_b_id::text
                                     ELSE conversation.user_a_id::text END AS peer_id
                         FROM impacta.direct_conversations AS conversation
                         JOIN impacta.direct_conversation_members AS member
                           ON member.conversation_id = conversation.id AND member.user_id = $2
                         WHERE conversation.id = $1`, [conversationId, session.userId]
                    );
                    const peerId = access.rows[0]?.peer_id;
                    if (!peerId) return { type: 'not_found' as const };
                    await lockPair(client, session.userId, peerId);
                    if (await isBlocked(client, session.userId, peerId)) return { type: 'blocked' as const };
                    if (!await canSendMessage(client, session.userId)) return { type: 'rate_limited' as const };
                    const media = await client.query<{ id: string }>(
                        `INSERT INTO impacta.media
                            (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                         VALUES ($1, $2, $3, $4, $5, $6, 'available') RETURNING id::text AS id`,
                        [session.userId, storageKey, processed.mediaType, processed.mimeType,
                            processed.bytes.length, createHash('sha256').update(processed.bytes).digest('hex')]
                    );
                    const messageId = await insertMessage(client, conversationId, session.userId, caption, media.rows[0].id);
                    return { type: 'sent' as const, messageId };
                });
                if (outcome.type !== 'sent') await unlink(path).catch(() => undefined);
                if (outcome.type === 'not_found' || outcome.type === 'blocked') {
                    return reply.code(404).send({ error: 'conversation_not_found' });
                }
                if (outcome.type === 'rate_limited') return reply.code(429).send({ error: 'message_limit_reached' });
                return reply.code(201).send({ status: 'sent', messageId: outcome.messageId });
            } catch (error) {
                await unlink(path).catch(() => undefined);
                throw error;
            }
        }
    );

    server.get<{ Params: { conversationId: string }; Querystring: { before?: string; after?: string } }>(
        '/api/v1/direct-messages/conversations/:conversationId/messages', async (request, reply) => {
            const session = await authenticated(request, reply, pool, false);
            if (!session) return;
            const conversationId = request.params.conversationId;
            const { before, after } = request.query;
            if (!validId(conversationId) || (before && !validId(before)) || (after && !validId(after)) || (before && after)) {
                return reply.code(400).send({ error: 'invalid_direct_message_query' });
            }
            if (!await conversationPeer(pool, conversationId, session.userId)) return reply.code(404).send({ error: 'conversation_not_found' });
            const cursor = before || after;
            const comparison = before ? '<' : '>';
            const direction = before || !after ? 'DESC' : 'ASC';
            const result = await pool.query(
                `SELECT message.id::text AS id, message.author_user_id::text AS author_user_id,
                        author.display_name AS author_name,
                        CASE WHEN message.deleted_at IS NULL THEN message.body ELSE 'Esta mensagem foi removida.' END AS body,
                        CASE WHEN message.deleted_at IS NULL AND media.status = 'available' THEN media.media_type END AS media_type,
                        CASE WHEN message.deleted_at IS NULL AND media.status = 'available'
                             THEN '/api/v1/direct-messages/media/' || media.id::text END AS media_url,
                        message.created_at, message.edited_at, message.deleted_at
                 FROM impacta.direct_messages AS message
                 JOIN impacta.users AS author ON author.id = message.author_user_id
                 LEFT JOIN impacta.media AS media ON media.id = message.media_id
                 WHERE message.conversation_id = $1 ${cursor ? `AND message.id ${comparison} $2` : ''}
                 ORDER BY message.id ${direction} LIMIT 51`, cursor ? [conversationId, cursor] : [conversationId]
            );
            const hasMore = result.rows.length > 50;
            const items = direction === 'DESC' ? result.rows.reverse().slice(-50) : result.rows.slice(0, 50);
            return { items, hasMore };
        }
    );

    server.get<{ Params: { mediaId: string } }>('/api/v1/direct-messages/media/:mediaId', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const mediaId = request.params.mediaId;
        if (!validId(mediaId)) return reply.code(404).send({ error: 'media_not_found' });
        const result = await pool.query<{
            conversation_id: string; storage_key: string; mime_type: string; media_type: string;
        }>(
            `SELECT message.conversation_id::text AS conversation_id, media.storage_key,
                    media.mime_type, media.media_type
             FROM impacta.media AS media
             JOIN impacta.direct_messages AS message ON message.media_id = media.id
             JOIN impacta.direct_conversation_members AS member
               ON member.conversation_id = message.conversation_id AND member.user_id = $2
             WHERE media.id = $1 AND media.status = 'available' AND message.deleted_at IS NULL
             LIMIT 1`, [mediaId, session.userId]
        );
        const item = result.rows[0];
        if (!item || !await conversationPeer(pool, item.conversation_id, session.userId)) {
            return reply.code(404).send({ error: 'media_not_found' });
        }
        const path = directMessageMediaStoragePath(item.storage_key);
        if (!path) return reply.code(404).send({ error: 'media_not_found' });
        try {
            const file = await stat(path);
            if (item.media_type === 'video') {
                const range = request.headers.range;
                if (range) {
                    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
                    if (!match || (!match[1] && !match[2])) {
                        return reply.code(416).header('content-range', `bytes */${file.size}`).send();
                    }
                    const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
                    let end = match[2] && match[1] ? Number(match[2]) : file.size - 1;
                    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
                        || start < 0 || start >= file.size || end < start) {
                        return reply.code(416).header('content-range', `bytes */${file.size}`).send();
                    }
                    end = Math.min(end, file.size - 1);
                    return reply.code(206).type(item.mime_type)
                        .header('accept-ranges', 'bytes')
                        .header('content-range', `bytes ${start}-${end}/${file.size}`)
                        .header('content-length', String(end - start + 1))
                        .header('cache-control', 'private, no-store')
                        .header('x-content-type-options', 'nosniff')
                        .send(createReadStream(path, { start, end }));
                }
                return reply.type(item.mime_type).header('accept-ranges', 'bytes')
                    .header('content-length', String(file.size))
                    .header('cache-control', 'private, no-store')
                    .header('x-content-type-options', 'nosniff')
                    .send(createReadStream(path));
            }
            return reply.type(item.mime_type).header('cache-control', 'private, no-store')
                .header('x-content-type-options', 'nosniff').send(createReadStream(path));
        } catch {
            return reply.code(404).send({ error: 'media_not_found' });
        }
    });

    server.post<{ Params: { conversationId: string }; Body: { body?: unknown } }>(
        '/api/v1/direct-messages/conversations/:conversationId/messages', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const conversationId = request.params.conversationId;
            const body = cleanText(request.body?.body, 1200);
            if (!validId(conversationId) || !body) return reply.code(400).send({ error: 'invalid_direct_message' });
            const outcome = await transaction(pool, async (client) => {
                const access = await client.query<{ peer_id: string }>(
                    `SELECT CASE WHEN conversation.user_a_id = $2 THEN conversation.user_b_id::text
                                 ELSE conversation.user_a_id::text END AS peer_id
                     FROM impacta.direct_conversations AS conversation
                     JOIN impacta.direct_conversation_members AS member
                       ON member.conversation_id = conversation.id AND member.user_id = $2
                     WHERE conversation.id = $1`, [conversationId, session.userId]
                );
                const peerId = access.rows[0]?.peer_id;
                if (!peerId) return { type: 'not_found' as const };
                await lockPair(client, session.userId, peerId);
                if (await isBlocked(client, session.userId, peerId)) return { type: 'blocked' as const };
                if (!await canSendMessage(client, session.userId)) return { type: 'rate_limited' as const };
                const messageId = await insertMessage(client, conversationId, session.userId, body);
                return { type: 'sent' as const, messageId };
            });
            if (outcome.type === 'not_found' || outcome.type === 'blocked') return reply.code(404).send({ error: 'conversation_not_found' });
            if (outcome.type === 'rate_limited') return reply.code(429).send({ error: 'message_limit_reached' });
            return { status: 'sent', messageId: outcome.messageId };
        }
    );

    server.post<{ Params: { conversationId: string } }>('/api/v1/direct-messages/conversations/:conversationId/read', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const conversationId = request.params.conversationId;
        if (!validId(conversationId)) return reply.code(400).send({ error: 'invalid_conversation_id' });
        const result = await pool.query(
            `UPDATE impacta.direct_conversation_members AS member
             SET last_read_message_id = GREATEST(member.last_read_message_id,
                 COALESCE((SELECT max(message.id) FROM impacta.direct_messages AS message
                           WHERE message.conversation_id = member.conversation_id), 0)), updated_at = now()
             WHERE member.conversation_id = $1 AND member.user_id = $2
               AND EXISTS (SELECT 1 FROM impacta.direct_conversations AS conversation
                           WHERE conversation.id = member.conversation_id
                             AND NOT EXISTS (SELECT 1 FROM impacta.direct_message_blocks AS block
                                             WHERE (block.blocker_user_id = $2 AND block.blocked_user_id =
                                                    CASE WHEN conversation.user_a_id = $2 THEN conversation.user_b_id ELSE conversation.user_a_id END)
                                                OR (block.blocked_user_id = $2 AND block.blocker_user_id =
                                                    CASE WHEN conversation.user_a_id = $2 THEN conversation.user_b_id ELSE conversation.user_a_id END)))`,
            [conversationId, session.userId]
        );
        if (!result.rowCount) return reply.code(404).send({ error: 'conversation_not_found' });
        return { status: 'read' };
    });

    for (const action of ['archive', 'unarchive', 'mute', 'unmute'] as const) {
        server.post<{ Params: { conversationId: string } }>(`/api/v1/direct-messages/conversations/:conversationId/${action}`, async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const conversationId = request.params.conversationId;
            if (!validId(conversationId)) return reply.code(400).send({ error: 'invalid_conversation_id' });
            const result = await pool.query(
                `UPDATE impacta.direct_conversation_members
                 SET ${action === 'archive' ? 'archived_at = now()' : action === 'unarchive' ? 'archived_at = NULL' : `muted = ${action === 'mute' ? 'true' : 'false'}`},
                     updated_at = now()
                 WHERE conversation_id = $1 AND user_id = $2`, [conversationId, session.userId]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'conversation_not_found' });
            return { status: action };
        });
    }

    server.post<{ Params: { userId: string } }>('/api/v1/direct-messages/blocks/:userId', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const targetId = request.params.userId;
        if (!validId(targetId) || targetId === session.userId) return reply.code(400).send({ error: 'invalid_block_target' });
        const exists = await pool.query(`SELECT 1 FROM impacta.users WHERE id = $1 AND status = 'active'`, [targetId]);
        if (!exists.rowCount) return reply.code(404).send({ error: 'profile_not_found' });
        await transaction(pool, async (client) => {
            await lockPair(client, session.userId, targetId);
            await client.query(
                `INSERT INTO impacta.direct_message_blocks (blocker_user_id, blocked_user_id)
                 VALUES ($1, $2) ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`, [session.userId, targetId]
            );
            await client.query(
                `UPDATE impacta.direct_message_requests
                 SET status = 'declined', responded_at = now()
                 WHERE status = 'pending'
                   AND LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
                   AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)`,
                [session.userId, targetId]
            );
        });
        return { status: 'blocked' };
    });

    server.get('/api/v1/direct-messages/blocks', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query(
            `SELECT block.blocked_user_id::text AS user_id,
                    COALESCE(account.display_name, 'Conta encerrada') AS display_name,
                    CASE WHEN profile.is_public AND avatar.status = 'available' AND avatar.media_type = 'image'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url,
                    block.created_at
             FROM impacta.direct_message_blocks AS block
             LEFT JOIN impacta.users AS account ON account.id = block.blocked_user_id
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
             WHERE block.blocker_user_id = $1 ORDER BY block.created_at DESC LIMIT 100`, [session.userId]
        );
        return { items: result.rows };
    });

    server.delete<{ Params: { userId: string } }>('/api/v1/direct-messages/blocks/:userId', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const targetId = request.params.userId;
        if (!validId(targetId) || targetId === session.userId) return reply.code(400).send({ error: 'invalid_block_target' });
        const result = await pool.query(
            `DELETE FROM impacta.direct_message_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
            [session.userId, targetId]
        );
        if (!result.rowCount) return reply.code(404).send({ error: 'block_not_found' });
        return { status: 'unblocked' };
    });

    server.post<{ Params: { messageId: string }; Body: { reasonCode?: unknown; details?: unknown } }>(
        '/api/v1/direct-messages/messages/:messageId/report', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const messageId = request.params.messageId;
            const reason = request.body?.reasonCode;
            const details = typeof request.body?.details === 'string' ? request.body.details.trim().slice(0, 500) : '';
            if (!validId(messageId) || !['spam', 'harassment', 'threat', 'other'].includes(String(reason))) {
                return reply.code(400).send({ error: 'invalid_message_report' });
            }
            const message = await pool.query<{ author_user_id: string }>(
                `SELECT message.author_user_id::text AS author_user_id
                 FROM impacta.direct_messages AS message
                 JOIN impacta.direct_conversation_members AS member
                   ON member.conversation_id = message.conversation_id AND member.user_id = $2
                 WHERE message.id = $1 AND message.deleted_at IS NULL`, [messageId, session.userId]
            );
            const authorId = message.rows[0]?.author_user_id;
            if (!authorId || authorId === session.userId) return reply.code(404).send({ error: 'message_not_found' });
            const count = await pool.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM impacta.content_reports
                 WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'`, [session.userId]
            );
            if ((count.rows[0]?.count ?? 0) >= 10) return reply.code(429).send({ error: 'report_limit_reached' });
            const report = await pool.query(
                `INSERT INTO impacta.content_reports (reporter_user_id, direct_message_id, reason_code, details)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (reporter_user_id, direct_message_id)
                 WHERE reporter_user_id IS NOT NULL AND direct_message_id IS NOT NULL
                   AND status IN ('open', 'reviewing') DO NOTHING`,
                [session.userId, messageId, reason, details || null]
            );
            return reply.code(report.rowCount ? 201 : 200).send({ status: report.rowCount ? 'reported' : 'already_reported' });
        }
    );
}

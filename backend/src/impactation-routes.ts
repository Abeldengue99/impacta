import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireSession } from './community-routes.js';

function validId(value: string | undefined): value is string {
    if (!value || !/^[1-9]\d{0,18}$/.test(value)) return false;
    try { return BigInt(value) <= 9223372036854775807n; } catch { return false; }
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

async function authenticated(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    csrf: boolean
) {
    return requireSession(request, reply, pool, csrf);
}

export function registerImpactationRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/profile/impactations', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const result = await pool.query(
            `SELECT account.id::text AS id, account.display_name,
                    profile.is_public,
                    CASE WHEN profile.is_public THEN profile.headline END AS headline,
                    CASE WHEN profile.is_public AND avatar.status = 'available'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url,
                    connection.responded_at AS connected_at
             FROM impacta.impactation_requests AS connection
             JOIN impacta.users AS account
               ON account.id = CASE WHEN connection.requester_user_id = $1::bigint
                                    THEN connection.recipient_user_id ELSE connection.requester_user_id END
              AND account.status = 'active'
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
             WHERE connection.status = 'accepted'
               AND (connection.requester_user_id = $1::bigint OR connection.recipient_user_id = $1::bigint)
             ORDER BY connection.responded_at DESC NULLS LAST, connection.id DESC`,
            [session.userId]
        );
        return { items: result.rows };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/profiles/:userId/impactations', async (request, reply) => {
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
            `SELECT account.id::text AS id, account.display_name,
                    profile.is_public, profile.headline,
                    CASE WHEN avatar.status = 'available' AND avatar.media_type = 'image'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url,
                    connection.responded_at AS connected_at
             FROM impacta.impactation_requests AS connection
             JOIN impacta.users AS account
               ON account.id = CASE WHEN connection.requester_user_id = $1::bigint
                                    THEN connection.recipient_user_id ELSE connection.requester_user_id END
              AND account.status = 'active'
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             LEFT JOIN impacta.media AS avatar ON avatar.id = profile.avatar_media_id
             WHERE connection.status = 'accepted'
               AND (connection.requester_user_id = $1::bigint OR connection.recipient_user_id = $1::bigint)
             ORDER BY connection.responded_at DESC NULLS LAST, connection.id DESC`,
            [userId]
        );
        return { items: result.rows };
    });

    server.get<{ Querystring: { query?: string } }>('/api/v1/people', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const query = request.query.query?.trim().replace(/[\\%_]/g, '\\$&') ?? '';
        if (Array.from(query).length < 2 || Array.from(query).length > 60) {
            return reply.code(400).send({ error: 'invalid_people_query' });
        }
        const result = await pool.query(
            `SELECT matches.id, matches.display_name, matches.headline,
                    CASE WHEN avatar.status = 'available' AND avatar.media_type = 'image'
                         THEN '/api/v1/media/' || avatar.id::text END AS avatar_url
             FROM (
                 SELECT DISTINCT ON (lower(account.display_name))
                        account.id::text AS id, account.display_name, profile.headline,
                        profile.avatar_media_id
                 FROM impacta.users AS account
                 JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
                 WHERE account.status = 'active' AND profile.is_public
                   AND account.id <> $2::bigint
                   AND (account.display_name ILIKE $1 ESCAPE '\\'
                        OR COALESCE(profile.headline, '') ILIKE $1 ESCAPE '\\')
                 ORDER BY lower(account.display_name), account.id
             ) AS matches
             LEFT JOIN impacta.media AS avatar ON avatar.id = matches.avatar_media_id
             ORDER BY matches.display_name
             LIMIT 8`,
            [`%${query}%`, session.userId]
        );
        return { items: result.rows };
    });

    server.get<{ Params: { userId: string } }>('/api/v1/impactations/status/:userId', async (request, reply) => {
        const session = await authenticated(request, reply, pool, false);
        if (!session) return;
        const targetId = request.params.userId;
        if (!validId(targetId)) return reply.code(400).send({ error: 'invalid_user_id' });
        if (targetId === session.userId) return { status: 'self' };

        const target = await pool.query(
            `SELECT 1 FROM impacta.users AS account
             JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
             WHERE account.id = $1 AND account.status = 'active'`,
            [targetId]
        );
        if (!target.rowCount) return reply.code(404).send({ error: 'profile_not_found' });

        const [result, countResult] = await Promise.all([pool.query<{
            id: string; requester_user_id: string; status: 'pending' | 'accepted';
        }>(
            `SELECT id::text AS id, requester_user_id::text AS requester_user_id, status
             FROM impacta.impactation_requests
             WHERE LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
               AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)
               AND status IN ('pending', 'accepted')
             LIMIT 1`,
            [session.userId, targetId]
        ), pool.query<{ impactation_count: number }>(
            `SELECT count(*)::int AS impactation_count FROM impacta.impactation_requests
             WHERE status = 'accepted' AND (requester_user_id = $1 OR recipient_user_id = $1)`,
            [targetId]
        )]);
        const impactationCount = countResult.rows[0]?.impactation_count ?? 0;
        const relationship = result.rows[0];
        if (!relationship) return { status: 'none', impactationCount };
        if (relationship.status === 'accepted') return { status: 'connected', impactationCount };
        return {
            status: relationship.requester_user_id === session.userId ? 'outgoing_pending' : 'incoming_pending',
            requestId: relationship.id,
            impactationCount
        };
    });

    server.post<{ Params: { userId: string } }>('/api/v1/impactations/:userId', async (request, reply) => {
        const session = await authenticated(request, reply, pool, true);
        if (!session) return;
        const targetId = request.params.userId;
        if (!validId(targetId)) return reply.code(400).send({ error: 'invalid_user_id' });
        if (targetId === session.userId) return reply.code(400).send({ error: 'cannot_impact_self' });

        const result = await transaction(pool, async (client) => {
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtextextended(
                    'impacta:impactation:' || LEAST($1::bigint, $2::bigint)::text || ':' ||
                    GREATEST($1::bigint, $2::bigint)::text, 0))`,
                [session.userId, targetId]
            );
            const target = await client.query(
                `SELECT account.id FROM impacta.users AS account
                 JOIN impacta.user_profiles AS profile ON profile.user_id = account.id AND profile.is_public
                 WHERE account.id = $1 AND account.status = 'active' FOR UPDATE OF account`,
                [targetId]
            );
            if (!target.rowCount) return { error: 'profile_not_found' as const };
            const existing = await client.query<{
                id: string; requester_user_id: string; status: string;
            }>(
                `SELECT id::text AS id, requester_user_id::text AS requester_user_id, status
                 FROM impacta.impactation_requests
                 WHERE LEAST(requester_user_id, recipient_user_id) = LEAST($1::bigint, $2::bigint)
                   AND GREATEST(requester_user_id, recipient_user_id) = GREATEST($1::bigint, $2::bigint)
                   AND status IN ('pending', 'accepted')
                 FOR UPDATE`,
                [session.userId, targetId]
            );
            if (existing.rows[0]) {
                const current = existing.rows[0];
                if (current.status === 'accepted') return { status: 'connected' as const };
                return {
                    status: current.requester_user_id === session.userId ? 'outgoing_pending' as const : 'incoming_pending' as const,
                    requestId: current.id
                };
            }
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtextextended('impacta:impactation:limit:' || $1::text, 0))",
                [session.userId]
            );
            const recent = await client.query<{ count: number }>(
                `SELECT count(*)::int AS count FROM impacta.impactation_requests
                 WHERE requester_user_id = $1 AND created_at > now() - interval '1 hour'`,
                [session.userId]
            );
            if (recent.rows[0]?.count >= 15) return { error: 'impactation_rate_limit' as const };
            const inserted = await client.query<{ id: string }>(
                `INSERT INTO impacta.impactation_requests (requester_user_id, recipient_user_id)
                 VALUES ($1, $2) RETURNING id::text AS id`,
                [session.userId, targetId]
            );
            const requestId = inserted.rows[0].id;
            await client.query(
                `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                 VALUES ($1, 'impactation_request', jsonb_build_object(
                     'actor_user_id', $2::text, 'request_id', $3::text
                 ))`,
                [targetId, session.userId, requestId]
            );
            return { status: 'outgoing_pending' as const, requestId };
        });
        if ('error' in result) {
            return reply.code(result.error === 'impactation_rate_limit' ? 429 : 404).send({ error: result.error });
        }
        return result;
    });

    server.post<{ Params: { requestId: string }; Body: { decision?: unknown } }>(
        '/api/v1/impactations/requests/:requestId/respond', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const requestId = request.params.requestId;
            const decision = request.body?.decision;
            if (!validId(requestId)) return reply.code(400).send({ error: 'invalid_impactation_request' });
            if (decision !== 'accept' && decision !== 'decline') {
                return reply.code(400).send({ error: 'invalid_impactation_decision' });
            }
            const result = await transaction(pool, async (client) => {
                const current = await client.query<{
                    id: string; requester_user_id: string; recipient_user_id: string; status: string;
                }>(
                    `SELECT id::text AS id, requester_user_id::text AS requester_user_id,
                            recipient_user_id::text AS recipient_user_id, status
                     FROM impacta.impactation_requests WHERE id = $1 FOR UPDATE`,
                    [requestId]
                );
                const item = current.rows[0];
                if (!item || item.recipient_user_id !== session.userId) return { error: 'impactation_request_not_found' as const };
                if (item.status !== 'pending') return { error: 'impactation_request_already_handled' as const };
                const status = decision === 'accept' ? 'accepted' : 'declined';
                await client.query(
                    `UPDATE impacta.impactation_requests SET status = $2, responded_at = now() WHERE id = $1`,
                    [requestId, status]
                );
                await client.query(
                    `UPDATE impacta.notifications SET read_at = COALESCE(read_at, now())
                     WHERE user_id = $1 AND notification_type = 'impactation_request'
                       AND payload->>'request_id' = $2`,
                    [session.userId, requestId]
                );
                if (decision === 'accept') {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         VALUES ($1, 'impactation_accepted', jsonb_build_object(
                             'actor_user_id', $2::text, 'request_id', $3::text
                         ))`,
                        [item.requester_user_id, session.userId, requestId]
                    );
                } else {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         VALUES ($1, 'impactation_declined', jsonb_build_object(
                             'actor_user_id', $2::text, 'request_id', $3::text
                         ))`,
                        [item.requester_user_id, session.userId, requestId]
                    );
                }
                return { status };
            });
            if ('error' in result) {
                return reply.code(result.error === 'impactation_request_not_found' ? 404 : 409)
                    .send({ error: result.error });
            }
            return result;
        }
    );

    server.post<{ Params: { requestId: string } }>(
        '/api/v1/impactations/requests/:requestId/cancel', async (request, reply) => {
            const session = await authenticated(request, reply, pool, true);
            if (!session) return;
            const requestId = request.params.requestId;
            if (!validId(requestId)) return reply.code(400).send({ error: 'invalid_impactation_request' });
            const cancelled = await transaction(pool, async (client) => {
                const result = await client.query<{ recipient_user_id: string }>(
                    `UPDATE impacta.impactation_requests SET status = 'cancelled', responded_at = now()
                     WHERE id = $1 AND requester_user_id = $2 AND status = 'pending'
                     RETURNING recipient_user_id::text AS recipient_user_id`,
                    [requestId, session.userId]
                );
                if (!result.rows[0]) return false;
                await client.query(
                    `UPDATE impacta.notifications SET read_at = COALESCE(read_at, now())
                     WHERE user_id = $1 AND notification_type = 'impactation_request'
                       AND payload->>'request_id' = $2`,
                    [result.rows[0].recipient_user_id, requestId]
                );
                return true;
            });
            if (!cancelled) return reply.code(404).send({ error: 'impactation_request_not_found' });
            return { status: 'none' };
        }
    );
}

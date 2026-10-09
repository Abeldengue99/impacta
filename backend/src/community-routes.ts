import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

interface SessionRecord {
    user_id: string;
    display_name: string;
    csrf_token_hash: string | null;
}

interface AuthenticatedSession {
    userId: string;
    displayName: string;
    csrfTokenHash: string | null;
}

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

function cleanText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.trim();
    const length = Array.from(cleaned).length;
    if (!cleaned || length > maxLength || cleaned.includes('\u0000')) return undefined;
    return cleaned;
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
         RETURNING auth_session.user_id::text AS user_id,
                   account.display_name,
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
                    NULL::text AS csrf_token_hash
             FROM impacta.auth_sessions AS auth_session
             JOIN impacta.users AS account ON account.id = auth_session.user_id
             WHERE auth_session.token_hash = $1
               AND auth_session.revoked_at IS NULL
               AND auth_session.idle_expires_at > now()
               AND auth_session.absolute_expires_at > now()
               AND account.status = 'active'
             LIMIT 1`,
            [tokenHash(token)]
        );
        sessionRows = result.rows;
    }
    const row = sessionRows[0];
    return row
        ? { userId: row.user_id, displayName: row.display_name, csrfTokenHash: row.csrf_token_hash }
        : null;
}

async function requireSession(
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

async function beginLimitedWrite(
    client: PoolClient,
    userId: string,
    action: 'post' | 'comment' | 'challenge' | 'report',
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
        report: 'SELECT count(*)::int AS count FROM impacta.content_reports WHERE reporter_user_id = $1 AND created_at > now() - interval \'1 hour\''
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

function requestId(request: FastifyRequest, key: string): string | undefined {
    const params = request.params as Record<string, string>;
    const id = params[key];
    return id && validId(id) ? id : undefined;
}

/** Community content is read from PostgreSQL; all mutations require a live session and CSRF token. */
export function registerCommunityRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/feed/posts', async (request) => {
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT post.id::text AS id,
                    post.body,
                    post.created_at,
                    COALESCE(author.display_name, 'Conta encerrada') AS author,
                    community.name AS community,
                    (post.author_user_id = $1::bigint) AS is_author,
                    EXISTS (SELECT 1 FROM impacta.reactions AS viewer_reaction
                            WHERE viewer_reaction.post_id = post.id
                              AND viewer_reaction.user_id = $1::bigint) AS supported_by_viewer,
                    (SELECT count(reaction.user_id)::int FROM impacta.reactions AS reaction
                     WHERE reaction.post_id = post.id) AS support_count,
                    (SELECT count(comment.id)::int FROM impacta.comments AS comment
                     WHERE comment.post_id = post.id AND comment.status = 'published'
                       AND comment.deleted_at IS NULL) AS comment_count
             FROM impacta.posts AS post
             LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
             LEFT JOIN impacta.communities AS community ON community.id = post.community_id
             WHERE post.status = 'published' AND post.deleted_at IS NULL
               AND (post.author_user_id IS NULL OR author.status = 'active')
               AND (post.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY post.created_at DESC, post.id DESC
             LIMIT 50`,
            [session?.userId ?? null]
        );
        return { items: result.rows };
    });

    server.post<{ Body: { body?: unknown } }>('/api/v1/feed/posts', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const body = cleanText(request.body?.body, 2000);
        if (!body) return reply.code(400).send({ error: 'invalid_post_body' });

        const post = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'post', 10)) return null;
            const inserted = await client.query<{ id: string; created_at: Date }>(
                `INSERT INTO impacta.posts (author_user_id, body)
                 VALUES ($1, $2)
                 RETURNING id::text AS id, created_at`,
                [session.userId, body]
            );
            return inserted.rows[0];
        });
        if (!post) return reply.code(429).send({ error: 'post_rate_limit' });
        return reply.code(201).send({
            id: post.id,
            body,
            created_at: post.created_at,
            author: session.displayName,
            community: null,
            is_author: true,
            supported_by_viewer: false,
            support_count: 0,
            comment_count: 0
        });
    });

    server.delete<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
        const removed = await pool.query(
            `UPDATE impacta.posts
             SET status = 'removed', deleted_at = now()
             WHERE id = $1 AND author_user_id = $2 AND status = 'published' AND deleted_at IS NULL
             RETURNING id`,
            [postId, session.userId]
        );
        if (removed.rowCount === 0) return reply.code(404).send({ error: 'post_not_found' });
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
                `SELECT 1 FROM impacta.posts AS post
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE post.id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))`,
                [postId]
            );
            if (visible.rowCount === 0) return null;

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

    server.get<{ Params: { postId: string } }>('/api/v1/feed/posts/:postId/comments', async (request, reply) => {
        const postId = requestId(request, 'postId');
        if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
        const result = await pool.query(
            `SELECT comment.id::text AS id,
                    comment.body,
                    comment.created_at,
                    COALESCE(author.display_name, 'Conta encerrada') AS author
             FROM (
                 SELECT comment.id, comment.body, comment.created_at, comment.author_user_id
                 FROM impacta.comments AS comment
                 JOIN impacta.posts AS post ON post.id = comment.post_id
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE comment.post_id = $1 AND comment.status = 'published' AND comment.deleted_at IS NULL
                   AND post.status = 'published' AND post.deleted_at IS NULL
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))
                 ORDER BY comment.created_at DESC, comment.id DESC
                 LIMIT 50
             ) AS comment
             LEFT JOIN impacta.users AS author ON author.id = comment.author_user_id
             ORDER BY comment.created_at, comment.id`,
            [postId]
        );
        return { items: result.rows };
    });

    server.post<{ Params: { postId: string }; Body: { body?: unknown } }>(
        '/api/v1/feed/posts/:postId/comments', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const postId = requestId(request, 'postId');
            if (!postId) return reply.code(400).send({ error: 'invalid_post_id' });
            const body = cleanText(request.body?.body, 1000);
            if (!body) return reply.code(400).send({ error: 'invalid_comment_body' });

            const comment = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'comment', 30)) return null;
                const visible = await client.query(
                    `SELECT 1 FROM impacta.posts AS post
                     LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                     WHERE post.id = $1 AND post.status = 'published' AND post.deleted_at IS NULL
                       AND (post.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))`,
                    [postId]
                );
                if (visible.rowCount === 0) return undefined;
                const inserted = await client.query<{ id: string; created_at: Date }>(
                    `INSERT INTO impacta.comments (post_id, author_user_id, body)
                     VALUES ($1, $2, $3)
                     RETURNING id::text AS id, created_at`,
                    [postId, session.userId, body]
                );
                return inserted.rows[0];
            });
            if (comment === null) return reply.code(429).send({ error: 'comment_rate_limit' });
            if (!comment) return reply.code(404).send({ error: 'post_not_found' });
            return reply.code(201).send({
                id: comment.id, body, created_at: comment.created_at, author: session.displayName
            });
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
            if (!reasonCode || !['spam', 'harassment', 'harmful', 'misinformation', 'other'].includes(reasonCode)) {
                return reply.code(400).send({ error: 'invalid_report_reason' });
            }
            if (details === undefined) return reply.code(400).send({ error: 'invalid_report_details' });
            const report = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'report', 10)) return null;
                const inserted = await client.query<{ id: string }>(
                `INSERT INTO impacta.content_reports (reporter_user_id, post_id, reason_code, details)
                 SELECT $1, post.id, $3, $4
                 FROM impacta.posts AS post
                 LEFT JOIN impacta.communities AS community ON community.id = post.community_id
                 WHERE post.id = $2 AND post.status = 'published' AND post.deleted_at IS NULL
                   AND (post.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))
                 RETURNING id::text AS id`,
                    [session.userId, postId, reasonCode, details]
                );
                return inserted.rows[0]?.id ?? undefined;
            });
            if (report === null) return reply.code(429).send({ error: 'report_rate_limit' });
            if (!report) return reply.code(404).send({ error: 'post_not_found' });
            return reply.code(201).send({ status: 'reported', id: report });
        }
    );

    server.get('/api/v1/challenges', async (request) => {
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT challenge.id::text AS id,
                    challenge.title,
                    challenge.description,
                    challenge.opens_at,
                    challenge.closes_at,
                    area.name AS impact_area,
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
             WHERE challenge.status = 'open'
               AND (challenge.project_id IS NULL OR project.status = 'active')
               AND (challenge.opens_at IS NULL OR challenge.opens_at <= now())
               AND (challenge.closes_at IS NULL OR challenge.closes_at > now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY challenge.opens_at NULLS FIRST, challenge.id DESC
             LIMIT 30`,
            [session?.userId ?? null]
        );
        return { items: result.rows };
    });

    server.post<{ Params: { challengeId: string }; Body: { submission?: unknown } }>(
        '/api/v1/challenges/:challengeId/participations', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const challengeId = requestId(request, 'challengeId');
            const submission = cleanText(request.body?.submission, 2000);
            if (!challengeId) return reply.code(400).send({ error: 'invalid_challenge_id' });
            if (!submission) return reply.code(400).send({ error: 'invalid_submission' });

            const status = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'challenge', 10)) return 'rate_limit';
                const open = await client.query(
                    `SELECT 1 FROM impacta.challenges AS challenge
                     LEFT JOIN impacta.projects AS project ON project.id = challenge.project_id
                     LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                     WHERE challenge.id = $1 AND challenge.status = 'open'
                       AND (challenge.opens_at IS NULL OR challenge.opens_at <= now())
                       AND (challenge.closes_at IS NULL OR challenge.closes_at > now())
                       AND (challenge.project_id IS NULL OR project.status = 'active')
                       AND (project.community_id IS NULL OR
                            (community.status = 'active' AND community.visibility = 'public'))`,
                    [challengeId]
                );
                if (open.rowCount === 0) return 'not_found';
                await client.query(
                    `INSERT INTO impacta.challenge_participations (challenge_id, user_id, submission)
                     VALUES ($1, $2, $3)`,
                    [challengeId, session.userId, submission]
                );
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

    server.get('/api/v1/projects', async (request) => {
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT project.id::text AS id,
                    project.title,
                    project.description,
                    area.name AS impact_area,
                    community.name AS community,
                    EXISTS (SELECT 1 FROM impacta.project_members AS mine
                            WHERE mine.project_id = project.id AND mine.user_id = $1::bigint) AS viewer_participates,
                    (SELECT count(member.project_id)::int FROM impacta.project_members AS member
                     WHERE member.project_id = project.id) AS participant_count
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.impact_areas AS area ON area.id = project.impact_area_id
             WHERE project.status = 'active'
               AND (project.starts_at IS NULL OR project.starts_at <= now())
               AND (project.ends_at IS NULL OR project.ends_at >= now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ORDER BY project.created_at DESC, project.id DESC
             LIMIT 30`,
            [session?.userId ?? null]
        );
        return { items: result.rows };
    });

    server.post<{ Params: { projectId: string } }>('/api/v1/projects/:projectId/members', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = requestId(request, 'projectId');
        if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
        const joined = await pool.query(
            `INSERT INTO impacta.project_members (project_id, user_id)
             SELECT project.id, $2
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             WHERE project.id = $1 AND project.status = 'active'
               AND (project.starts_at IS NULL OR project.starts_at <= now())
               AND (project.ends_at IS NULL OR project.ends_at >= now())
               AND (project.community_id IS NULL OR
                    (community.status = 'active' AND community.visibility = 'public'))
             ON CONFLICT (project_id, user_id) DO NOTHING
             RETURNING project_id`,
            [projectId, session.userId]
        );
        if (joined.rowCount === 0) {
            const exists = await pool.query(
                `SELECT 1 FROM impacta.projects AS project
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 WHERE project.id = $1 AND project.status = 'active'
                   AND (project.starts_at IS NULL OR project.starts_at <= now())
                   AND (project.ends_at IS NULL OR project.ends_at >= now())
                   AND (project.community_id IS NULL OR
                        (community.status = 'active' AND community.visibility = 'public'))`,
                [projectId]
            );
            if (exists.rowCount === 0) return reply.code(404).send({ error: 'project_not_found' });
        }
        return { status: 'joined' };
    });

    server.get('/api/v1/communities', async (request) => {
        const session = await findSession(request, pool, false);
        const result = await pool.query(
            `SELECT community.id::text AS id,
                    community.name,
                    community.slug,
                    community.description,
                    area.name AS impact_area,
                    EXISTS (SELECT 1 FROM impacta.community_members AS mine
                            WHERE mine.community_id = community.id AND mine.user_id = $1::bigint
                              AND mine.status = 'active') AS viewer_member,
                    (SELECT count(member.user_id)::int FROM impacta.community_members AS member
                     WHERE member.community_id = community.id AND member.status = 'active') AS member_count
             FROM impacta.communities AS community
             LEFT JOIN impacta.impact_areas AS area ON area.id = community.impact_area_id
             WHERE community.status = 'active' AND community.visibility = 'public'
             ORDER BY community.name, community.id
             LIMIT 30`,
            [session?.userId ?? null]
        );
        return { items: result.rows };
    });

    server.post<{ Params: { communityId: string } }>('/api/v1/communities/:communityId/members', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const communityId = requestId(request, 'communityId');
        if (!communityId) return reply.code(400).send({ error: 'invalid_community_id' });
        const joined = await pool.query(
            `INSERT INTO impacta.community_members (community_id, user_id, status)
             SELECT id, $2, 'active' FROM impacta.communities
             WHERE id = $1 AND status = 'active' AND visibility = 'public'
             ON CONFLICT (community_id, user_id) DO NOTHING
             RETURNING community_id`,
            [communityId, session.userId]
        );
        if (joined.rowCount === 0) {
            const exists = await pool.query(
                "SELECT 1 FROM impacta.communities WHERE id = $1 AND status = 'active' AND visibility = 'public'",
                [communityId]
            );
            if (exists.rowCount === 0) return reply.code(404).send({ error: 'community_not_found' });
        }
        return { status: 'joined' };
    });
}

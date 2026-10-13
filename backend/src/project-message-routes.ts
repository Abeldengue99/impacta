import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { findFeedPolicyViolation } from './community-content-policy.js';
import { requireSession } from './community-routes.js';

interface ProjectChatAccess {
    id: string;
    title: string;
    status: 'active' | 'completed';
    is_member: boolean;
    is_owner: boolean;
    can_send: boolean;
}

function validId(id: string | undefined): id is string {
    if (!id || !/^[1-9]\d{0,18}$/.test(id)) return false;
    try { return BigInt(id) <= 9223372036854775807n; } catch { return false; }
}

function paramId(request: FastifyRequest, key: string): string | undefined {
    return validId((request.params as Record<string, string | undefined>)[key])
        ? (request.params as Record<string, string>)[key]
        : undefined;
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

async function projectChatAccess(pool: Pool, projectId: string, userId: string): Promise<ProjectChatAccess | null> {
    const result = await pool.query<ProjectChatAccess>(
        `SELECT project.id::text AS id, project.title, project.status,
                (project.owner_user_id = $2 OR community.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM impacta.project_members AS member
                    WHERE member.project_id = project.id AND member.user_id = $2
                ) OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS manager
                    WHERE manager.community_id = community.id AND manager.user_id = $2
                      AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                )) AS is_member,
                (project.owner_user_id = $2 OR community.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS manager
                    WHERE manager.community_id = community.id AND manager.user_id = $2
                      AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                )) AS is_owner,
                (project.status = 'active' AND (project.ends_at IS NULL OR project.ends_at >= now())) AS can_send
         FROM impacta.projects AS project
         LEFT JOIN impacta.communities AS community ON community.id = project.community_id
         WHERE project.id = $1 AND project.status IN ('active', 'completed')
           AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))`,
        [projectId, userId]
    );
    const access = result.rows[0];
    return access?.is_member ? access : null;
}

async function beginLimitedWrite(client: PoolClient, userId: string, action: 'message' | 'report', limit: number): Promise<boolean> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('impacta:project-message:' || $1 || ':' || $2, 0))",
        [userId, action]
    );
    const result = action === 'message'
        ? await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM impacta.project_messages
             WHERE (author_user_id = $1 AND created_at > now() - interval '1 hour')
                OR (edited_by_user_id = $1 AND edited_at > now() - interval '1 hour')
                OR (deleted_by_user_id = $1 AND deleted_at > now() - interval '1 hour')`, [userId]
        )
        : await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM impacta.content_reports
             WHERE reporter_user_id = $1 AND created_at > now() - interval '1 hour'`, [userId]
        );
    return (result.rows[0]?.count ?? limit) < limit;
}

async function projectMembershipForWrite(client: PoolClient, projectId: string, userId: string): Promise<ProjectChatAccess | null> {
    const result = await client.query<ProjectChatAccess>(
        `SELECT project.id::text AS id, project.title, project.status,
                (project.owner_user_id = $2 OR community.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM impacta.project_members AS member
                    WHERE member.project_id = project.id AND member.user_id = $2
                ) OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS manager
                    WHERE manager.community_id = community.id AND manager.user_id = $2
                      AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                )) AS is_member,
                (project.owner_user_id = $2 OR community.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM impacta.community_members AS manager
                    WHERE manager.community_id = community.id AND manager.user_id = $2
                      AND manager.status = 'active' AND manager.membership_role IN ('manager', 'moderator')
                )) AS is_owner,
                (project.status = 'active' AND (project.ends_at IS NULL OR project.ends_at >= now())) AS can_send
         FROM impacta.projects AS project
         LEFT JOIN impacta.communities AS community ON community.id = project.community_id
         WHERE project.id = $1 AND project.status IN ('active', 'completed')
           AND (project.community_id IS NULL OR (community.status = 'active' AND community.visibility = 'public'))
         FOR SHARE OF project`,
        [projectId, userId]
    );
    const access = result.rows[0];
    return access?.is_member ? access : null;
}

/** Private, text-only team rooms attached to active IMPACTA projects. */
export function registerProjectMessageRoutes(server: FastifyInstance, pool: Pool): void {
    server.get<{
        Params: { projectId: string };
        Querystring: { after?: string; before?: string };
    }>('/api/v1/projects/:projectId/messages', async (request, reply) => {
        const session = await requireSession(request, reply, pool, false);
        if (!session) return;
        const projectId = paramId(request, 'projectId');
        const after = request.query?.after;
        const before = request.query?.before;
        if (!projectId || (after !== undefined && after !== '0' && !validId(after))
            || (before !== undefined && !validId(before)) || (after !== undefined && before !== undefined)) {
            return reply.code(400).send({ error: 'invalid_project_messages_query' });
        }
        const access = await projectChatAccess(pool, projectId, session.userId);
        if (!access) return reply.code(404).send({ error: 'project_conversation_not_found' });

        const query = `SELECT message.id::text AS id,
                              message.author_user_id::text AS author_user_id,
                              COALESCE(author.display_name, 'Conta encerrada') AS author,
                              message.body, message.created_at, message.edited_at, message.deleted_at
                       FROM impacta.project_messages AS message
                       LEFT JOIN impacta.users AS author ON author.id = message.author_user_id
                       WHERE message.project_id = $1`;
        const params: string[] = [projectId];
        let result;
        if (after) {
            params.push(after);
            result = await pool.query(`${query} AND message.id > $2 ORDER BY message.id ASC LIMIT 60`, params);
        } else if (before) {
            params.push(before);
            result = await pool.query(`${query} AND message.id < $2 ORDER BY message.id DESC LIMIT 61`, params);
        } else {
            result = await pool.query(`${query} ORDER BY message.id DESC LIMIT 61`, params);
        }
        const hasMore = !after && result.rows.length > 60;
        const rows = hasMore ? result.rows.slice(0, 60) : result.rows;
        const items = (after ? rows : rows.reverse()).map((message: Record<string, any>) => {
            const isAuthor = message.author_user_id === session.userId;
            const isDeleted = Boolean(message.deleted_at);
            const canEdit = isAuthor && !isDeleted
                && new Date(message.created_at).getTime() > Date.now() - 15 * 60_000;
            const { author_user_id: _authorUserId, deleted_at: _deletedAt, edited_at: _editedAt, ...item } = message;
            return {
                ...item,
                body: isDeleted ? null : item.body,
                is_author: isAuthor,
                is_deleted: isDeleted,
                edited: Boolean(message.edited_at),
                can_edit: canEdit,
                can_delete: !isDeleted && (isAuthor || access.is_owner)
            };
        });
        const state = await pool.query<{ muted: boolean; unread_count: number }>(
            `SELECT COALESCE(preference.muted, false) AS muted,
                    (SELECT count(*)::int FROM impacta.project_messages AS message
                     WHERE message.project_id = $1 AND message.author_user_id <> $2
                       AND message.deleted_at IS NULL
                       AND message.id > COALESCE(read_state.last_read_message_id, 0)) AS unread_count
             FROM (SELECT 1) AS anchor
             LEFT JOIN impacta.project_message_preferences AS preference
               ON preference.project_id = $1 AND preference.user_id = $2
             LEFT JOIN impacta.project_message_reads AS read_state
               ON read_state.project_id = $1 AND read_state.user_id = $2`,
            [projectId, session.userId]
        );
        return {
            items,
            has_more: hasMore,
            project_title: access.title,
            is_owner: access.is_owner,
            can_send: access.can_send,
            muted: state.rows[0]?.muted ?? false,
            unread_count: state.rows[0]?.unread_count ?? 0
        };
    });

    server.post<{
        Params: { projectId: string };
        Body: { body?: unknown };
    }>('/api/v1/projects/:projectId/messages', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = paramId(request, 'projectId');
        const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
        if (!projectId || !body || Array.from(body).length > 1200 || body.includes('\u0000')) {
            return reply.code(400).send({ error: 'invalid_project_message' });
        }
        if (findFeedPolicyViolation(body)) return reply.code(422).send({ error: 'feed_content_not_allowed' });
        const outcome = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'message', 30)) return { status: 'rate_limit' as const };
            const access = await projectMembershipForWrite(client, projectId, session.userId);
            if (!access) return { status: 'not_found' as const };
            if (!access.can_send) return { status: 'closed' as const };
            const inserted = await client.query<{ id: string; created_at: Date }>(
                `INSERT INTO impacta.project_messages (project_id, author_user_id, body)
                 VALUES ($1, $2, $3)
                 RETURNING id::text AS id, created_at`,
                [projectId, session.userId, body]
            );
            return { status: 'sent' as const, item: {
                ...inserted.rows[0], author: session.displayName, body,
                is_author: true, is_deleted: false, edited: false, can_edit: true, can_delete: true
            } };
        });
        if (outcome.status === 'rate_limit') return reply.code(429).send({ error: 'project_message_rate_limit' });
        if (outcome.status === 'not_found') return reply.code(404).send({ error: 'project_conversation_not_found' });
        if (outcome.status === 'closed') return reply.code(409).send({ error: 'project_chat_closed' });
        return reply.code(201).send({ item: outcome.item });
    });

    server.put<{
        Params: { projectId: string; messageId: string };
        Body: { body?: unknown };
    }>('/api/v1/projects/:projectId/messages/:messageId', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = paramId(request, 'projectId');
        const messageId = paramId(request, 'messageId');
        const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';
        if (!projectId || !messageId || !body || Array.from(body).length > 1200 || body.includes('\u0000')) {
            return reply.code(400).send({ error: 'invalid_project_message' });
        }
        if (findFeedPolicyViolation(body)) return reply.code(422).send({ error: 'feed_content_not_allowed' });
        const outcome = await transaction(pool, async (client) => {
            if (!await beginLimitedWrite(client, session.userId, 'message', 30)) return 'rate_limit' as const;
            const access = await projectMembershipForWrite(client, projectId, session.userId);
            if (!access) return 'not_found' as const;
            const updated = await client.query<{ id: string; body: string; created_at: Date; edited_at: Date }>(
                `UPDATE impacta.project_messages
                 SET body = $3, edited_at = now(), edited_by_user_id = $4
                 WHERE id = $1 AND project_id = $2 AND author_user_id = $4 AND deleted_at IS NULL
                   AND created_at > now() - interval '15 minutes'
                 RETURNING id::text AS id, body, created_at, edited_at`,
                [messageId, projectId, body, session.userId]
            );
            return updated.rows[0] ?? 'not_found' as const;
        });
        if (outcome === 'rate_limit') return reply.code(429).send({ error: 'project_message_rate_limit' });
        if (outcome === 'not_found') return reply.code(404).send({ error: 'project_message_not_found' });
        return { item: { ...outcome, author: session.displayName, is_author: true,
            is_deleted: false, edited: true, can_edit: true, can_delete: true } };
    });

    server.delete<{ Params: { projectId: string; messageId: string } }>(
        '/api/v1/projects/:projectId/messages/:messageId', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const projectId = paramId(request, 'projectId');
            const messageId = paramId(request, 'messageId');
            if (!projectId || !messageId) return reply.code(400).send({ error: 'invalid_project_message' });
            const outcome = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'message', 30)) return 'rate_limit' as const;
                const access = await projectMembershipForWrite(client, projectId, session.userId);
                if (!access) return 'not_found' as const;
                const removed = await client.query(
                    `UPDATE impacta.project_messages
                     SET deleted_at = now(), deleted_by_user_id = $3
                     WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL
                       AND (author_user_id = $3 OR $4::boolean)
                     RETURNING id::text AS id, created_at`,
                    [messageId, projectId, session.userId, access.is_owner]
                );
                if (!removed.rowCount) return 'not_found' as const;
                if (access.is_owner) {
                    await client.query(
                        `UPDATE impacta.content_reports
                         SET status = 'resolved', resolved_at = now(), assigned_to_user_id = $2
                         WHERE project_message_id = $1 AND status IN ('open', 'reviewing')`,
                        [messageId, session.userId]
                    );
                    await client.query(
                        `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                         VALUES ($1, 'project.message.moderate', 'project_message', $2, 'Mensagem removida pelo responsável do projecto.')`,
                        [session.userId, messageId]
                    );
                }
                return { ...removed.rows[0], status: 'removed' as const };
            });
            if (outcome === 'rate_limit') return reply.code(429).send({ error: 'project_message_rate_limit' });
            if (outcome === 'not_found') return reply.code(404).send({ error: 'project_message_not_found' });
            return { item: { ...outcome, is_deleted: true, is_author: false, can_edit: false, can_delete: false } };
        }
    );

    server.put<{ Params: { projectId: string } }>(
        '/api/v1/projects/:projectId/read-messages', async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const projectId = paramId(request, 'projectId');
            if (!projectId) return reply.code(400).send({ error: 'invalid_project_id' });
            const access = await projectChatAccess(pool, projectId, session.userId);
            if (!access) return reply.code(404).send({ error: 'project_conversation_not_found' });
            const result = await pool.query<{ last_read_message_id: string }>(
                `INSERT INTO impacta.project_message_reads (project_id, user_id, last_read_message_id)
                 SELECT $1, $2, COALESCE(max(message.id), 0)
                 FROM impacta.project_messages AS message
                 WHERE message.project_id = $1 AND message.deleted_at IS NULL
                 ON CONFLICT (project_id, user_id) DO UPDATE
                 SET last_read_message_id = GREATEST(
                         impacta.project_message_reads.last_read_message_id,
                         EXCLUDED.last_read_message_id
                     ), updated_at = now()
                 RETURNING last_read_message_id::text AS last_read_message_id`,
                [projectId, session.userId]
            );
            return { last_read_message_id: result.rows[0]?.last_read_message_id ?? '0' };
        }
    );

    server.put<{
        Params: { projectId: string };
        Body: { muted?: unknown };
    }>('/api/v1/projects/:projectId/message-preferences', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = paramId(request, 'projectId');
        const muted = request.body?.muted;
        if (!projectId || typeof muted !== 'boolean') return reply.code(400).send({ error: 'invalid_project_message_preferences' });
        const access = await projectChatAccess(pool, projectId, session.userId);
        if (!access) return reply.code(404).send({ error: 'project_conversation_not_found' });
        await pool.query(
            `INSERT INTO impacta.project_message_preferences (project_id, user_id, muted)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id, user_id) DO UPDATE
             SET muted = EXCLUDED.muted, updated_at = now()`,
            [projectId, session.userId, muted]
        );
        return { muted };
    });

    server.post<{
        Params: { projectId: string; messageId: string };
        Body: { reasonCode?: unknown; details?: unknown };
    }>('/api/v1/projects/:projectId/messages/:messageId/reports', async (request, reply) => {
        const session = await requireSession(request, reply, pool, true);
        if (!session) return;
        const projectId = paramId(request, 'projectId');
        const messageId = paramId(request, 'messageId');
        const reasonCode = typeof request.body?.reasonCode === 'string' ? request.body.reasonCode : '';
        const details = typeof request.body?.details === 'string' ? request.body.details.trim() : '';
        const allowedReasons = new Set([
            'adult_sexual_content', 'sexual_exploitation', 'harassment', 'hate',
            'threats_violence', 'spam_scam', 'illegal_activity', 'privacy', 'other'
        ]);
        if (!projectId || !messageId || !allowedReasons.has(reasonCode)
            || Array.from(details).length > 1000 || details.includes('\u0000')) {
            return reply.code(400).send({ error: 'invalid_project_message_report' });
        }
        let outcome: 'rate_limit' | 'not_found' | 'own_message' | 'already_reported' | 'reported';
        try {
            outcome = await transaction(pool, async (client) => {
                if (!await beginLimitedWrite(client, session.userId, 'report', 10)) return 'rate_limit' as const;
                const access = await projectMembershipForWrite(client, projectId, session.userId);
                if (!access) return 'not_found' as const;
                const message = await client.query<{ author_user_id: string }>(
                    `SELECT author_user_id::text AS author_user_id
                     FROM impacta.project_messages
                     WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
                    [messageId, projectId]
                );
                if (!message.rows[0]) return 'not_found' as const;
                if (message.rows[0].author_user_id === session.userId) return 'own_message' as const;
                const existing = await client.query(
                    `SELECT id FROM impacta.content_reports
                     WHERE reporter_user_id = $1 AND project_message_id = $2
                       AND status IN ('open', 'reviewing')`, [session.userId, messageId]
                );
                if (existing.rowCount) return 'already_reported' as const;
                await client.query(
                    `INSERT INTO impacta.content_reports (reporter_user_id, project_message_id, reason_code, details)
                     VALUES ($1, $2, $3, $4)`,
                    [session.userId, messageId, reasonCode, details]
                );
                return 'reported' as const;
            });
        } catch (error) {
            if ((error as { code?: string })?.code === '23505') return reply.code(409).send({ error: 'already_reported' });
            throw error;
        }
        if (outcome === 'rate_limit') return reply.code(429).send({ error: 'project_message_report_rate_limit' });
        if (outcome === 'not_found') return reply.code(404).send({ error: 'project_message_not_found' });
        if (outcome === 'own_message') return reply.code(400).send({ error: 'cannot_report_own_message' });
        if (outcome === 'already_reported') return reply.code(409).send({ error: outcome });
        return reply.code(201).send({ status: outcome });
    });
}

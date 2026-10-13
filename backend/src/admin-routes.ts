import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { createReadStream } from 'node:fs';
import { requireMfaSession, type AuthenticatedSession } from './community-routes.js';
import { postMediaStoragePath } from './media-processing.js';

interface UrgentReportRow {
    post_id: string;
    body: string;
    post_created_at: Date;
    post_status: 'published' | 'hidden';
    author_name: string | null;
    reporter_count: number;
    latest_report_at: Date;
    reports: Array<{
        id: string;
        reporter: string;
        reason_code: string;
        details: string;
        created_at: Date;
    }>;
}

interface CommunityReportTargetRow {
    report_id: string;
    community_id: string;
    community_name: string;
    community_status: string;
    message_id: string | null;
    message_body: string | null;
    message_created_at: Date | null;
    author_name: string | null;
    media_type: string | null;
    media_url: string | null;
    reporter_count: number;
    latest_report_at: Date;
    reports: Array<{
        id: string;
        reporter: string;
        reason_code: string;
        details: string;
        created_at: Date;
    }>;
}

interface SpaceProposalRow {
    resource_type: 'community' | 'project';
    id: string;
    title: string;
    description: string;
    status: string;
    created_at: Date;
    submitted_by: string | null;
    community_name: string | null;
    location_summary: string | null;
}

function validId(value: unknown): value is string {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return false;
    try {
        return BigInt(value) <= 9223372036854775807n;
    } catch {
        return false;
    }
}

function cleanReason(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const reason = value.trim();
    const length = Array.from(reason).length;
    if (!reason || length > 1000 || reason.includes('\u0000')) return undefined;
    return reason;
}

async function hasPermission(pool: Pool, userId: string, permissionCode: string): Promise<boolean> {
    try {
        const result = await pool.query<{ allowed: boolean }>(
            `SELECT EXISTS (
                 SELECT 1
                 FROM impacta.user_roles AS assignment
                 JOIN impacta.roles AS role ON role.id = assignment.role_id
                 JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                 JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                 WHERE assignment.user_id = $1 AND assignment.scope_type = 'platform'
                   AND assignment.scope_id IS NULL AND permission.code = $2
             ) AS allowed`,
            [userId, permissionCode]
        );
        return result.rows[0]?.allowed === true;
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : '';
        if (code === '42501') return false;
        throw error;
    }
}

async function hasResourcePermission(
    pool: Pool,
    userId: string,
    permissionCode: string,
    communityId: string | null
): Promise<boolean> {
    if (await hasPermission(pool, userId, permissionCode)) return true;
    if (!communityId) return false;
    try {
        const result = await pool.query<{ allowed: boolean }>(
            `SELECT EXISTS (
                 SELECT 1
                 FROM impacta.user_roles AS assignment
                 JOIN impacta.roles AS role ON role.id = assignment.role_id
                 JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                 JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                 WHERE assignment.user_id = $1 AND assignment.scope_type = 'community'
                   AND assignment.scope_id = $2 AND permission.code = $3
             ) AS allowed`,
            [userId, communityId, permissionCode]
        );
        return result.rows[0]?.allowed === true;
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        if (code === '42501') return false;
        throw error;
    }
}

async function requirePermission(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    permissionCode: string,
    requireCsrf: boolean
): Promise<AuthenticatedSession | null> {
    const session = await requireMfaSession(request, reply, pool, requireCsrf);
    if (!session) return null;
    if (!await hasPermission(pool, session.userId, permissionCode)) {
        await reply.code(403).send({ error: 'permission_required' });
        return null;
    }
    return session;
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

export function registerAdminRoutes(server: FastifyInstance, pool: Pool): void {
    server.get('/api/v1/admin/access', async (request, reply) => {
        const session = await requireMfaSession(request, reply, pool, false);
        if (!session) return;
        const [canManageReports, canModerate, canManageCommunities, canReviewPlatformProjects, canVerifyAccounts] = await Promise.all([
            hasPermission(pool, session.userId, 'reports.manage'),
            hasPermission(pool, session.userId, 'content.moderate'),
            hasResourcePermission(pool, session.userId, 'communities.manage', null),
            hasResourcePermission(pool, session.userId, 'projects.review', null),
            hasPermission(pool, session.userId, 'accounts.verify')
        ]);
        const scopedProjectAccess = await pool.query<{ allowed: boolean }>(
            `SELECT EXISTS (
                 SELECT 1 FROM impacta.user_roles AS assignment
                 JOIN impacta.roles AS role ON role.id = assignment.role_id
                 JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                 JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                 WHERE assignment.user_id = $1 AND assignment.scope_type = 'community'
                   AND permission.code = 'projects.review'
             ) AS allowed`,
            [session.userId]
        );
        const canReviewProjects = canReviewPlatformProjects || scopedProjectAccess.rows[0]?.allowed === true;
        return { canManageReports, canModerate, canManageCommunities, canReviewProjects, canVerifyAccounts };
    });

    server.get('/api/v1/admin/space-proposals', async (request, reply) => {
        const session = await requireMfaSession(request, reply, pool, false);
        if (!session) return;
        const [canManageCommunities, canReviewPlatformProjects] = await Promise.all([
            hasPermission(pool, session.userId, 'communities.manage'),
            hasPermission(pool, session.userId, 'projects.review')
        ]);
        const scopedProjectAccess = await pool.query<{ allowed: boolean }>(
            `SELECT EXISTS (
                 SELECT 1 FROM impacta.user_roles AS assignment
                 JOIN impacta.roles AS role ON role.id = assignment.role_id
                 JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                 JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                 WHERE assignment.user_id = $1 AND assignment.scope_type = 'community'
                   AND permission.code = 'projects.review'
             ) AS allowed`,
            [session.userId]
        );
        const canReviewProjects = canReviewPlatformProjects || scopedProjectAccess.rows[0]?.allowed === true;
        if (!canManageCommunities && !canReviewProjects) {
            return reply.code(403).send({ error: 'permission_required' });
        }
        const result = await pool.query<SpaceProposalRow>(
            `SELECT proposal.resource_type, proposal.id, proposal.title, proposal.description,
                    proposal.status, proposal.created_at, proposal.submitted_by,
                    proposal.community_name, proposal.location_summary
             FROM (
                 SELECT 'community'::text AS resource_type, community.id::text AS id,
                        community.name AS title, community.description, community.status,
                        community.created_at, owner.display_name AS submitted_by,
                        NULL::text AS community_name, NULL::bigint AS community_id,
                        NULLIF(concat_ws(', ', community.location_neighborhood, community.location_commune,
                            community.location_municipality, community.location_city, community.location_province), '') AS location_summary
                 FROM impacta.communities AS community
                 LEFT JOIN impacta.users AS owner ON owner.id = community.owner_user_id
                 WHERE community.status = 'pending'
                 UNION ALL
                 SELECT 'project'::text, project.id::text, project.title, project.description,
                        project.status, project.created_at, owner.display_name, community.name, project.community_id,
                        NULLIF(concat_ws(', ', project.location_neighborhood, project.location_commune,
                            project.location_municipality, project.location_city, project.location_province), '')
                 FROM impacta.projects AS project
                 LEFT JOIN impacta.users AS owner ON owner.id = project.owner_user_id
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 WHERE project.status = 'review'
             ) AS proposal
             WHERE (proposal.resource_type = 'community' AND $1::boolean)
                OR (proposal.resource_type = 'project' AND (
                    $2::boolean OR EXISTS (
                        SELECT 1 FROM impacta.user_roles AS assignment
                        JOIN impacta.roles AS role ON role.id = assignment.role_id
                        JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                        JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                        WHERE assignment.user_id = $3 AND assignment.scope_type = 'community'
                          AND assignment.scope_id = proposal.community_id AND permission.code = 'projects.review'
                    )
                ))
             ORDER BY proposal.created_at, proposal.id
             LIMIT 100`,
            [canManageCommunities, canReviewPlatformProjects, session.userId]
        );
        return {
            items: result.rows,
            canManageCommunities,
            canReviewProjects
        };
    });

    server.post<{ Params: { resourceType: string; resourceId: string }; Body: { action?: unknown; reason?: unknown; policyChecked?: unknown } }>(
        '/api/v1/admin/space-proposals/:resourceType/:resourceId/review', async (request, reply) => {
            const resourceType = request.params.resourceType;
            const resourceId = request.params.resourceId;
            if ((resourceType !== 'community' && resourceType !== 'project') || !validId(resourceId)) {
                return reply.code(400).send({ error: 'invalid_proposal' });
            }
            const permission = resourceType === 'community' ? 'communities.manage' : 'projects.review';
            const session = await requireMfaSession(request, reply, pool, true);
            if (!session) return;
            let communityId: string | null = null;
            if (resourceType === 'project') {
                const project = await pool.query<{ community_id: string | null }>(
                    `SELECT community_id::text AS community_id FROM impacta.projects
                     WHERE id = $1 AND status = 'review'`,
                    [resourceId]
                );
                communityId = project.rows[0]?.community_id ?? null;
            }
            if (!await hasResourcePermission(pool, session.userId, permission, communityId)) {
                return reply.code(403).send({ error: 'permission_required' });
            }
            const action = request.body?.action;
            const rawReason = request.body?.reason;
            const reason = rawReason === undefined || rawReason === null
                || (typeof rawReason === 'string' && !rawReason.trim())
                ? ''
                : cleanReason(rawReason);
            if (action !== 'approve' && action !== 'reject') {
                return reply.code(400).send({ error: 'invalid_review_action' });
            }
            if (reason === undefined) {
                return reply.code(400).send({ error: 'invalid_review_reason' });
            }
            if (action === 'reject' && !reason) {
                return reply.code(400).send({ error: 'review_reason_required' });
            }
            if (resourceType === 'community' && action === 'approve' && request.body?.policyChecked !== true) {
                return reply.code(400).send({ error: 'community_policy_review_required' });
            }

            const outcome = await transaction(pool, async (client) => {
                const table = resourceType === 'community' ? 'impacta.communities' : 'impacta.projects';
                const pendingStatus = resourceType === 'community' ? 'pending' : 'review';
                const current = await client.query<{ owner_user_id: string | null }>(
                    `SELECT owner_user_id::text AS owner_user_id FROM ${table} WHERE id = $1 AND status = $2 FOR UPDATE`,
                    [resourceId, pendingStatus]
                );
                const proposal = current.rows[0];
                if (!proposal) return 'proposal_not_pending' as const;
                const status = action === 'approve' ? 'active' : 'rejected';
                if (resourceType === 'project') {
                    await client.query(
                        `UPDATE impacta.projects
                         SET status = $2, updated_at = now(), reviewed_at = now(),
                             reviewed_by_user_id = $3, review_reason = NULLIF($4, '')
                         WHERE id = $1`,
                        [resourceId, status, session.userId, reason]
                    );
                } else {
                    await client.query(
                        `UPDATE ${table} SET status = $2, updated_at = now() WHERE id = $1`,
                        [resourceId, status]
                    );
                }
                if (action === 'approve' && proposal.owner_user_id) {
                    if (resourceType === 'community') {
                        await client.query(
                            `INSERT INTO impacta.community_members (community_id, user_id, membership_role, status)
                             VALUES ($1, $2, 'manager', 'active') ON CONFLICT (community_id, user_id) DO NOTHING`,
                            [resourceId, proposal.owner_user_id]
                        );
                    } else {
                        await client.query(
                            `INSERT INTO impacta.project_members (project_id, user_id, membership_role)
                             VALUES ($1, $2, 'owner') ON CONFLICT (project_id, user_id) DO NOTHING`,
                            [resourceId, proposal.owner_user_id]
                        );
                    }
                }
                if (proposal.owner_user_id) {
                    await client.query(
                        `INSERT INTO impacta.notifications (user_id, notification_type, payload)
                         VALUES ($1, 'space_proposal_reviewed', jsonb_build_object(
                             'resourceType', $2::text, 'resourceId', $3::text,
                             'status', $4::text, 'reason', $5::text
                         ))`,
                        [proposal.owner_user_id, resourceType, resourceId, status, reason]
                    );
                }
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
                    [session.userId, `${resourceType}.${action}`, resourceType, resourceId, reason]
                );
                return status;
            });
            if (outcome === 'proposal_not_pending') return reply.code(409).send({ error: outcome });
            return { status: outcome };
        }
    );

    server.get('/api/v1/admin/reports/urgent', async (request, reply) => {
        const session = await requirePermission(request, reply, pool, 'reports.manage', false);
        if (!session) return;
        const canModerate = await hasPermission(pool, session.userId, 'content.moderate');
        const result = await pool.query<UrgentReportRow>(
            `SELECT post.id::text AS post_id,
                    post.body,
                    post.created_at AS post_created_at,
                    post.status AS post_status,
                    author.display_name AS author_name,
                    count(DISTINCT report.reporter_user_id)::int AS reporter_count,
                    max(report.created_at) AS latest_report_at,
                    jsonb_agg(
                        jsonb_build_object(
                            'id', report.id::text,
                            'reporter', COALESCE(reporter.display_name, 'Conta encerrada'),
                            'reason_code', report.reason_code,
                            'details', report.details,
                            'created_at', report.created_at
                        ) ORDER BY report.created_at DESC
                    ) AS reports
             FROM impacta.posts AS post
             JOIN impacta.content_reports AS report ON report.post_id = post.id
             LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
             LEFT JOIN impacta.users AS reporter ON reporter.id = report.reporter_user_id
             WHERE post.status IN ('published', 'hidden') AND post.deleted_at IS NULL
               AND report.status IN ('open', 'reviewing')
             GROUP BY post.id, author.display_name
             HAVING count(DISTINCT report.reporter_user_id) > 5
             ORDER BY reporter_count DESC, latest_report_at DESC
             LIMIT 100`
        );
        return { items: result.rows, canModerate };
    });

    server.get('/api/v1/admin/community-reports', async (request, reply) => {
        const session = await requirePermission(request, reply, pool, 'reports.manage', false);
        if (!session) return;
        const [items, canModerate, canManageCommunities] = await Promise.all([
            pool.query<CommunityReportTargetRow>(
                `SELECT min(report.id)::text AS report_id,
                        community.id::text AS community_id,
                        community.name AS community_name,
                        community.status AS community_status,
                        message.id::text AS message_id,
                        message.body AS message_body,
                        message.created_at AS message_created_at,
                        author.display_name AS author_name,
                        media.media_type,
                        CASE WHEN media.id IS NOT NULL THEN '/api/v1/communities/' || community.id::text || '/media/' || media.id::text END AS media_url,
                        count(DISTINCT report.reporter_user_id)::int AS reporter_count,
                        max(report.created_at) AS latest_report_at,
                        jsonb_agg(jsonb_build_object(
                            'id', report.id::text,
                            'reporter', COALESCE(reporter.display_name, 'Conta encerrada'),
                            'reason_code', report.reason_code,
                            'details', report.details,
                            'created_at', report.created_at
                        ) ORDER BY report.created_at DESC) AS reports
                 FROM impacta.community_reports AS report
                 JOIN impacta.communities AS community ON community.id = report.community_id
                 LEFT JOIN impacta.community_messages AS message ON message.id = report.message_id
                 LEFT JOIN impacta.users AS author ON author.id = message.author_user_id
                 LEFT JOIN impacta.media AS media ON media.id = message.media_id AND media.status = 'available'
                 LEFT JOIN impacta.users AS reporter ON reporter.id = report.reporter_user_id
                 WHERE report.status IN ('open', 'reviewing')
                 GROUP BY community.id, message.id, author.display_name, media.id
                 ORDER BY reporter_count DESC, latest_report_at DESC
                 LIMIT 100`
            ),
            hasPermission(pool, session.userId, 'content.moderate'),
            hasPermission(pool, session.userId, 'communities.manage')
        ]);
        return { items: items.rows, canModerate, canManageCommunities };
    });

    server.get('/api/v1/admin/community-audit', async (request, reply) => {
        const session = await requirePermission(request, reply, pool, 'reports.manage', false);
        if (!session) return;
        const result = await pool.query(
            `SELECT community.id::text AS id,
                    community.name,
                    community.description,
                    community.status,
                    community.visibility,
                    community.created_at,
                    COALESCE(owner.display_name, 'Conta encerrada') AS owner_name,
                    (SELECT count(*)::int FROM impacta.community_members AS member
                     WHERE member.community_id = community.id AND member.status = 'active') AS member_count,
                    (SELECT max(message.created_at) FROM impacta.community_messages AS message
                     WHERE message.community_id = community.id) AS last_message_at,
                    (SELECT count(*)::int FROM impacta.community_reports AS report
                     WHERE report.community_id = community.id AND report.status IN ('open', 'reviewing')) AS open_report_count
                    ,(SELECT count(*)::int FROM impacta.admin_audit_log AS log
                      WHERE (log.target_type = 'community' AND log.target_id = community.id::text)
                         OR (log.target_type = 'community_message' AND EXISTS (
                             SELECT 1 FROM impacta.community_messages AS message
                             WHERE message.community_id = community.id AND message.id::text = log.target_id
                         ))
                         OR (log.target_type = 'community_member' AND log.target_id LIKE community.id::text || ':%')) AS moderation_event_count
                    ,(SELECT max(log.occurred_at) FROM impacta.admin_audit_log AS log
                      WHERE (log.target_type = 'community' AND log.target_id = community.id::text)
                         OR (log.target_type = 'community_message' AND EXISTS (
                             SELECT 1 FROM impacta.community_messages AS message
                             WHERE message.community_id = community.id AND message.id::text = log.target_id
                         ))
                         OR (log.target_type = 'community_member' AND log.target_id LIKE community.id::text || ':%')) AS last_moderation_at
             FROM impacta.communities AS community
             LEFT JOIN impacta.users AS owner ON owner.id = community.owner_user_id
             WHERE community.status IN ('active', 'suspended', 'archived')
             ORDER BY open_report_count DESC, last_message_at DESC NULLS LAST, community.created_at DESC
             LIMIT 100`
        );
        return { items: result.rows };
    });

    server.get<{ Params: { communityId: string } }>(
        '/api/v1/admin/community-audit/:communityId/events', async (request, reply) => {
            const session = await requirePermission(request, reply, pool, 'reports.manage', false);
            if (!session) return;
            const communityId = request.params.communityId;
            if (!validId(communityId)) return reply.code(400).send({ error: 'invalid_community_id' });
            const community = await pool.query('SELECT 1 FROM impacta.communities WHERE id = $1', [communityId]);
            if (!community.rowCount) return reply.code(404).send({ error: 'community_not_found' });
            const events = await pool.query(
                `SELECT log.action_code, log.target_type, log.target_id, log.reason, log.occurred_at,
                        actor.display_name AS actor_name
                 FROM impacta.admin_audit_log AS log
                 LEFT JOIN impacta.users AS actor ON actor.id = log.actor_user_id
                 WHERE (log.target_type = 'community' AND log.target_id = $1::text)
                    OR (log.target_type = 'community_message' AND EXISTS (
                        SELECT 1 FROM impacta.community_messages AS message
                        WHERE message.community_id = $1::bigint AND message.id::text = log.target_id
                    ))
                    OR (log.target_type = 'community_member' AND log.target_id LIKE $1::text || ':%')
                 ORDER BY log.occurred_at DESC, log.id DESC
                 LIMIT 100`,
                [communityId]
            );
            return { items: events.rows };
        }
    );

    server.get('/api/v1/admin/community-content-review', async (request, reply) => {
        if (!await requirePermission(request, reply, pool, 'content.moderate', false)) return;
        const result = await pool.query(
            `SELECT message.id::text AS id,
                    community.id::text AS community_id,
                    community.name AS community_name,
                    message.author_user_id::text AS author_user_id,
                    author.display_name AS author_name,
                    message.body,
                    message.created_at,
                    media.media_type,
                    CASE WHEN media.id IS NOT NULL THEN '/api/v1/communities/' || community.id::text || '/media/' || media.id::text END AS media_url
             FROM impacta.community_messages AS message
             JOIN impacta.communities AS community ON community.id = message.community_id
             JOIN impacta.media AS media ON media.id = message.media_id AND media.status = 'pending_scan'
             LEFT JOIN impacta.users AS author ON author.id = message.author_user_id
             WHERE message.moderation_status = 'pending_review' AND message.deleted_at IS NULL
             ORDER BY message.created_at ASC
             LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Params: { messageId: string }; Body: { action?: unknown; reason?: unknown } }>(
        '/api/v1/admin/community-content-review/:messageId/decision', async (request, reply) => {
            const { messageId } = request.params;
            const action = request.body?.action;
            const reason = cleanReason(request.body?.reason);
            if (!validId(messageId) || !['approve', 'remove'].includes(String(action)) || !reason) {
                return reply.code(400).send({ error: 'invalid_community_content_decision' });
            }
            const session = await requirePermission(request, reply, pool, 'content.moderate', true);
            if (!session) return;
            const result = await transaction(pool, async (client) => {
                const locked = await client.query<{
                    id: string; community_id: string; media_id: string | null; moderation_status: string;
                }>(
                    `SELECT id::text AS id, community_id::text AS community_id,
                            media_id::text AS media_id, moderation_status
                     FROM impacta.community_messages WHERE id = $1 FOR UPDATE`,
                    [messageId]
                );
                const message = locked.rows[0];
                if (!message || !message.media_id) return 'message_not_found' as const;
                if (message.moderation_status !== 'pending_review') return 'content_already_reviewed' as const;
                const media = await client.query(
                    `UPDATE impacta.media SET status = $2
                     WHERE id = $1 AND status = 'pending_scan' RETURNING id`,
                    [message.media_id, action === 'approve' ? 'available' : 'quarantined']
                );
                if (!media.rowCount) return 'media_not_pending' as const;
                await client.query(
                    `UPDATE impacta.community_messages
                     SET moderation_status = $2,
                         deleted_at = CASE WHEN $2 = 'removed' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
                         deleted_by_user_id = CASE WHEN $2 = 'removed' THEN $3 ELSE deleted_by_user_id END
                     WHERE id = $1`,
                    [messageId, action === 'approve' ? 'approved' : 'removed', session.userId]
                );
                await client.query(
                    `UPDATE impacta.community_reports
                     SET status = $2, reviewed_by_user_id = $3, assigned_to_user_id = $3,
                         decision_reason = $4, resolved_at = now()
                     WHERE message_id = $1 AND status IN ('open', 'reviewing')`,
                    [messageId, action === 'approve' ? 'dismissed' : 'resolved', session.userId, reason]
                );
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, 'community_message', $3, $4)`,
                    [session.userId, action === 'approve' ? 'community.media.approve' : 'community.media.remove', messageId, reason]
                );
                return 'decided' as const;
            });
            if (result === 'message_not_found') return reply.code(404).send({ error: result });
            if (result === 'content_already_reviewed') return reply.code(409).send({ error: result });
            if (result === 'media_not_pending') return reply.code(409).send({ error: result });
            return { status: result };
        }
    );

    server.post<{ Params: { reportId: string }; Body: { action?: unknown; reason?: unknown } }>(
        '/api/v1/admin/community-reports/:reportId/decision', async (request, reply) => {
            const { reportId } = request.params;
            const action = request.body?.action;
            const reason = cleanReason(request.body?.reason);
            if (!validId(reportId) || !reason
                || !['dismiss', 'remove_message', 'suspend_community'].includes(String(action))) {
                return reply.code(400).send({ error: 'invalid_community_report_decision' });
            }
            const permission = action === 'dismiss' ? 'reports.manage'
                : action === 'remove_message' ? 'content.moderate' : 'communities.manage';
            const session = await requirePermission(request, reply, pool, permission, true);
            if (!session) return;

            const outcome = await transaction(pool, async (client) => {
                const report = await client.query<{
                    id: string; community_id: string; message_id: string | null; status: string;
                }>(
                    `SELECT id::text AS id, community_id::text AS community_id,
                            message_id::text AS message_id, status
                     FROM impacta.community_reports WHERE id = $1 FOR UPDATE`,
                    [reportId]
                );
                const current = report.rows[0];
                if (!current) return 'report_not_found' as const;
                if (!['open', 'reviewing'].includes(current.status)) return 'report_already_reviewed' as const;
                if (action === 'remove_message' && !current.message_id) return 'invalid_report_action' as const;
                if (action === 'suspend_community' && current.message_id) return 'invalid_report_action' as const;

                let targetType = current.message_id ? 'community_message' : 'community';
                let targetId = current.message_id || current.community_id;
                if (action === 'remove_message') {
                    const removed = await client.query<{ media_id: string | null; moderation_status: string }>(
                        `UPDATE impacta.community_messages
                         SET deleted_at = COALESCE(deleted_at, now()), deleted_by_user_id = $2,
                             moderation_status = CASE WHEN moderation_status = 'pending_review' THEN 'removed'
                                                      ELSE moderation_status END
                         WHERE id = $1 AND community_id = $3
                         RETURNING media_id::text AS media_id, moderation_status`,
                        [current.message_id, session.userId, current.community_id]
                    );
                    if (!removed.rowCount) return 'message_not_found' as const;
                    if (removed.rows[0].media_id) {
                        await client.query(
                            `UPDATE impacta.media SET status = 'quarantined'
                             WHERE id = $1 AND status IN ('available', 'pending_scan')`,
                            [removed.rows[0].media_id]
                        );
                    }
                } else if (action === 'suspend_community') {
                    const suspended = await client.query(
                        `UPDATE impacta.communities SET status = 'suspended', updated_at = now()
                         WHERE id = $1 AND status IN ('active', 'suspended') RETURNING id`,
                        [current.community_id]
                    );
                    if (!suspended.rowCount) return 'community_not_found' as const;
                }

                const nextStatus = action === 'dismiss' ? 'dismissed' : 'resolved';
                await client.query(
                    `UPDATE impacta.community_reports
                     SET status = $2, reviewed_by_user_id = $3, assigned_to_user_id = $3,
                         decision_reason = $4, resolved_at = now()
                     WHERE community_id = $1 AND status IN ('open', 'reviewing')
                       AND message_id IS NOT DISTINCT FROM $5::bigint`,
                    [current.community_id, nextStatus, session.userId, reason, current.message_id]
                );
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [session.userId, `community.report.${action}`, targetType, targetId, reason]
                );
                return 'decided' as const;
            });
            if (outcome === 'report_not_found' || outcome === 'message_not_found' || outcome === 'community_not_found') {
                return reply.code(404).send({ error: outcome });
            }
            if (outcome === 'report_already_reviewed') return reply.code(409).send({ error: outcome });
            if (outcome === 'invalid_report_action') return reply.code(400).send({ error: outcome });
            return { status: outcome };
        }
    );

    server.post<{ Params: { postId: string }; Body: { action?: unknown; reason?: unknown } }>(
        '/api/v1/admin/posts/:postId/moderation', async (request, reply) => {
            const session = await requirePermission(request, reply, pool, 'content.moderate', true);
            if (!session) return;
            const postId = request.params.postId;
            const action = request.body?.action;
            const reason = cleanReason(request.body?.reason);
            if (!validId(postId)) return reply.code(400).send({ error: 'invalid_post_id' });
            if (action !== 'hide' && action !== 'remove') {
                return reply.code(400).send({ error: 'invalid_moderation_action' });
            }
            if (!reason) return reply.code(400).send({ error: 'invalid_moderation_reason' });

            const outcome = await transaction(pool, async (client) => {
                await client.query(
                    "SELECT pg_advisory_xact_lock(hashtextextended('impacta:report-escalation:post:' || $1::text, 0))",
                    [postId]
                );
                const post = await client.query<{ status: string; deleted_at: Date | null }>(
                    'SELECT status, deleted_at FROM impacta.posts WHERE id = $1 FOR UPDATE',
                    [postId]
                );
                const current = post.rows[0];
                if (!current) return 'post_not_found' as const;
                if (!['published', 'hidden'].includes(current.status) || current.deleted_at) {
                    return 'post_unavailable' as const;
                }
                const reports = await client.query<{ reporter_count: number }>(
                    `SELECT count(DISTINCT reporter_user_id)::int AS reporter_count
                     FROM impacta.content_reports
                     WHERE post_id = $1 AND status IN ('open', 'reviewing')`,
                    [postId]
                );
                const reporterCount = reports.rows[0]?.reporter_count ?? 0;
                if (reporterCount <= 5) return 'not_urgent' as const;

                const nextStatus = action === 'hide' ? 'hidden' : 'removed';
                await client.query(
                    `UPDATE impacta.posts
                     SET status = $2,
                         deleted_at = CASE WHEN $2 = 'removed' THEN now() ELSE deleted_at END,
                         updated_at = now()
                     WHERE id = $1`,
                    [postId, nextStatus]
                );
                await client.query(
                    `INSERT INTO impacta.moderation_actions (actor_user_id, post_id, action_type, reason)
                     VALUES ($1, $2, $3, $4)`,
                    [session.userId, postId, action === 'hide' ? 'hide_content' : 'remove_content', reason]
                );
                const resolved = await client.query(
                    `UPDATE impacta.content_reports
                     SET status = 'resolved', resolved_at = now(), assigned_to_user_id = $2
                     WHERE post_id = $1 AND status IN ('open', 'reviewing')`,
                    [postId, session.userId]
                );
                await client.query(
                    `UPDATE impacta.notifications
                     SET read_at = COALESCE(read_at, now())
                     WHERE user_id = $1 AND notification_type = 'urgent_post_report'
                       AND payload->>'postId' = $2`,
                    [session.userId, postId]
                );
                return { action, resolvedReports: resolved.rowCount ?? 0 };
            });

            if (outcome === 'post_not_found') return reply.code(404).send({ error: outcome });
            if (outcome === 'post_unavailable') return reply.code(409).send({ error: outcome });
            if (outcome === 'not_urgent') return reply.code(409).send({ error: 'urgent_report_threshold_not_met' });
            return reply.send({ status: 'moderated', ...outcome });
        }
    );

    server.get('/api/v1/admin/feed-content-review', async (request, reply) => {
        const session = await requirePermission(request, reply, pool, 'content.moderate', false);
        if (!session) return;
        const result = await pool.query(
            `SELECT post.id::text AS post_id, post.body, post.created_at,
                    author.display_name AS author_name,
                    COALESCE(jsonb_agg(jsonb_build_object(
                        'id', media.id::text,
                        'media_type', media.media_type,
                        'mime_type', media.mime_type,
                        'url', '/api/v1/admin/feed-content-review/' || post.id::text || '/media/' || media.id::text
                    ) ORDER BY relation.position) FILTER (WHERE media.id IS NOT NULL), '[]'::jsonb) AS media
             FROM impacta.posts AS post
             LEFT JOIN impacta.post_media AS relation ON relation.post_id = post.id
             LEFT JOIN impacta.media AS media ON media.id = relation.media_id
               AND media.status IN ('available', 'pending_scan')
             LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
             WHERE post.moderation_status = 'pending_review' AND post.status = 'published'
               AND post.deleted_at IS NULL
             GROUP BY post.id, author.display_name
             ORDER BY post.created_at, post.id
             LIMIT 100`
        );
        return { items: result.rows };
    });

    server.get<{ Params: { postId: string; mediaId: string } }>(
        '/api/v1/admin/feed-content-review/:postId/media/:mediaId', async (request, reply) => {
            const session = await requirePermission(request, reply, pool, 'content.moderate', false);
            if (!session) return;
            const { postId, mediaId } = request.params;
            if (!validId(postId) || !validId(mediaId)) return reply.code(404).send({ error: 'media_not_found' });
            const result = await pool.query<{ storage_key: string; mime_type: string }>(
                `SELECT media.storage_key, media.mime_type
                 FROM impacta.posts AS post
                 JOIN impacta.post_media AS relation ON relation.post_id = post.id
                 JOIN impacta.media AS media ON media.id = relation.media_id
                 WHERE post.id = $1 AND media.id = $2
                   AND post.moderation_status = 'pending_review'
                   AND media.status IN ('available', 'pending_scan')`,
                [postId, mediaId]
            );
            const media = result.rows[0];
            const path = media ? postMediaStoragePath(media.storage_key) : null;
            if (!media || !path) return reply.code(404).send({ error: 'media_not_found' });
            try {
                return reply.type(media.mime_type).header('cache-control', 'private, no-store').send(createReadStream(path));
            } catch {
                return reply.code(404).send({ error: 'media_not_found' });
            }
        }
    );

    server.post<{ Params: { postId: string }; Body: { action?: unknown; reason?: unknown } }>(
        '/api/v1/admin/feed-content-review/:postId/decision', async (request, reply) => {
            const session = await requirePermission(request, reply, pool, 'content.moderate', true);
            if (!session) return;
            const { postId } = request.params;
            const action = request.body?.action;
            const reason = cleanReason(request.body?.reason);
            if (!validId(postId) || !['approve', 'remove'].includes(String(action)) || !reason) {
                return reply.code(400).send({ error: 'invalid_feed_content_decision' });
            }
            const outcome = await transaction(pool, async (client) => {
                const post = await client.query<{ id: string; author_user_id: string | null; moderation_status: string }>(
                    `SELECT id::text AS id, author_user_id::text AS author_user_id, moderation_status
                     FROM impacta.posts WHERE id = $1 FOR UPDATE`, [postId]
                );
                const current = post.rows[0];
                if (!current) return 'post_not_found' as const;
                if (current.moderation_status !== 'pending_review') return 'content_already_reviewed' as const;
                await client.query<{ id: string }>(
                    `UPDATE impacta.media AS media
                     SET status = $2
                     FROM impacta.post_media AS relation
                     WHERE relation.post_id = $1 AND relation.media_id = media.id
                       AND media.status IN ('available', 'pending_scan')
                     RETURNING media.id`,
                    [postId, action === 'approve' ? 'available' : 'quarantined']
                );
                await client.query(
                    `UPDATE impacta.posts
                     SET moderation_status = $2,
                         status = CASE WHEN $2 = 'removed' THEN 'removed' ELSE status END,
                         deleted_at = CASE WHEN $2 = 'removed' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
                         updated_at = now()
                     WHERE id = $1`,
                    [postId, action === 'approve' ? 'approved' : 'removed']
                );
                await client.query(
                    `INSERT INTO impacta.moderation_actions (actor_user_id, post_id, action_type, reason)
                     VALUES ($1, $2, $3, $4)`,
                    [session.userId, postId, action === 'approve' ? 'restore_content' : 'remove_content', reason]
                );
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, 'post', $3, $4)`,
                    [session.userId, action === 'approve' ? 'feed.post.approve' : 'feed.post.remove', postId, reason]
                );
                return 'decided' as const;
            });
            if (outcome === 'post_not_found') return reply.code(404).send({ error: outcome });
            if (outcome === 'content_already_reviewed') return reply.code(409).send({ error: outcome });
            return { status: outcome, action };
        }
    );

    server.get('/api/v1/admin/content-reports', async (request, reply) => {
        const session = await requirePermission(request, reply, pool, 'reports.manage', false);
        if (!session) return;
        const [result, canModerate] = await Promise.all([
            pool.query(
                `SELECT * FROM (
                    SELECT 'post'::text AS target_type, post.id::text AS target_id,
                           post.body AS content, author.display_name AS author_name,
                           count(DISTINCT report.reporter_user_id)::int AS reporter_count,
                           max(report.created_at) AS latest_report_at,
                           jsonb_agg(jsonb_build_object('id', report.id::text,
                               'reporter', COALESCE(reporter.display_name, 'Conta encerrada'),
                               'reason_code', report.reason_code, 'details', report.details,
                               'created_at', report.created_at) ORDER BY report.created_at DESC) AS reports
                    FROM impacta.content_reports AS report
                    JOIN impacta.posts AS post ON post.id = report.post_id
                    LEFT JOIN impacta.users AS author ON author.id = post.author_user_id
                    LEFT JOIN impacta.users AS reporter ON reporter.id = report.reporter_user_id
                    WHERE report.status IN ('open', 'reviewing') AND post.deleted_at IS NULL
                    GROUP BY post.id, author.display_name
                    HAVING count(DISTINCT report.reporter_user_id) <= 5
                    UNION ALL
                    SELECT 'comment'::text AS target_type, comment.id::text AS target_id,
                           comment.body AS content, author.display_name AS author_name,
                           count(DISTINCT report.reporter_user_id)::int AS reporter_count,
                           max(report.created_at) AS latest_report_at,
                           jsonb_agg(jsonb_build_object('id', report.id::text,
                               'reporter', COALESCE(reporter.display_name, 'Conta encerrada'),
                               'reason_code', report.reason_code, 'details', report.details,
                               'created_at', report.created_at) ORDER BY report.created_at DESC) AS reports
                    FROM impacta.content_reports AS report
                    JOIN impacta.comments AS comment ON comment.id = report.comment_id
                    LEFT JOIN impacta.users AS author ON author.id = comment.author_user_id
                    LEFT JOIN impacta.users AS reporter ON reporter.id = report.reporter_user_id
                    WHERE report.status IN ('open', 'reviewing') AND comment.deleted_at IS NULL
                    GROUP BY comment.id, author.display_name
                    UNION ALL
                    SELECT 'project_message'::text AS target_type, message.id::text AS target_id,
                           message.body AS content, author.display_name AS author_name,
                           count(DISTINCT report.reporter_user_id)::int AS reporter_count,
                           max(report.created_at) AS latest_report_at,
                           jsonb_agg(jsonb_build_object('id', report.id::text,
                               'reporter', COALESCE(reporter.display_name, 'Conta encerrada'),
                               'reason_code', report.reason_code, 'details', report.details,
                               'created_at', report.created_at) ORDER BY report.created_at DESC) AS reports
                    FROM impacta.content_reports AS report
                    JOIN impacta.project_messages AS message ON message.id = report.project_message_id
                    LEFT JOIN impacta.users AS author ON author.id = message.author_user_id
                    LEFT JOIN impacta.users AS reporter ON reporter.id = report.reporter_user_id
                    WHERE report.status IN ('open', 'reviewing') AND message.deleted_at IS NULL
                    GROUP BY message.id, author.display_name
                ) AS queued
                ORDER BY latest_report_at DESC LIMIT 100`
            ),
            hasPermission(pool, session.userId, 'content.moderate')
        ]);
        return { items: result.rows, canModerate };
    });

    server.post<{ Params: { targetType: string; targetId: string }; Body: { action?: unknown; reason?: unknown } }>(
        '/api/v1/admin/content-reports/:targetType/:targetId/decision', async (request, reply) => {
            const session = await requirePermission(request, reply, pool, 'content.moderate', true);
            if (!session) return;
            const { targetType, targetId } = request.params;
            const action = request.body?.action;
            const reason = cleanReason(request.body?.reason);
            if (!['post', 'comment', 'project_message'].includes(targetType) || !validId(targetId)
                || !['dismiss', 'hide', 'remove'].includes(String(action)) || !reason) {
                return reply.code(400).send({ error: 'invalid_content_report_decision' });
            }
            const outcome = await transaction(pool, async (client) => {
                const table = targetType === 'project_message' ? 'project_messages'
                    : targetType === 'post' ? 'posts' : 'comments';
                const targetColumn = targetType === 'project_message' ? 'project_message_id'
                    : targetType === 'post' ? 'post_id' : 'comment_id';
                const locked = targetType === 'project_message'
                    ? await client.query<{ id: string; status: string }>(
                        `SELECT id::text AS id, 'active'::text AS status FROM impacta.project_messages
                         WHERE id = $1 FOR UPDATE`, [targetId]
                    )
                    : await client.query<{ id: string; status: string }>(
                        `SELECT id::text AS id, status FROM impacta.${table} WHERE id = $1 FOR UPDATE`, [targetId]
                    );
                if (!locked.rows[0]) return 'content_not_found' as const;
                if (action !== 'dismiss') {
                    const nextStatus = action === 'hide' ? 'hidden' : 'removed';
                    if (targetType === 'project_message') {
                        await client.query(
                            `UPDATE impacta.project_messages
                             SET deleted_at = COALESCE(deleted_at, now()), deleted_by_user_id = $2
                             WHERE id = $1`, [targetId, session.userId]
                        );
                    } else {
                        await client.query(
                            `UPDATE impacta.${table}
                             SET status = $2,
                                 deleted_at = CASE WHEN $2 = 'removed' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
                                 updated_at = now()
                             WHERE id = $1`, [targetId, nextStatus]
                        );
                        await client.query(
                            `INSERT INTO impacta.moderation_actions (actor_user_id, ${targetColumn}, action_type, reason)
                             VALUES ($1, $2, $3, $4)`,
                            [session.userId, targetId, action === 'hide' ? 'hide_content' : 'remove_content', reason]
                        );
                    }
                }
                const resolved = await client.query(
                    `UPDATE impacta.content_reports SET status = $3, resolved_at = now(), assigned_to_user_id = $2
                     WHERE ${targetColumn} = $1 AND status IN ('open', 'reviewing')`,
                    [targetId, session.userId, action === 'dismiss' ? 'dismissed' : 'resolved']
                );
                await client.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [session.userId, `content.${action}`, targetType, targetId, reason]
                );
                return { resolvedReports: resolved.rowCount ?? 0 };
            });
            if (outcome === 'content_not_found') return reply.code(404).send({ error: outcome });
            return { status: 'decided', ...outcome };
        }
    );
}

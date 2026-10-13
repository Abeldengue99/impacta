import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { requireMfaSession, type AuthenticatedSession } from './community-routes.js';
import { buildExcelReport, buildWordReport, type AnnouncementReport } from './announcement-reports.js';
import {
    MAX_POST_IMAGE_BYTES,
    MEDIA_DIRECTORY,
    MediaProcessingError,
    PROMOTION_MEDIA_DIRECTORY,
    optimizePostImage,
    promotionMediaStoragePath
} from './media-processing.js';

function validId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
        && BigInt(value) <= 9223372036854775807n;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const clean = value.trim();
    if (!clean || Array.from(clean).length > maxLength || clean.includes('\u0000')) return undefined;
    return clean;
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return undefined;
    const clean = value.trim();
    if (Array.from(clean).length > maxLength || clean.includes('\u0000')) return undefined;
    return clean;
}

function isAdminActionsMigrationRequired(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const databaseError = error as { code?: unknown };
    return databaseError.code === '42501' || databaseError.code === '42703';
}
function isPromotionOptionalCopyConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const databaseError = error as { code?: unknown; constraint?: unknown };
    return databaseError.code === '23514'
        && ['announcements_title_check', 'announcements_body_check'].includes(String(databaseError.constraint ?? ''));
}

function parseHttpUrl(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 2000 || value.includes('\u0000')) return undefined;
    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function escapeHeaderFilename(value: string): string {
    return value.replace(/[^a-z0-9._-]/gi, '-').slice(0, 120) || 'relatorio-impacta';
}

async function validatePromotionImage(
    client: PoolClient,
    imageId: string | null,
    ownerId: string
): Promise<boolean> {
    if (!imageId) return true;
    const result = await client.query(
        `SELECT 1 FROM impacta.media
         WHERE id = $1 AND owner_user_id = $2 AND status = 'available'
           AND media_type = 'image' AND storage_key LIKE 'promotions/%'
         FOR UPDATE`,
        [imageId, ownerId]
    );
    return result.rowCount === 1;
}

function profileDocumentStoragePath(storageKey: string): string | null {
    if (!/^profile-documents\/[a-f0-9-]{36}\.pdf$/i.test(storageKey)) return null;
    const root = resolve(MEDIA_DIRECTORY);
    const path = resolve(root, storageKey);
    return path.startsWith(root + sep) ? path : null;
}
function profileMediaStoragePath(storageKey: string): string | null {
    if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/i.test(storageKey)) return null;
    const root = resolve(MEDIA_DIRECTORY);
    const path = resolve(root, storageKey);
    return path.startsWith(root + sep) ? path : null;
}
function readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator >= 0 && part.slice(0, separator).trim() === name) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }
    return undefined;
}

async function adminSession(
    request: FastifyRequest,
    reply: FastifyReply,
    pool: Pool,
    permissionCode: string,
    write = false
): Promise<AuthenticatedSession | null> {
    const session = await requireMfaSession(request, reply, pool, write);
    if (!session) return null;
    const result = await pool.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1 FROM impacta.user_roles AS assignment
             JOIN impacta.roles AS role ON role.id = assignment.role_id
             JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
             JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
             WHERE assignment.user_id = $1 AND assignment.scope_type = 'platform'
               AND assignment.scope_id IS NULL AND permission.code = $2
         ) AS allowed`,
        [session.userId, permissionCode]
    );
    if (result.rows[0]?.allowed !== true) {
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

async function audit(
    client: PoolClient,
    actorId: string,
    actionCode: string,
    targetType: string,
    targetId: string | null,
    reason: string
): Promise<void> {
    await client.query(
        `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
        [actorId, actionCode, targetType, targetId, reason]
    );
}

interface DatabaseBackupFile {
    directory: string;
    filePath: string;
    filename: string;
}

async function createDatabaseBackup(): Promise<DatabaseBackupFile> {
    const directory = await mkdtemp(join(tmpdir(), 'impacta-db-backup-'));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `impacta-backup-${timestamp}.dump`;
    const filePath = join(directory, filename);
    const windowsDefault = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
    const executable = process.env.PG_DUMP_PATH?.trim()
        || (process.platform === 'win32' && existsSync(windowsDefault) ? windowsDefault : 'pg_dump');
    const childEnvironment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        PGPASSWORD: process.env.PGPASSWORD,
        PGPASSFILE: process.env.PGPASSFILE,
        PGSSLMODE: process.env.PGSSL === 'true' ? 'verify-full' : 'disable',
        PGSSLROOTCERT: process.env.PGSSL_CA ?? process.env.PGSSLROOTCERT,
        PGSSLCERT: process.env.PGSSLCERT,
        PGSSLKEY: process.env.PGSSLKEY
    };
    const child = spawn(executable, [
        '--format=custom', '--no-owner', '--no-acl', '--no-password',
        '--host', process.env.PGHOST ?? '',
        '--port', process.env.PGPORT ?? '5432',
        '--username', process.env.PGUSER ?? '',
        '--dbname', process.env.PGDATABASE ?? ''
    ], { env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stderr?.resume();
    const exited = new Promise<number>((resolveExit, rejectExit) => {
        child.once('error', rejectExit);
        child.once('close', (code) => resolveExit(code ?? 1));
    });
    try {
        await Promise.all([
            pipeline(child.stdout!, createWriteStream(filePath, { flags: 'wx' })),
            exited.then((code) => {
                if (code !== 0) throw new Error('database_backup_failed');
            })
        ]);
        return { directory, filePath, filename };
    } catch (error) {
        child.kill();
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}
export function registerAdminConsoleRoutes(server: FastifyInstance, pool: Pool): void {
    const promotionRateBuckets = new Map<string, { startedAt: number; count: number }>();

    server.get('/api/v1/admin/overview', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'admin.dashboard.read')) return;
        const [counts, activity, trend, statusSummary] = await Promise.all([
            pool.query(
                `SELECT
                    (SELECT count(id) FROM impacta.privacy_requests WHERE status IN ('received','reviewing','waiting_user'))::int AS open_privacy_requests,
                    (SELECT count(id) FROM impacta.account_verification_requests WHERE status = 'pending')::int AS pending_verifications`
            ),
            pool.query(
                `SELECT log.id::text AS id, log.action_code, log.target_type, log.target_id,
                        log.reason, log.occurred_at, actor.display_name AS actor_name
                 FROM impacta.admin_audit_log AS log
                 LEFT JOIN impacta.users AS actor ON actor.id = log.actor_user_id
                 ORDER BY log.occurred_at DESC, log.id DESC LIMIT 8`
            ),
            pool.query(
                `WITH calendar AS (
                     SELECT generate_series(current_date - 6, current_date, interval '1 day')::date AS day
                 ), registrations AS (
                     SELECT created_at::date AS day, count(*)::int AS value
                     FROM impacta.users
                     WHERE created_at >= current_date - 6 AND created_at < current_date + 1
                     GROUP BY created_at::date
                 ), publications AS (
                     SELECT created_at::date AS day, count(*)::int AS value
                     FROM impacta.posts
                     WHERE status = 'published' AND deleted_at IS NULL
                       AND created_at >= current_date - 6 AND created_at < current_date + 1
                     GROUP BY created_at::date
                 ), admin_actions AS (
                     SELECT occurred_at::date AS day, count(*)::int AS value
                     FROM impacta.admin_audit_log
                     WHERE occurred_at >= current_date - 6 AND occurred_at < current_date + 1
                     GROUP BY occurred_at::date
                 )
                 SELECT to_char(calendar.day, 'YYYY-MM-DD') AS day,
                        COALESCE(registrations.value, 0)::int AS registrations,
                        COALESCE(publications.value, 0)::int AS publications,
                        COALESCE(admin_actions.value, 0)::int AS admin_actions
                 FROM calendar
                 LEFT JOIN registrations USING (day)
                 LEFT JOIN publications USING (day)
                 LEFT JOIN admin_actions USING (day)
                 ORDER BY calendar.day`
            ),
            pool.query(
                `SELECT 'users'::text AS entity, status, count(*)::int AS value
                 FROM impacta.users GROUP BY status
                 UNION ALL
                 SELECT 'communities'::text AS entity, status, count(*)::int AS value
                 FROM impacta.communities GROUP BY status
                 UNION ALL
                 SELECT 'projects'::text AS entity, status, count(*)::int AS value
                 FROM impacta.projects GROUP BY status
                 UNION ALL
                 SELECT 'posts'::text AS entity,
                        CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE status END AS status,
                        count(*)::int AS value
                 FROM impacta.posts
                 GROUP BY CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE status END
                 ORDER BY entity, status`
            )
        ]);
        const byState = new Map(statusSummary.rows.map((item) => [`${item.entity}:${item.status}`, Number(item.value) || 0]));
        const stateCount = (entity: string, status: string): number => byState.get(`${entity}:${status}`) ?? 0;
        return {
            ...counts.rows[0],
            active_users: stateCount('users', 'active'),
            active_projects: stateCount('projects', 'active'),
            pending_projects: stateCount('projects', 'review'),
            completed_projects: stateCount('projects', 'completed'),
            active_communities: stateCount('communities', 'active'),
            pending_communities: stateCount('communities', 'pending'),
            published_posts: stateCount('posts', 'published'),
            activity: activity.rows,
            trend: trend.rows,
            statusSummary: statusSummary.rows
        };
    });

    server.get<{ Querystring: { search?: string; from?: string; to?: string; offset?: string } }>('/api/v1/admin/users', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'users.read');
        if (!session) return;
        const search = (request.query.search ?? '').trim().slice(0, 100);
        const from = (request.query.from ?? '').trim();
        const to = (request.query.to ?? '').trim();
        const rawOffset = request.query.offset ?? '0';
        const offset = /^\d{1,7}$/.test(rawOffset) ? Number(rawOffset) : -1;
        if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
            return reply.code(400).send({ error: 'invalid_user_date_range' });
        }
        const [result, totals] = await Promise.all([
            pool.query(
                `SELECT account.id::text AS id, account.display_name, account.email, account.status,
                        account.created_at, account.mfa_required,
                        account.id = $4::bigint AS is_current_user,
                        EXISTS (SELECT 1 FROM impacta.user_roles AS protected_assignment
                                JOIN impacta.roles AS protected_role ON protected_role.id = protected_assignment.role_id
                                WHERE protected_assignment.user_id = account.id
                                  AND protected_assignment.scope_type = 'platform'
                                  AND protected_assignment.scope_id IS NULL
                                  AND protected_role.code IN ('platform_admin', 'super_admin')) AS protected_admin,
                        EXISTS (SELECT 1 FROM impacta.user_roles AS actor_assignment
                                JOIN impacta.role_permissions AS actor_permission
                                  ON actor_permission.role_id = actor_assignment.role_id
                                JOIN impacta.permissions AS permission ON permission.id = actor_permission.permission_id
                                WHERE actor_assignment.user_id = $4
                                  AND actor_assignment.scope_type = 'platform'
                                  AND actor_assignment.scope_id IS NULL
                                  AND permission.code = 'users.suspend') AS can_manage,
                        (EXISTS (SELECT 1 FROM impacta.communities AS community
                                 WHERE community.owner_user_id = account.id AND community.status = 'active')
                         OR EXISTS (SELECT 1 FROM impacta.projects AS project
                                    WHERE project.owner_user_id = account.id AND project.status IN ('review','active'))) AS has_active_responsibilities,
                        COALESCE(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), ARRAY[]::text[]) AS roles
                 FROM impacta.users AS account
                 LEFT JOIN impacta.user_roles AS assignment
                   ON assignment.user_id = account.id AND assignment.scope_type = 'platform'
                 LEFT JOIN impacta.roles AS role ON role.id = assignment.role_id
                 WHERE ($1 = '' OR account.display_name ILIKE '%' || $1 || '%'
                        OR COALESCE(account.email, '') ILIKE '%' || $1 || '%')
                   AND ($2::date IS NULL OR account.created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Luanda'))
                   AND ($3::date IS NULL OR account.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda'))
                 GROUP BY account.id
                 ORDER BY account.created_at DESC, account.id DESC LIMIT 100 OFFSET $5`,
                [search, from || null, to || null, session.userId, offset]
            ),
            pool.query(
                `WITH matching AS (
                     SELECT account.created_at
                     FROM impacta.users AS account
                     WHERE ($1 = '' OR account.display_name ILIKE '%' || $1 || '%'
                            OR COALESCE(account.email, '') ILIKE '%' || $1 || '%')
                 ), local_day AS (
                     SELECT (now() AT TIME ZONE 'Africa/Luanda')::date AS day
                 )
                 SELECT COUNT(*)::int AS all_time,
                        (COUNT(*) FILTER (WHERE matching.created_at >= (local_day.day::timestamp AT TIME ZONE 'Africa/Luanda')
                                          AND matching.created_at < ((local_day.day + 1)::timestamp AT TIME ZONE 'Africa/Luanda')))::int AS today,
                        (COUNT(*) FILTER (WHERE matching.created_at >= (date_trunc('month', local_day.day::timestamp) AT TIME ZONE 'Africa/Luanda')
                                          AND matching.created_at < ((date_trunc('month', local_day.day::timestamp) + interval '1 month') AT TIME ZONE 'Africa/Luanda')))::int AS this_month,
                        (COUNT(*) FILTER (WHERE matching.created_at >= (date_trunc('year', local_day.day::timestamp) AT TIME ZONE 'Africa/Luanda')
                                          AND matching.created_at < ((date_trunc('year', local_day.day::timestamp) + interval '1 year') AT TIME ZONE 'Africa/Luanda')))::int AS this_year,
                        (COUNT(*) FILTER (WHERE ($2::date IS NULL OR matching.created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Luanda'))
                                          AND ($3::date IS NULL OR matching.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Africa/Luanda'))))::int AS period_total
                 FROM matching CROSS JOIN local_day`,
                [search, from || null, to || null]
            )
        ]);
        return { items: result.rows, total: totals.rows[0]?.period_total ?? 0, metrics: totals.rows[0] };
    });
    server.get('/api/v1/admin/account-verifications', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'accounts.verify')) return;
        const result = await pool.query(
            `SELECT verification.id::text AS id, verification.user_id::text AS user_id,
                    verification.category, verification.evidence_url, verification.request_note,
                    verification.created_at, verification.status, verification.review_reason,
                    CASE WHEN verification.proof_expires_at > now() THEN verification.proof_code ELSE NULL END AS proof_code,
                    verification.proof_expires_at, verification.proof_confirmed_at,
                    account.display_name, profile.organization, profile.website_url
             FROM impacta.account_verification_requests AS verification
             JOIN impacta.users AS account ON account.id = verification.user_id AND account.status = 'active'
             LEFT JOIN impacta.user_profiles AS profile ON profile.user_id = account.id
             WHERE verification.status IN ('pending', 'approved')
             ORDER BY CASE WHEN verification.status = 'pending' THEN 0 ELSE 1 END,
                      verification.created_at ASC, verification.id ASC
             LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Params: { requestId: string }; Body: { decision?: unknown; reason?: unknown; proofConfirmed?: unknown } }>(
        '/api/v1/admin/account-verifications/:requestId/review', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'accounts.verify', true);
            if (!session) return;
            const { requestId } = request.params;
            const decision = request.body?.decision;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(requestId) || !['approve', 'reject', 'revoke'].includes(String(decision)) || !reason || reason.length < 5) {
                return reply.code(400).send({ error: 'invalid_verification_decision' });
            }
            if (decision === 'approve' && request.body?.proofConfirmed !== true) {
                return reply.code(400).send({ error: 'verification_proof_confirmation_required' });
            }
            const outcome = await transaction(pool, async (client) => {
                const locked = await client.query<{ user_id: string; status: string; proof_code: string | null; proof_active: boolean }>(
                    `SELECT user_id::text AS user_id, status, proof_code,
                            (proof_code IS NOT NULL AND proof_expires_at > now()) AS proof_active
                     FROM impacta.account_verification_requests
                     WHERE id = $1 AND status IN ('pending', 'approved') FOR UPDATE`,
                    [requestId]
                );
                const item = locked.rows[0];
                if (!item) return 'already_reviewed' as const;
                if ((decision === 'revoke' && item.status !== 'approved')
                    || (decision !== 'revoke' && item.status !== 'pending')) return 'already_reviewed' as const;
                if (decision === 'approve' && item.proof_active !== true) return 'proof_missing' as const;
                const status = decision === 'approve' ? 'approved' : decision === 'revoke' ? 'revoked' : 'rejected';

                if (decision === 'approve') {
                    const legacy = await client.query<{ id: string }>(
                        `UPDATE impacta.account_verification_requests
                         SET status = 'revoked', reviewed_by_user_id = $2,
                             review_reason = 'Substituída por uma nova confirmação do canal oficial.', reviewed_at = now()
                         WHERE user_id = $1 AND status = 'approved' AND proof_confirmed_at IS NULL
                         RETURNING id::text AS id`,
                        [item.user_id, session.userId]
                    );
                    for (const old of legacy.rows) {
                        await audit(client, session.userId, 'account_verification_revoked',
                            'account_verification_request', old.id,
                            'Substituída por uma nova confirmação do canal oficial.');
                    }
                }
                await client.query(
                    `UPDATE impacta.account_verification_requests
                     SET status = $2, reviewed_by_user_id = $3, review_reason = $4, reviewed_at = now(),
                         proof_confirmed_by_user_id = CASE WHEN $2 = 'approved' THEN $3 ELSE proof_confirmed_by_user_id END,
                         proof_confirmed_at = CASE WHEN $2 = 'approved' THEN now() ELSE proof_confirmed_at END,
                         proof_code = NULL, proof_expires_at = NULL
                     WHERE id = $1 AND status = $5`,
                    [requestId, status, session.userId, reason, item.status]
                );
                await audit(client, session.userId,
                    decision === 'approve' ? 'account_verification_approved'
                        : decision === 'revoke' ? 'account_verification_revoked' : 'account_verification_rejected',
                    'account_verification_request', requestId, reason);
                return 'reviewed' as const;
            });
            if (outcome === 'proof_missing') return reply.code(409).send({ error: 'verification_proof_not_active' });
            if (outcome !== 'reviewed') return reply.code(409).send({ error: 'verification_request_already_reviewed' });
            return { status: decision === 'approve' ? 'approved' : decision === 'revoke' ? 'revoked' : 'rejected' };
        }
    );

    server.post<{ Params: { userId: string }; Body: { status?: string; reason?: string } }>(
        '/api/v1/admin/users/:userId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'users.suspend', true);
            if (!session) return;
            const { userId } = request.params;
            const status = request.body?.status;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(userId) || (status !== 'active' && status !== 'suspended') || !reason) {
                return reply.code(400).send({ error: 'invalid_user_status_change' });
            }
            if (userId === session.userId) return reply.code(400).send({ error: 'cannot_change_own_status' });
            const result = await transaction(pool, async (client) => {
                const target = await client.query<{ status: string; protected_admin: boolean }>(
                    `SELECT account.status,
                            EXISTS (SELECT 1 FROM impacta.user_roles AS assignment
                                    JOIN impacta.roles AS role ON role.id = assignment.role_id
                                    WHERE assignment.user_id = account.id AND assignment.scope_type = 'platform'
                                      AND assignment.scope_id IS NULL AND role.code IN ('platform_admin','super_admin')) AS protected_admin
                     FROM impacta.users AS account WHERE account.id = $1 FOR UPDATE`, [userId]
                );
                if (!target.rows[0] || !['active', 'suspended'].includes(target.rows[0].status)) return 'user_unavailable' as const;
                if (target.rows[0].protected_admin) return 'protected_admin' as const;
                if (target.rows[0].status === status) return 'unchanged' as const;
                await client.query('UPDATE impacta.users SET status = $2, updated_at = now() WHERE id = $1', [userId, status]);
                if (status === 'suspended') {
                    await client.query(
                        'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                        [userId]
                    );
                }
                await client.query(
                    `INSERT INTO impacta.moderation_actions (actor_user_id, target_user_id, action_type, reason)
                     VALUES ($1, $2, $3, $4)`,
                    [session.userId, userId, status === 'suspended' ? 'suspend_user' : 'restore_user', reason]
                );
                await audit(client, session.userId, `user.${status}`, 'user', userId, reason);
                return status;
            });
            if (result === 'user_unavailable') return reply.code(404).send({ error: result });
            if (result === 'protected_admin') return reply.code(403).send({ error: result });
            return { status: result };
        }
    );

    server.post<{ Params: { userId: string }; Body: { reason?: unknown } }>(
        '/api/v1/admin/users/:userId/close', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'users.suspend', true);
            if (!session) return;
            const { userId } = request.params;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(userId) || !reason || reason.length < 5) {
                return reply.code(400).send({ error: 'invalid_user_close_request' });
            }
            if (userId === session.userId) return reply.code(400).send({ error: 'cannot_close_own_account' });

            const outcome = await transaction(pool, async (client) => {
                const locked = await client.query<{
                    status: string;
                    protected_admin: boolean;
                    has_active_responsibilities: boolean;
                }>(
                    `SELECT account.status,
                            EXISTS (SELECT 1 FROM impacta.user_roles AS assignment
                                    JOIN impacta.roles AS role ON role.id = assignment.role_id
                                    WHERE assignment.user_id = account.id AND assignment.scope_type = 'platform'
                                      AND assignment.scope_id IS NULL AND role.code IN ('platform_admin','super_admin')) AS protected_admin,
                            (EXISTS (SELECT 1 FROM impacta.communities AS community
                                     WHERE community.owner_user_id = account.id AND community.status = 'active')
                             OR EXISTS (SELECT 1 FROM impacta.projects AS project
                                        WHERE project.owner_user_id = account.id AND project.status IN ('review','active'))) AS has_active_responsibilities
                     FROM impacta.users AS account WHERE account.id = $1 FOR UPDATE`,
                    [userId]
                );
                const target = locked.rows[0];
                if (!target || !['pending', 'active', 'suspended'].includes(target.status)) {
                    return { kind: 'user_unavailable' as const };
                }
                if (target.protected_admin) return { kind: 'protected_admin' as const };
                if (target.has_active_responsibilities) return { kind: 'user_has_active_responsibilities' as const };

                const documents = await client.query<{ storage_key: string }>(
                    `DELETE FROM impacta.profile_documents WHERE user_id = $1 RETURNING storage_key`,
                    [userId]
                );
                                const profile = await client.query<{ avatar_media_id: string | null; cover_media_id: string | null }>(
                    'DELETE FROM impacta.user_profiles WHERE user_id = $1 RETURNING avatar_media_id::text AS avatar_media_id, cover_media_id::text AS cover_media_id',
                    [userId]
                );
                const profileMediaIds = [...new Set(profile.rows.flatMap((row) =>
                    [row.avatar_media_id, row.cover_media_id].filter((value): value is string => Boolean(value))
                ))];
                const removedProfileMedia = profileMediaIds.length
                    ? await client.query<{ storage_key: string }>(
                        `UPDATE impacta.media SET status = 'deleted'
                         WHERE id = ANY($1::bigint[]) AND owner_user_id = $2 AND status <> 'deleted'
                           AND storage_key ~* '^[a-f0-9-]{36}[.](png|jpg|webp)$'
                         RETURNING storage_key`,
                        [profileMediaIds, userId]
                    )
                    : { rows: [] as { storage_key: string }[] };
                await client.query('DELETE FROM impacta.mfa_challenges WHERE user_id = $1', [userId]);
                await client.query('DELETE FROM impacta.mfa_recovery_codes WHERE user_id = $1', [userId]);
                await client.query('DELETE FROM impacta.mfa_credentials WHERE user_id = $1', [userId]);
                await client.query(
                    `UPDATE impacta.auth_sessions SET revoked_at = now()
                     WHERE user_id = $1 AND revoked_at IS NULL`,
                    [userId]
                );
                await client.query('DELETE FROM impacta.user_roles WHERE user_id = $1', [userId]);
                await client.query(
                    `UPDATE impacta.users
                     SET status = 'closed', email = NULL, password_hash = NULL,
                         display_name = 'Conta encerrada', closed_at = now(), updated_at = now()
                     WHERE id = $1`,
                    [userId]
                );
                await audit(client, session.userId, 'user.close', 'user', userId, reason);
                return {
                    kind: 'closed' as const,
                    documentKeys: documents.rows.map((document) => document.storage_key),
                    profileMediaKeys: removedProfileMedia.rows.map((media) => media.storage_key)
                };
            }).catch((error: unknown) => {
                if (isAdminActionsMigrationRequired(error)) return { kind: 'migration_required' as const };
                throw error;
            });

            if (outcome.kind === 'migration_required') return reply.code(503).send({ error: 'admin_actions_migration_required' });
            if (outcome.kind === 'user_unavailable') return reply.code(404).send({ error: outcome.kind });
            if (outcome.kind === 'protected_admin') return reply.code(403).send({ error: outcome.kind });
            if (outcome.kind === 'user_has_active_responsibilities') return reply.code(409).send({ error: outcome.kind });
            for (const storageKey of outcome.documentKeys) {
                const path = profileDocumentStoragePath(storageKey);
                if (path) await unlink(path).catch(() => {
                    request.log.warn({ event: 'closed_account_document_cleanup_failed', requestId: request.id },
                        'Could not remove a closed account profile document');
                });
            }            for (const storageKey of outcome.profileMediaKeys) {
                const path = profileMediaStoragePath(storageKey);
                if (path) await unlink(path).catch(() => {
                    request.log.warn({ event: 'closed_account_media_cleanup_failed', requestId: request.id },
                        'Could not remove a closed account profile image');
                });
            }
            return { status: 'closed' };
        }
    );
    server.get('/api/v1/admin/roles', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'users.roles.manage')) return;
        const [roles, communities, assignments] = await Promise.all([
            pool.query(
                `SELECT role.id::text AS id, role.code, role.name, role.description, role.is_system,
                        count(DISTINCT assignment.user_id)::int AS assigned_users,
                        COALESCE(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), ARRAY[]::text[]) AS permissions
                 FROM impacta.roles AS role
                 LEFT JOIN impacta.user_roles AS assignment ON assignment.role_id = role.id
                 LEFT JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = role.id
                 LEFT JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                 GROUP BY role.id ORDER BY role.id`
            ),
            pool.query(`SELECT id::text AS id, name FROM impacta.communities WHERE status = 'active' ORDER BY name LIMIT 200`),
            pool.query(
                `SELECT assignment.id::text AS id, account.id::text AS user_id, account.display_name,
                        role.code AS role_code, role.name AS role_name,
                        community.id::text AS community_id, community.name AS community_name, assignment.granted_at
                 FROM impacta.user_roles AS assignment
                 JOIN impacta.users AS account ON account.id = assignment.user_id
                 JOIN impacta.roles AS role ON role.id = assignment.role_id
                 LEFT JOIN impacta.communities AS community ON community.id = assignment.scope_id
                 WHERE role.code IN ('support_agent', 'moderator', 'community_manager')
                 ORDER BY assignment.granted_at DESC LIMIT 100`
            )
        ]);
        return { items: roles.rows, communities: communities.rows, assignments: assignments.rows, assignableRoles: ['support_agent', 'moderator', 'community_manager'] };
    });

    server.get('/api/v1/admin/communities/managed', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'communities.manage')) return;
        const result = await pool.query(
            `SELECT community.id::text AS id, community.name, community.description, community.status,
                    community.created_at, count(member.user_id)::int AS member_count
             FROM impacta.communities AS community
             LEFT JOIN impacta.community_members AS member ON member.community_id = community.id AND member.status = 'active'
             WHERE community.status IN ('active','suspended','archived')
             GROUP BY community.id ORDER BY community.created_at DESC LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Params: { communityId: string }; Body: { status?: string; reason?: string } }>(
        '/api/v1/admin/communities/:communityId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'communities.manage', true);
            if (!session) return;
            const { communityId } = request.params;
            const status = request.body?.status;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(communityId) || !['active', 'suspended', 'archived'].includes(status ?? '') || !reason) {
                return reply.code(400).send({ error: 'invalid_community_status' });
            }
            const result = await pool.query(
                `UPDATE impacta.communities SET status = $2, updated_at = now()
                 WHERE id = $1 AND status IN ('active','suspended','archived') RETURNING id::text AS id`, [communityId, status]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'community_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                 VALUES ($1, $2, 'community', $3, $4)`, [session.userId, `community.${status}`, communityId, reason]
            );
            return { status };
        }
    );

    server.get('/api/v1/admin/projects/managed', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'projects.review')) return;
        const result = await pool.query(
            `SELECT project.id::text AS id, project.title, project.description, project.status,
                    project.community_id::text AS community_id, project.created_at, project.starts_at, project.ends_at,
                    project.location_city, project.location_province, project.location_municipality,
                    project.location_commune, project.location_neighborhood,
                    community.name AS community_name, count(member.user_id)::int AS participant_count
             FROM impacta.projects AS project
             LEFT JOIN impacta.communities AS community ON community.id = project.community_id
             LEFT JOIN impacta.project_members AS member ON member.project_id = project.id
             WHERE project.status IN ('active','completed','archived')
             GROUP BY project.id, community.name ORDER BY project.created_at DESC LIMIT 100`
        );
        return { items: result.rows };
    });

    server.get<{ Querystring: { offset?: string } }>('/api/v1/admin/projects/activity', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'projects.review');
        if (!session) return;
        const rawOffset = request.query?.offset;
        const offset = rawOffset === undefined ? 0 : /^\d{1,6}$/.test(rawOffset) ? Number(rawOffset) : NaN;
        if (!Number.isSafeInteger(offset) || offset < 0) return reply.code(400).send({ error: 'invalid_activity_offset' });
        await pool.query(
            `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, reason)
             VALUES ($1, 'project.activity.read', 'project', 'Leitura administrativa da atividade dos projetos.')`,
            [session.userId]
        );
        const [members, submissions] = await Promise.all([
            pool.query(
                `SELECT project.id::text AS project_id, project.title AS project_title,
                        community.name AS community_name, account.display_name,
                        project_member.membership_role
                 FROM impacta.project_members AS project_member
                 JOIN impacta.projects AS project ON project.id = project_member.project_id
                 JOIN impacta.users AS account ON account.id = project_member.user_id AND account.status = 'active'
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 ORDER BY project.created_at DESC, project.id DESC, account.display_name
                 LIMIT 100 OFFSET $1`, [offset]
            ),
            pool.query(
                `SELECT participation.id::text AS id, project.title AS project_title,
                        community.name AS community_name, challenge.title AS challenge_title,
                        participation.submission, participation.submitted_at,
                        account.display_name
                 FROM impacta.challenge_participations AS participation
                 JOIN impacta.challenges AS challenge ON challenge.id = participation.challenge_id
                 JOIN impacta.projects AS project ON project.id = challenge.project_id
                 JOIN impacta.users AS account ON account.id = participation.user_id AND account.status = 'active'
                 LEFT JOIN impacta.communities AS community ON community.id = project.community_id
                 ORDER BY participation.submitted_at DESC, participation.id DESC
                 LIMIT 100 OFFSET $1`, [offset]
            )
        ]);
        return {
            members: members.rows,
            submissions: submissions.rows,
            next_offset: offset + 100,
            has_more: members.rows.length === 100 || submissions.rows.length === 100
        };
    });

    server.post<{ Params: { projectId: string }; Body: { status?: string; reason?: string } }>(
        '/api/v1/admin/projects/:projectId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'projects.review', true);
            if (!session) return;
            const { projectId } = request.params;
            const status = request.body?.status;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(projectId) || !['active', 'completed', 'archived'].includes(status ?? '') || !reason) {
                return reply.code(400).send({ error: 'invalid_project_status' });
            }
            const result = await pool.query(
                `UPDATE impacta.projects SET status = $2, updated_at = now()
                 WHERE id = $1 AND status IN ('active','completed','archived') RETURNING id::text AS id`, [projectId, status]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'project_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                 VALUES ($1, $2, 'project', $3, $4)`, [session.userId, `project.${status}`, projectId, reason]
            );
            return { status };
        }
    );

    server.get('/api/v1/admin/moderation/actions', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'content.read')) return;
        const result = await pool.query(
            `SELECT action.id::text AS id, action.action_type, action.reason, action.created_at,
                    actor.display_name AS actor_name, target.display_name AS target_user_name,
                    action.post_id::text AS post_id, action.comment_id::text AS comment_id
             FROM impacta.moderation_actions AS action
             LEFT JOIN impacta.users AS actor ON actor.id = action.actor_user_id
             LEFT JOIN impacta.users AS target ON target.id = action.target_user_id
             ORDER BY action.created_at DESC LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Body: { userId?: string; roleCode?: string; communityId?: string } }>(
        '/api/v1/admin/roles/assign', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'users.roles.manage', true);
            if (!session) return;
            const { userId, roleCode, communityId } = request.body ?? {};
            if (!validId(userId) || userId === session.userId
                || !['support_agent', 'moderator', 'community_manager'].includes(roleCode ?? '')) {
                return reply.code(400).send({ error: 'invalid_role_assignment' });
            }
            const isCommunityRole = roleCode === 'community_manager';
            if ((isCommunityRole && !validId(communityId)) || (!isCommunityRole && communityId)) {
                return reply.code(400).send({ error: 'invalid_role_scope' });
            }
            const result = await transaction(pool, async (client) => {
                const target = await client.query(`SELECT id FROM impacta.users WHERE id = $1 AND status = 'active' FOR UPDATE`, [userId]);
                if (!target.rows[0]) return 'user_unavailable' as const;
                const role = await client.query<{ id: string }>(`SELECT id::text AS id FROM impacta.roles WHERE code = $1`, [roleCode]);
                if (!role.rows[0]) return 'role_unavailable' as const;
                if (isCommunityRole) {
                    const community = await client.query(`SELECT id FROM impacta.communities WHERE id = $1 AND status = 'active'`, [communityId]);
                    if (!community.rows[0]) return 'community_unavailable' as const;
                }
                const existing = await client.query(
                    `SELECT id FROM impacta.user_roles WHERE user_id = $1 AND role_id = $2
                     AND scope_type = $3 AND scope_id IS NOT DISTINCT FROM $4::bigint`,
                    [userId, role.rows[0].id, isCommunityRole ? 'community' : 'platform', isCommunityRole ? communityId : null]
                );
                if (existing.rows[0]) return 'already_assigned' as const;
                await client.query(
                    `INSERT INTO impacta.user_roles (user_id, role_id, granted_by_user_id, scope_type, scope_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [userId, role.rows[0].id, session.userId, isCommunityRole ? 'community' : 'platform', isCommunityRole ? communityId : null]
                );
                const requiresMfa = await client.query<{ required: boolean }>(
                    `SELECT EXISTS (
                         SELECT 1 FROM impacta.role_permissions AS role_permission
                         JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
                         WHERE role_permission.role_id = $1
                           AND permission.code IN ('admin.dashboard.read', 'reports.manage', 'content.moderate',
                                                   'communities.manage', 'projects.review')
                     ) AS required`,
                    [role.rows[0].id]
                );
                if (requiresMfa.rows[0]?.required) {
                    await client.query('UPDATE impacta.users SET mfa_required = true WHERE id = $1', [userId]);
                    await client.query(
                        'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                        [userId]
                    );
                }
                await audit(client, session.userId, 'user.role.grant', 'user', userId, `${roleCode}${communityId ? `:${communityId}` : ''}`);
                return 'assigned';
            });
            if (result === 'user_unavailable' || result === 'role_unavailable' || result === 'community_unavailable') {
                return reply.code(404).send({ error: result });
            }
            if (result === 'already_assigned') return reply.code(409).send({ error: result });
            return { status: result };
        }
    );

    server.delete<{ Params: { assignmentId: string }; Body: { reason?: string } }>(
        '/api/v1/admin/roles/:assignmentId', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'users.roles.manage', true);
            if (!session) return;
            const { assignmentId } = request.params;
            const reason = cleanText(request.body?.reason, 1000);
            if (!validId(assignmentId) || !reason) return reply.code(400).send({ error: 'invalid_role_removal' });
            const result = await transaction(pool, async (client) => {
                const assignment = await client.query<{ user_id: string; role_code: string }>(
                    `SELECT assignment.user_id::text AS user_id, role.code AS role_code
                     FROM impacta.user_roles AS assignment JOIN impacta.roles AS role ON role.id = assignment.role_id
                     WHERE assignment.id = $1 FOR UPDATE`, [assignmentId]
                );
                const current = assignment.rows[0];
                if (!current || !['support_agent', 'moderator', 'community_manager'].includes(current.role_code)) {
                    return 'assignment_unavailable' as const;
                }
                await client.query('DELETE FROM impacta.user_roles WHERE id = $1', [assignmentId]);
                await audit(client, session.userId, 'user.role.revoke', 'user', current.user_id, `${current.role_code}: ${reason}`);
                return 'removed';
            });
            if (result === 'assignment_unavailable') return reply.code(404).send({ error: result });
            return { status: result };
        }
    );

    server.post<{ Params: { announcementId: string }; Body: { eventType?: unknown; visitorId?: unknown } }>(
        '/api/v1/site/announcements/:announcementId/metrics', async (request, reply) => {
            const { announcementId } = request.params;
            const eventType = request.body?.eventType;
            const visitorId = request.body?.visitorId;
            if (!validId(announcementId) || !['impression', 'click'].includes(String(eventType))
                || typeof visitorId !== 'string'
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
                return reply.code(400).send({ error: 'invalid_announcement_metric' });
            }

            const now = Date.now();
            const rateKey = createHash('sha256').update(request.ip).digest('hex');
            let bucket = promotionRateBuckets.get(rateKey);
            if (!bucket || now - bucket.startedAt >= 60_000) {
                bucket = { startedAt: now, count: 0 };
                promotionRateBuckets.set(rateKey, bucket);
            }
            bucket.count += 1;
            if (promotionRateBuckets.size > 5000) {
                for (const [key, value] of promotionRateBuckets) {
                    if (now - value.startedAt >= 60_000) promotionRateBuckets.delete(key);
                }
            }
            if (bucket.count > 120) return reply.code(429).send({ error: 'announcement_metric_rate_limit' });

            const visitorHash = createHash('sha256')
                .update(`${announcementId}:${visitorId.toLowerCase()}`)
                .digest('hex');
            const result = await pool.query(
                `INSERT INTO impacta.announcement_metric_events
                    (announcement_id, event_type, visitor_hash)
                 SELECT announcement.id, $2, $3
                 FROM impacta.announcements AS announcement
                 WHERE announcement.id = $1
                   AND announcement.placement IN ('announcement', 'advertisement')
                   AND announcement.status IN ('published', 'scheduled')
                   AND (announcement.publish_at IS NULL OR announcement.publish_at <= now())
                   AND (announcement.expires_at IS NULL OR announcement.expires_at > now())
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [announcementId, eventType, visitorHash]
            );
            return { tracked: result.rowCount === 1 };
        }
    );

    server.get('/api/v1/admin/announcements', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'announcements.manage')) return;
        const result = await pool.query(
            `SELECT announcement.id::text AS id, announcement.title, announcement.body,
                    announcement.placement, announcement.image_media_id::text AS image_id,
                    announcement.target_url, announcement.advertiser_name, announcement.advertiser_email,
                    CASE WHEN media.id IS NOT NULL THEN '/api/v1/media/' || media.id::text END AS image_url,
                    announcement.status, announcement.publish_at, announcement.expires_at,
                    announcement.created_at, author.display_name AS author_name,
                    COALESCE(metrics.impressions, 0)::int AS impressions,
                    COALESCE(metrics.unique_reach, 0)::int AS unique_reach,
                    COALESCE(metrics.clicks, 0)::int AS clicks,
                    COALESCE(metrics.unique_clickers, 0)::int AS unique_clickers
             FROM impacta.announcements AS announcement
             LEFT JOIN impacta.users AS author ON author.id = announcement.author_user_id
             LEFT JOIN impacta.media AS media ON media.id = announcement.image_media_id AND media.status = 'available'
             LEFT JOIN LATERAL (
                 SELECT count(*) FILTER (WHERE event.event_type = 'impression') AS impressions,
                        count(DISTINCT event.visitor_hash) FILTER (WHERE event.event_type = 'impression') AS unique_reach,
                        count(*) FILTER (WHERE event.event_type = 'click') AS clicks,
                        count(DISTINCT event.visitor_hash) FILTER (WHERE event.event_type = 'click') AS unique_clickers
                 FROM impacta.announcement_metric_events AS event
                 WHERE event.announcement_id = announcement.id
             ) AS metrics ON true
             ORDER BY announcement.created_at DESC LIMIT 100`
        );
        return { items: result.rows };
    });

    server.get<{
        Params: { announcementId: string };
        Querystring: { from?: string; to?: string; format?: string };
    }>('/api/v1/admin/announcements/:announcementId/report', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'announcements.manage');
        if (!session) return;
        const { announcementId } = request.params;
        const requestedFrom = request.query.from;
        const requestedTo = request.query.to;
        const format = request.query.format;
        if (!validId(announcementId) || !isIsoDate(requestedFrom) || !isIsoDate(requestedTo)
            || !['xls', 'doc'].includes(format ?? '')
            || requestedFrom > requestedTo
            || (Date.parse(`${requestedTo}T00:00:00Z`) - Date.parse(`${requestedFrom}T00:00:00Z`)) / 86_400_000 > 366) {
            return reply.code(400).send({ error: 'invalid_announcement_report_period' });
        }

        const [campaign, totals, days] = await Promise.all([
            pool.query<{
                title: string; advertiser_name: string | null; advertiser_email: string | null;
                status: string; placement: string; target_url: string | null;
            }>(
                `SELECT title, advertiser_name, advertiser_email, status, placement, target_url
                 FROM impacta.announcements WHERE id = $1`, [announcementId]
            ),
            pool.query<{
                impressions: string; unique_reach: string; clicks: string; unique_clickers: string;
            }>(
                `SELECT count(*) FILTER (WHERE event_type = 'impression')::text AS impressions,
                        count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'impression')::text AS unique_reach,
                        count(*) FILTER (WHERE event_type = 'click')::text AS clicks,
                        count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'click')::text AS unique_clickers
                 FROM impacta.announcement_metric_events
                 WHERE announcement_id = $1 AND event_day BETWEEN $2::date AND $3::date`,
                [announcementId, requestedFrom, requestedTo]
            ),
            pool.query<{
                day: string; impressions: number; unique_reach: number; clicks: number; unique_clickers: number;
            }>(
                `WITH calendar AS (
                     SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
                 ), daily AS (
                     SELECT event_day AS day,
                            count(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
                            count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'impression')::int AS unique_reach,
                            count(*) FILTER (WHERE event_type = 'click')::int AS clicks,
                            count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'click')::int AS unique_clickers
                     FROM impacta.announcement_metric_events
                     WHERE announcement_id = $1 AND event_day BETWEEN $2::date AND $3::date
                     GROUP BY event_day
                 )
                 SELECT to_char(calendar.day, 'YYYY-MM-DD') AS day,
                        COALESCE(daily.impressions, 0)::int AS impressions,
                        COALESCE(daily.unique_reach, 0)::int AS unique_reach,
                        COALESCE(daily.clicks, 0)::int AS clicks,
                        COALESCE(daily.unique_clickers, 0)::int AS unique_clickers
                 FROM calendar LEFT JOIN daily USING (day) ORDER BY calendar.day`,
                [announcementId, requestedFrom, requestedTo]
            )
        ]);
        const info = campaign.rows[0];
        if (!info) return reply.code(404).send({ error: 'announcement_unavailable' });
        const stats = totals.rows[0];
        const impressions = Number(stats.impressions);
        const clicks = Number(stats.clicks);
        const report: AnnouncementReport = {
            title: info.title,
            advertiserName: info.advertiser_name ?? '',
            advertiserEmail: info.advertiser_email ?? '',
            status: info.status,
            placement: info.placement,
            targetUrl: info.target_url ?? '',
            from: requestedFrom,
            to: requestedTo,
            impressions,
            uniqueReach: Number(stats.unique_reach),
            clicks,
            uniqueClickers: Number(stats.unique_clickers),
            ctr: impressions ? clicks / impressions * 100 : 0,
            days: days.rows.map((day) => ({
                day: day.day,
                impressions: day.impressions,
                uniqueReach: day.unique_reach,
                clicks: day.clicks,
                uniqueClickers: day.unique_clickers
            }))
        };

        await pool.query(
            `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
             VALUES ($1, $2, 'announcement', $3, $4)`,
            [session.userId, `announcement.report.${format}`, announcementId, `${requestedFrom} a ${requestedTo}`]
        );

        const file = format === 'xls' ? buildExcelReport(report) : buildWordReport(report);
        const extension = format;
        const fileName = escapeHeaderFilename(`impacta-metricas-${announcementId}-${requestedFrom}-${requestedTo}.${extension}`);
        return reply
            .header('content-type', format === 'xls' ? 'application/vnd.ms-excel; charset=utf-8' : 'application/msword; charset=utf-8')
            .header('content-disposition', `attachment; filename="${fileName}"`)
            .send(`\uFEFF${file}`);
    });

    server.post('/api/v1/admin/promotions/media', {
        bodyLimit: MAX_POST_IMAGE_BYTES,
        handlerTimeout: 60_000,
        onRequest: async (request, reply) => {
            if (!await adminSession(request, reply, pool, 'announcements.manage', true)) return;
        }
    }, async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'announcements.manage', true);
        if (!session) return;
        const mimeType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType ?? '')) {
            return reply.code(415).send({ error: 'unsupported_promotion_image_type' });
        }
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
            return reply.code(400).send({ error: 'invalid_promotion_image' });
        }
        if (request.body.length > MAX_POST_IMAGE_BYTES) {
            return reply.code(413).send({ error: 'promotion_image_too_large' });
        }

        let processed;
        try {
            processed = await optimizePostImage(request.body);
        } catch (error) {
            if (error instanceof MediaProcessingError) {
                return reply.code(error.statusCode).send({ error: error.code });
            }
            throw error;
        }

        const storageKey = `promotions/${randomUUID()}.webp`;
        const path = promotionMediaStoragePath(storageKey);
        if (!path) return reply.code(500).send({ error: 'media_storage_unavailable' });
        await mkdir(PROMOTION_MEDIA_DIRECTORY, { recursive: true, mode: 0o700 });
        await writeFile(path, processed.bytes, { flag: 'wx', mode: 0o600 });
        try {
            const media = await transaction(pool, async (client) => {
                const inserted = await client.query<{ id: string }>(
                    `INSERT INTO impacta.media
                        (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
                     VALUES ($1, $2, 'image', $3, $4, $5, 'available')
                     RETURNING id::text AS id`,
                    [session.userId, storageKey, processed.mimeType, processed.bytes.length,
                        createHash('sha256').update(processed.bytes).digest('hex')]
                );
                await audit(client, session.userId, 'promotion.image.upload', 'media', inserted.rows[0].id, 'Imagem de aviso/anúncio');
                return inserted.rows[0];
            });
            return reply.code(201).send({
                id: media.id,
                url: `/api/v1/media/${encodeURIComponent(media.id)}`,
                mediaType: processed.mediaType,
                mimeType: processed.mimeType,
                byteSize: processed.bytes.length
            });
        } catch (error) {
            await unlink(path).catch(() => undefined);
            throw error;
        }
    });

    server.delete<{ Params: { mediaId: string } }>(
        '/api/v1/admin/promotions/media/:mediaId', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'announcements.manage', true);
            if (!session) return;
            const mediaId = request.params.mediaId;
            if (!validId(mediaId)) return reply.code(400).send({ error: 'invalid_promotion_image' });
            const storageKey = await transaction(pool, async (client) => {
                const removed = await client.query<{ storage_key: string }>(
                    `UPDATE impacta.media AS media SET status = 'deleted'
                     WHERE media.id = $1 AND media.owner_user_id = $2 AND media.status = 'available'
                       AND media.storage_key LIKE 'promotions/%'
                       AND NOT EXISTS (SELECT 1 FROM impacta.announcements AS announcement
                                       WHERE announcement.image_media_id = media.id)
                       AND NOT EXISTS (SELECT 1 FROM impacta.platform_settings AS setting
                                       WHERE setting.key = 'homepage.notice.image'
                                         AND setting.value #>> '{}' = media.id::text)
                     RETURNING media.storage_key`,
                    [mediaId, session.userId]
                );
                if (!removed.rows[0]) return null;
                await audit(client, session.userId, 'promotion.image.remove', 'media', mediaId, 'Imagem de aviso/anúncio não utilizada');
                return removed.rows[0].storage_key;
            });
            if (!storageKey) return reply.code(404).send({ error: 'promotion_image_unavailable' });
            const path = promotionMediaStoragePath(storageKey);
            if (path) await unlink(path).catch(() => undefined);
            return { status: 'removed' };
        }
    );

    server.post<{ Body: {
        title?: string; body?: string; placement?: string; imageId?: string;
        targetUrl?: string; status?: string; publishAt?: string; expiresAt?: string;
        advertiserName?: string; advertiserEmail?: string;
    } }>(
        '/api/v1/admin/announcements', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'announcements.manage', true);
            if (!session) return;
            const title = cleanOptionalText(request.body?.title, 160);
            const body = cleanOptionalText(request.body?.body, 5000);
            const placement = request.body?.placement;
            const rawImageId = request.body?.imageId;
            const imageId = typeof rawImageId === 'string' && validId(rawImageId) ? rawImageId : undefined;
            const targetUrl = parseHttpUrl(request.body?.targetUrl);
            const advertiserNameRaw = request.body?.advertiserName;
            const advertiserName = advertiserNameRaw === undefined || advertiserNameRaw === null
                || (typeof advertiserNameRaw === 'string' && !advertiserNameRaw.trim())
                ? null : cleanText(advertiserNameRaw, 160);
            const rawAdvertiserEmail = request.body?.advertiserEmail;
            const advertiserEmailRaw = rawAdvertiserEmail === undefined || rawAdvertiserEmail === null
                || (typeof rawAdvertiserEmail === 'string' && !rawAdvertiserEmail.trim())
                ? null : typeof rawAdvertiserEmail === 'string' ? rawAdvertiserEmail.trim().toLowerCase() : undefined;
            const advertiserEmail = advertiserEmailRaw && advertiserEmailRaw.length <= 254
                && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(advertiserEmailRaw)
                ? advertiserEmailRaw : advertiserEmailRaw === null ? null : undefined;
            const status = request.body?.status;
            const rawPublishAt = request.body?.publishAt;
            const publishAt = typeof rawPublishAt === 'string' && rawPublishAt.trim() ? new Date(rawPublishAt) : null;
            const rawExpiresAt = request.body?.expiresAt;
            const expiresAt = rawExpiresAt === undefined || rawExpiresAt === null
                || (typeof rawExpiresAt === 'string' && !rawExpiresAt.trim())
                ? null : typeof rawExpiresAt === 'string' ? new Date(rawExpiresAt) : undefined;
            if (!publishAt || Number.isNaN(publishAt.getTime())) {
                return reply.code(400).send({ error: 'announcement_date_required' });
            }
            if (!imageId) return reply.code(400).send({ error: 'announcement_image_required' });
            if (title === undefined || body === undefined || !['notice', 'announcement', 'advertisement'].includes(placement ?? '')
                || targetUrl === undefined || advertiserName === undefined || advertiserEmail === undefined
                || !['draft', 'published', 'scheduled'].includes(status ?? '')
                || expiresAt === undefined || (expiresAt && Number.isNaN(expiresAt.getTime()))
                || (expiresAt && expiresAt <= publishAt)) {
                return reply.code(400).send({ error: 'invalid_announcement' });
            }
            if (status === 'published' && publishAt.getTime() > Date.now()) {
                return reply.code(400).send({ error: 'announcement_date_in_future' });
            }
            if (status === 'scheduled' && publishAt.getTime() <= Date.now()) {
                return reply.code(400).send({ error: 'announcement_schedule_must_be_future' });
            }
            let outcome: { id: string } | null;
            try {
                outcome = await transaction(pool, async (client) => {
                    if (!await validatePromotionImage(client, imageId, session.userId)) return null;
                    const result = await client.query<{ id: string }>(
                        `INSERT INTO impacta.announcements
                            (author_user_id, title, body, placement, image_media_id, target_url,
                             advertiser_name, advertiser_email,
                             status, audience, publish_at, expires_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{"type":"all"}'::jsonb,
                                 CASE WHEN $9 = 'published' THEN COALESCE($10, now()) ELSE $10 END, $11)
                         RETURNING id::text AS id`,
                        [session.userId, title, body, placement, imageId, targetUrl, advertiserName, advertiserEmail,
                            status, publishAt, expiresAt]
                    );
                    await audit(client, session.userId, 'announcement.create', 'announcement', result.rows[0].id,
                        `${placement}: ${title || 'sem título'}`);
                    return result.rows[0];
                });
            } catch (error) {
                if (isAdminActionsMigrationRequired(error)) {
                    return reply.code(503).send({ error: 'admin_actions_migration_required' });
                }
                if (isPromotionOptionalCopyConstraintError(error)) {
                    return reply.code(503).send({ error: 'announcement_optional_copy_migration_required' });
                }
                throw error;
            }
            if (!outcome) return reply.code(400).send({ error: 'promotion_image_unavailable' });
            return reply.code(201).send({ id: outcome.id, status });
        }
    );

    server.put<{ Params: { announcementId: string }; Body: {
        title?: unknown; body?: unknown; placement?: unknown; imageId?: unknown;
        targetUrl?: unknown; status?: unknown; publishAt?: unknown; expiresAt?: unknown;
        advertiserName?: unknown; advertiserEmail?: unknown;
    } }>(
        '/api/v1/admin/announcements/:announcementId', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'announcements.manage', true);
            if (!session) return;
            const { announcementId } = request.params;
            if (!validId(announcementId)) return reply.code(400).send({ error: 'invalid_announcement' });

            const title = cleanOptionalText(request.body?.title, 160);
            const body = cleanOptionalText(request.body?.body, 5000);
            const placement = request.body?.placement;
            const targetUrl = parseHttpUrl(request.body?.targetUrl);
            const advertiserNameRaw = request.body?.advertiserName;
            const advertiserName = advertiserNameRaw === undefined || advertiserNameRaw === null
                || (typeof advertiserNameRaw === 'string' && !advertiserNameRaw.trim())
                ? null : cleanText(advertiserNameRaw, 160);
            const rawAdvertiserEmail = request.body?.advertiserEmail;
            const advertiserEmailRaw = rawAdvertiserEmail === undefined || rawAdvertiserEmail === null
                || (typeof rawAdvertiserEmail === 'string' && !rawAdvertiserEmail.trim())
                ? null : typeof rawAdvertiserEmail === 'string' ? rawAdvertiserEmail.trim().toLowerCase() : undefined;
            const advertiserEmail = advertiserEmailRaw && advertiserEmailRaw.length <= 254
                && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(advertiserEmailRaw)
                ? advertiserEmailRaw : advertiserEmailRaw === null ? null : undefined;
            const status = request.body?.status;
            const rawPublishAt = request.body?.publishAt;
            const publishAt = typeof rawPublishAt === 'string' && rawPublishAt.trim() ? new Date(rawPublishAt) : null;
            const rawExpiresAt = request.body?.expiresAt;
            const expiresAt = rawExpiresAt === undefined || rawExpiresAt === null
                || (typeof rawExpiresAt === 'string' && !rawExpiresAt.trim())
                ? null : typeof rawExpiresAt === 'string' ? new Date(rawExpiresAt) : undefined;
            if (!publishAt || Number.isNaN(publishAt.getTime())) {
                return reply.code(400).send({ error: 'announcement_date_required' });
            }
            if (title === undefined || body === undefined
                || !['notice', 'announcement', 'advertisement'].includes(String(placement))
                || targetUrl === undefined || advertiserName === undefined || advertiserEmail === undefined
                || !['draft', 'published', 'scheduled', 'archived'].includes(String(status))
                || expiresAt === undefined || (expiresAt && Number.isNaN(expiresAt.getTime()))
                || (expiresAt && expiresAt <= publishAt)) {
                return reply.code(400).send({ error: 'invalid_announcement' });
            }
            if (status === 'published' && publishAt.getTime() > Date.now()) {
                return reply.code(400).send({ error: 'announcement_date_in_future' });
            }
            if (status === 'scheduled' && publishAt.getTime() <= Date.now()) {
                return reply.code(400).send({ error: 'announcement_schedule_must_be_future' });
            }

            let outcome: 'updated' | 'missing' | 'image_missing' | 'image_unavailable';
            try {
                outcome = await transaction(pool, async (client) => {
                    const current = await client.query<{ image_id: string | null }>(
                        `SELECT image_media_id::text AS image_id
                         FROM impacta.announcements WHERE id = $1 FOR UPDATE`,
                        [announcementId]
                    );
                    if (!current.rows[0]) return 'missing';
                    let imageId = current.rows[0].image_id;
                    if (request.body?.imageId !== undefined) {
                        if (typeof request.body.imageId !== 'string' || !validId(request.body.imageId)) return 'image_missing';
                        imageId = request.body.imageId;
                        if (!await validatePromotionImage(client, imageId, session.userId)) return 'image_unavailable';
                    } else if (!imageId) {
                        return 'image_missing';
                    } else {
                        const image = await client.query(
                            `SELECT 1 FROM impacta.media
                             WHERE id = $1 AND status = 'available' AND media_type = 'image'
                               AND storage_key LIKE 'promotions/%' FOR UPDATE`,
                            [imageId]
                        );
                        if (!image.rowCount) return 'image_unavailable';
                    }

                    await client.query(
                        `UPDATE impacta.announcements
                         SET title = $2, body = $3, placement = $4, image_media_id = $5, target_url = $6,
                             advertiser_name = $7, advertiser_email = $8, status = $9,
                             publish_at = CASE WHEN $9 = 'published' THEN COALESCE($10, now()) ELSE $10 END,
                             expires_at = $11, updated_at = now()
                         WHERE id = $1`,
                        [announcementId, title, body, placement, imageId, targetUrl,
                            advertiserName, advertiserEmail, status, publishAt, expiresAt]
                    );
                    await audit(client, session.userId, 'announcement.edit', 'announcement', announcementId,
                        String(placement) + ': ' + (title || 'sem título'));
                    return 'updated';
                });
            } catch (error) {
                if (isAdminActionsMigrationRequired(error)) {
                    return reply.code(503).send({ error: 'admin_actions_migration_required' });
                }
                if (isPromotionOptionalCopyConstraintError(error)) {
                    return reply.code(503).send({ error: 'announcement_optional_copy_migration_required' });
                }
                throw error;
            }
            if (outcome === 'missing') return reply.code(404).send({ error: 'announcement_unavailable' });
            if (outcome === 'image_missing') return reply.code(400).send({ error: 'announcement_image_required' });
            if (outcome === 'image_unavailable') return reply.code(400).send({ error: 'promotion_image_unavailable' });
            return { status: 'updated' };
        }
    );
    server.post<{ Params: { announcementId: string }; Body: { status?: string } }>(
        '/api/v1/admin/announcements/:announcementId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'announcements.manage', true);
            if (!session) return;
            const { announcementId } = request.params;
            const status = request.body?.status;
            if (!validId(announcementId) || !['draft', 'published', 'archived'].includes(status ?? '')) {
                return reply.code(400).send({ error: 'invalid_announcement_status' });
            }
            const result = await pool.query(
                `UPDATE impacta.announcements SET status = $2,
                    publish_at = CASE WHEN $2 = 'published' THEN now() ELSE publish_at END
                 WHERE id = $1 RETURNING id::text AS id`, [announcementId, status]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'announcement_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id)
                 VALUES ($1, $2, 'announcement', $3)`,
                [session.userId, `announcement.${status}`, announcementId]
            );
            return { status };
        }
    );

    server.delete<{ Params: { announcementId: string } }>(
        '/api/v1/admin/announcements/:announcementId', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'announcements.manage', true);
            if (!session) return;
            const { announcementId } = request.params;
            if (!validId(announcementId)) return reply.code(400).send({ error: 'invalid_announcement' });

            const outcome = await transaction(pool, async (client) => {
                const current = await client.query<{ status: string }>(
                    `SELECT status FROM impacta.announcements WHERE id = $1 FOR UPDATE`,
                    [announcementId]
                );
                if (!current.rows[0]) return 'missing' as const;
                if (current.rows[0].status === 'archived') return 'already_archived' as const;
                await client.query(
                    `UPDATE impacta.announcements
                     SET status = 'archived', updated_at = now() WHERE id = $1`,
                    [announcementId]
                );
                await audit(client, session.userId, 'announcement.remove', 'announcement', announcementId,
                    'Removido da área pública; métricas preservadas para relatórios.');
                return 'removed' as const;
            });
            if (outcome === 'missing') return reply.code(404).send({ error: 'announcement_unavailable' });
            return { status: outcome === 'removed' ? 'archived' : 'already_archived' };
        }
    );
    server.get('/api/v1/admin/challenges', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'projects.review');
        if (!session) return;
        const result = await pool.query(
            `SELECT challenge.id::text AS id, challenge.project_id::text AS project_id,
                    challenge.title, challenge.description, challenge.status, challenge.opens_at,
                    challenge.closes_at, challenge.created_at, project.title AS project_title,
                    count(participation.id)::int AS submissions
             FROM impacta.challenges AS challenge
             JOIN impacta.projects AS project ON project.id = challenge.project_id
             LEFT JOIN impacta.challenge_participations AS participation ON participation.challenge_id = challenge.id
             WHERE project.status = 'active'
             GROUP BY challenge.id, project.title
             ORDER BY challenge.created_at DESC LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Body: { projectId?: string; title?: string; description?: string; opensAt?: string; closesAt?: string } }>(
        '/api/v1/admin/challenges', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'projects.review', true);
            if (!session) return;
            const projectId = request.body?.projectId;
            const title = cleanOptionalText(request.body?.title, 160);
            const description = cleanText(request.body?.description, 3000);
            const opensAt = request.body?.opensAt ? new Date(request.body.opensAt) : null;
            const closesAt = request.body?.closesAt ? new Date(request.body.closesAt) : null;
            if (!validId(projectId) || !title || !description
                || (opensAt && Number.isNaN(opensAt.getTime())) || (closesAt && Number.isNaN(closesAt.getTime()))
                || (opensAt && closesAt && closesAt <= opensAt)) {
                return reply.code(400).send({ error: 'invalid_challenge' });
            }
            const project = await pool.query(`SELECT id FROM impacta.projects WHERE id = $1 AND status = 'active'`, [projectId]);
            if (!project.rows[0]) return reply.code(404).send({ error: 'active_project_required' });
            const status = opensAt && opensAt.getTime() > Date.now() ? 'draft' : 'open';
            const result = await pool.query<{ id: string }>(
                `INSERT INTO impacta.challenges (project_id, created_by_user_id, title, description, status, opens_at, closes_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
                [projectId, session.userId, title, description, status, opensAt, closesAt]
            );
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                 VALUES ($1, 'challenge.create', 'challenge', $2, $3)`, [session.userId, result.rows[0].id, title]
            );
            return reply.code(201).send({ id: result.rows[0].id, status });
        }
    );

    server.post<{ Params: { challengeId: string }; Body: { status?: string } }>(
        '/api/v1/admin/challenges/:challengeId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'projects.review', true);
            if (!session) return;
            const { challengeId } = request.params;
            const status = request.body?.status;
            if (!validId(challengeId) || !['open', 'closed', 'archived'].includes(status ?? '')) {
                return reply.code(400).send({ error: 'invalid_challenge_status' });
            }
            const result = await pool.query(
                `UPDATE impacta.challenges SET status = $2 WHERE id = $1 RETURNING id::text AS id`, [challengeId, status]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'challenge_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id)
                 VALUES ($1, $2, 'challenge', $3)`, [session.userId, `challenge.${status}`, challengeId]
            );
            return { status };
        }
    );

    server.get('/api/v1/admin/recognition', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'recognition.manage')) return;
        const [badges, leaders] = await Promise.all([
            pool.query(
                `SELECT badge.id::text AS id, badge.code, badge.name, badge.description, badge.is_active,
                        count(user_badge.user_id)::int AS awards
                 FROM impacta.badges AS badge LEFT JOIN impacta.user_badges AS user_badge ON user_badge.badge_id = badge.id
                 GROUP BY badge.id ORDER BY badge.name`
            ),
            pool.query(
                `SELECT account.id::text AS id, account.display_name, COALESCE(sum(ledger.points_delta), 0)::int AS points
                 FROM impacta.users AS account LEFT JOIN impacta.points_ledger AS ledger ON ledger.user_id = account.id
                 WHERE account.status = 'active' GROUP BY account.id ORDER BY points DESC, account.display_name LIMIT 20`
            )
        ]);
        return { badges: badges.rows, leaders: leaders.rows };
    });

    server.post<{ Body: { code?: string; name?: string; description?: string } }>(
        '/api/v1/admin/recognition/badges', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'recognition.manage', true);
            if (!session) return;
            const code = typeof request.body?.code === 'string' ? request.body.code.trim().toLowerCase() : '';
            const name = cleanText(request.body?.name, 100);
            const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
            if (!/^[a-z][a-z0-9_]{1,39}$/.test(code) || !name || Array.from(description).length > 500 || description.includes('\u0000')) {
                return reply.code(400).send({ error: 'invalid_badge' });
            }
            try {
                const result = await pool.query<{ id: string }>(
                    `INSERT INTO impacta.badges (code, name, description)
                     VALUES ($1, $2, $3) RETURNING id::text AS id`, [code, name, description]
                );
                await pool.query(
                    `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                     VALUES ($1, 'recognition.badge.create', 'badge', $2, $3)`, [session.userId, result.rows[0].id, name]
                );
                return reply.code(201).send({ id: result.rows[0].id });
            } catch (error) {
                if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
                    return reply.code(409).send({ error: 'badge_code_exists' });
                }
                throw error;
            }
        }
    );

    server.post<{ Params: { userId: string }; Body: { badgeId?: string; reason?: string } }>(
        '/api/v1/admin/recognition/users/:userId/badges', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'recognition.manage', true);
            if (!session) return;
            const { userId } = request.params;
            const badgeId = request.body?.badgeId;
            const reason = cleanText(request.body?.reason, 500);
            if (!validId(userId) || !validId(badgeId) || !reason) return reply.code(400).send({ error: 'invalid_badge_award' });
            const result = await pool.query(
                `INSERT INTO impacta.user_badges (user_id, badge_id, awarded_by_user_id, reason)
                 SELECT account.id, badge.id, $3, $4
                 FROM impacta.users AS account CROSS JOIN impacta.badges AS badge
                 WHERE account.id = $1 AND account.status = 'active' AND badge.id = $2 AND badge.is_active
                 ON CONFLICT (user_id, badge_id) DO NOTHING RETURNING user_id`,
                [userId, badgeId, session.userId, reason]
            );
            if (!result.rowCount) return reply.code(409).send({ error: 'badge_or_user_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                 VALUES ($1, 'recognition.badge.award', 'user', $2, $3)`, [session.userId, userId, reason]
            );
            return { status: 'awarded' };
        }
    );

    server.post<{ Body: { userId?: string; points?: number; reason?: string } }>(
        '/api/v1/admin/recognition/points', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'recognition.manage', true);
            if (!session) return;
            const userId = request.body?.userId;
            const points = request.body?.points;
            const reason = cleanText(request.body?.reason, 500);
            if (!validId(userId) || !Number.isInteger(points) || !points || Math.abs(points) > 1000 || !reason) {
                return reply.code(400).send({ error: 'invalid_points_adjustment' });
            }
            await transaction(pool, async (client) => {
                const user = await client.query(`SELECT id FROM impacta.users WHERE id = $1 AND status = 'active'`, [userId]);
                if (!user.rows[0]) throw Object.assign(new Error('user_unavailable'), { statusCode: 404 });
                await client.query(
                    `INSERT INTO impacta.points_ledger (user_id, actor_user_id, points_delta, reason)
                     VALUES ($1, $2, $3, $4)`, [userId, session.userId, points, reason]
                );
                await audit(client, session.userId, 'recognition.points.adjust', 'user', userId, reason);
            });
            return { status: 'adjusted' };
        }
    );

    server.get('/api/v1/admin/privacy', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'privacy.manage')) return;
        const result = await pool.query(
            `SELECT privacy.id::text AS id, privacy.request_type, privacy.status, privacy.notes,
                    privacy.created_at, privacy.due_at, account.id::text AS user_id,
                    account.display_name AS user_name, account.email
             FROM impacta.privacy_requests AS privacy JOIN impacta.users AS account ON account.id = privacy.user_id
             ORDER BY CASE WHEN privacy.status IN ('received','reviewing','waiting_user') THEN 0 ELSE 1 END,
                      privacy.due_at NULLS LAST, privacy.created_at LIMIT 100`
        );
        return { items: result.rows };
    });

    server.post<{ Params: { requestId: string }; Body: { status?: string; notes?: string } }>(
        '/api/v1/admin/privacy/:requestId/status', async (request, reply) => {
            const session = await adminSession(request, reply, pool, 'privacy.manage', true);
            if (!session) return;
            const { requestId } = request.params;
            const status = request.body?.status;
            const notes = typeof request.body?.notes === 'string' ? request.body.notes.trim().slice(0, 2000) : '';
            if (!validId(requestId) || !['reviewing', 'waiting_user', 'completed', 'rejected'].includes(status ?? '')) {
                return reply.code(400).send({ error: 'invalid_privacy_request' });
            }
            const result = await pool.query(
                `UPDATE impacta.privacy_requests SET status = $2, notes = $3,
                    assigned_to_user_id = $4,
                    completed_at = CASE WHEN $2 IN ('completed','rejected') THEN now() ELSE NULL END
                 WHERE id = $1 RETURNING id::text AS id`, [requestId, status, notes, session.userId]
            );
            if (!result.rowCount) return reply.code(404).send({ error: 'privacy_request_unavailable' });
            await pool.query(
                `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id, reason)
                 VALUES ($1, $2, 'privacy_request', $3, NULLIF($4, ''))`,
                [session.userId, `privacy.${status}`, requestId, notes]
            );
            return { status };
        }
    );

    server.get<{ Querystring: { limit?: string } }>('/api/v1/admin/audit', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'audit.read')) return;
        const limit = Number(request.query.limit ?? 50);
        const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
        const result = await pool.query(
            `SELECT log.id::text AS id, log.action_code, log.target_type, log.target_id,
                    log.reason, log.occurred_at, actor.display_name AS actor_name
             FROM impacta.admin_audit_log AS log LEFT JOIN impacta.users AS actor ON actor.id = log.actor_user_id
             ORDER BY log.occurred_at DESC, log.id DESC LIMIT $1`, [boundedLimit]
        );
        return { items: result.rows };
    });

    server.get('/api/v1/admin/security/sessions', async (request, reply) => {
        const session = await requireMfaSession(request, reply, pool, false);
        if (!session) return;
        const cookie = readCookie(request.headers.cookie, 'impacta_session');
        const currentHash = cookie && /^[a-f0-9]{64}$/i.test(cookie)
            ? createHash('sha256').update(cookie).digest('hex')
            : '';
        const result = await pool.query(
            `SELECT id::text AS id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
                    user_agent, ip_address::text AS ip_address, token_hash = $2 AS is_current
             FROM impacta.auth_sessions WHERE user_id = $1 AND revoked_at IS NULL
             ORDER BY last_seen_at DESC LIMIT 50`, [session.userId, currentHash]
        );
        return { items: result.rows };
    });

    server.get('/api/v1/admin/security/registration-signals', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'audit.read')) return;
        const result = await pool.query(
            `SELECT network(set_masklen(ip_address, CASE WHEN family(ip_address) = 4 THEN 24 ELSE 56 END))::text AS network_prefix,
                    count(*)::int AS attempts, max(occurred_at) AS last_seen
             FROM impacta.auth_events
             WHERE event_type = 'registration_honeypot'
               AND occurred_at > now() - interval '30 days'
               AND ip_address IS NOT NULL
             GROUP BY network(set_masklen(ip_address, CASE WHEN family(ip_address) = 4 THEN 24 ELSE 56 END))
             ORDER BY max(occurred_at) DESC
             LIMIT 100`
        );
        return { items: result.rows, windowDays: 30 };
    });

    server.post<{ Params: { sessionId: string } }>('/api/v1/admin/security/sessions/:sessionId/revoke', async (request, reply) => {
        const session = await requireMfaSession(request, reply, pool, true);
        if (!session) return;
        const { sessionId } = request.params;
        const cookie = readCookie(request.headers.cookie, 'impacta_session');
        const currentHash = cookie && /^[a-f0-9]{64}$/i.test(cookie)
            ? createHash('sha256').update(cookie).digest('hex')
            : '';
        if (!validId(sessionId)) return reply.code(400).send({ error: 'invalid_session' });
        const result = await pool.query(
            `UPDATE impacta.auth_sessions SET revoked_at = now()
             WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND token_hash <> $3
             RETURNING id`, [sessionId, session.userId, currentHash]
        );
        if (!result.rowCount) return reply.code(404).send({ error: 'session_unavailable' });
        await pool.query(
            `INSERT INTO impacta.admin_audit_log (actor_user_id, action_code, target_type, target_id)
             VALUES ($1, 'session.revoke', 'session', $2)`, [session.userId, sessionId]
        );
        return { status: 'revoked' };
    });

    server.get('/api/v1/site/announcement', async () => {
        const [settings, announcements] = await Promise.all([
            pool.query<{ key: string; text_value: string }>(
                `SELECT key, value #>> '{}' AS text_value
                 FROM impacta.platform_settings
                 WHERE key IN ('homepage.notice', 'homepage.notice.image')`
            ),
            pool.query(
                `SELECT announcement.id::text AS id, announcement.placement AS kind,
                        announcement.title, announcement.body, announcement.target_url,
                        CASE WHEN media.id IS NOT NULL THEN '/api/v1/media/' || media.id::text END AS image_url
                 FROM impacta.announcements AS announcement
                 LEFT JOIN impacta.media AS media
                   ON media.id = announcement.image_media_id AND media.status = 'available'
                 WHERE announcement.status IN ('published', 'scheduled')
                   AND (announcement.publish_at IS NULL OR announcement.publish_at <= now())
                   AND (announcement.expires_at IS NULL OR announcement.expires_at > now())
                   AND announcement.audience->>'type' = 'all'
                 ORDER BY announcement.publish_at DESC NULLS LAST, announcement.created_at DESC
                 LIMIT 20`
            )
        ]);
        const settingValues = new Map(settings.rows.map((row) => [row.key, row.text_value]));
        const message = settingValues.get('homepage.notice')?.trim() ?? '';
        const rawImageId = settingValues.get('homepage.notice.image') ?? '';
        const imageId = /^[1-9]\d{0,18}$/.test(rawImageId) ? rawImageId : '';
        const image = imageId
            ? await pool.query<{ id: string }>(
                `SELECT id::text AS id FROM impacta.media
                 WHERE id = $1 AND status = 'available' AND media_type = 'image'`, [imageId]
            )
            : { rows: [] as Array<{ id: string }> };
        const items = announcements.rows.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            body: item.body,
            imageUrl: item.image_url,
            targetUrl: item.target_url
        }));
        if (message) {
            items.unshift({
                id: 'homepage-notice',
                kind: 'notice',
                title: 'Aviso da plataforma',
                body: message,
                imageUrl: image.rows[0] ? `/api/v1/media/${encodeURIComponent(image.rows[0].id)}` : null,
                targetUrl: null
            });
        }
        return {
            message,
            imageUrl: image.rows[0] ? `/api/v1/media/${encodeURIComponent(image.rows[0].id)}` : null,
            items
        };
    });

    server.get('/api/v1/admin/settings/maintenance', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'settings.manage')) return;
        const result = await pool.query<{ key: string; text_value: string }>(
            `SELECT key, value #>> '{}' AS text_value
             FROM impacta.platform_settings
             WHERE key IN ('maintenance.enabled', 'maintenance.message')`
        );
        const settings = new Map(result.rows.map((row) => [row.key, row.text_value]));
        return {
            enabled: ['true', '1', 'yes'].includes((settings.get('maintenance.enabled') ?? '').toLowerCase()),
            message: settings.get('maintenance.message') ?? ''
        };
    });

    server.put<{ Body: { enabled?: unknown; message?: unknown } }>('/api/v1/admin/settings/maintenance', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'settings.manage', true);
        if (!session) return;
        const enabled = request.body?.enabled;
        const message = cleanOptionalText(request.body?.message, 300);
        if (typeof enabled !== 'boolean' || message === undefined) {
            return reply.code(400).send({ error: 'invalid_maintenance_settings' });
        }
        await transaction(pool, async (client) => {
            await client.query(
                `INSERT INTO impacta.platform_settings (key, value, description, updated_by_user_id)
                 VALUES ('maintenance.enabled', to_jsonb($1::boolean), 'Controla o acesso público durante manutenção.', $2),
                        ('maintenance.message', to_jsonb($3::text), 'Mensagem apresentada durante manutenção.', $2)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
                     description = EXCLUDED.description, updated_by_user_id = EXCLUDED.updated_by_user_id,
                     updated_at = now()`,
                [enabled, session.userId, message]
            );
            await audit(client, session.userId, 'settings.maintenance.update', 'platform_setting', 'maintenance.enabled',
                enabled ? 'Modo de manutenção activado.' : 'Modo de manutenção desactivado.');
        });
        return { enabled, message };
    });

    server.post<{ Body: { reason?: unknown } }>('/api/v1/admin/backups/export', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'settings.manage', true);
        if (!session) return;
        const reason = cleanText(request.body?.reason, 240);
        if (!reason || Array.from(reason).length < 5) {
            return reply.code(400).send({ error: 'backup_reason_required' });
        }
        let backup: DatabaseBackupFile | undefined;
        try {
            const createdBackup = await createDatabaseBackup();
            backup = createdBackup;
            await transaction(pool, (client) => audit(
                client, session.userId, 'backup.export', 'database_backup', createdBackup.filename, reason
            ));
        } catch (error) {
            if (backup) await rm(backup.directory, { recursive: true, force: true }).catch(() => undefined);
            request.log.error({ event: 'admin_backup_failed' }, 'Administrator database backup failed');
            return reply.code(503).send({ error: 'backup_unavailable' });
        }
        if (!backup) return reply.code(503).send({ error: 'backup_unavailable' });
        const stream = createReadStream(backup.filePath);
        stream.once('close', () => { void rm(backup.directory, { recursive: true, force: true }); });
        reply.header('content-type', 'application/octet-stream');
        reply.header('content-disposition', `attachment; filename="${backup.filename}"`);
        reply.header('cache-control', 'no-store');
        return reply.send(stream);
    });

    server.get('/api/v1/admin/settings/homepage-notice', async (request, reply) => {
        if (!await adminSession(request, reply, pool, 'settings.manage')) return;
        const result = await pool.query<{ key: string; text_value: string }>(
            `SELECT key, value #>> '{}' AS text_value
             FROM impacta.platform_settings
             WHERE key IN ('homepage.notice', 'homepage.notice.image')`
        );
        const settings = new Map(result.rows.map((row) => [row.key, row.text_value]));
        const message = settings.get('homepage.notice') ?? '';
        const rawImageId = settings.get('homepage.notice.image') ?? '';
        const imageId = /^[1-9]\d{0,18}$/.test(rawImageId) ? rawImageId : '';
        const image = imageId
            ? await pool.query<{ id: string }>(
                `SELECT id::text AS id FROM impacta.media
                 WHERE id = $1 AND status = 'available' AND media_type = 'image'`, [imageId]
            )
            : { rows: [] as Array<{ id: string }> };
        return {
            message,
            imageId: image.rows[0]?.id ?? '',
            imageUrl: image.rows[0] ? `/api/v1/media/${encodeURIComponent(image.rows[0].id)}` : null
        };
    });

    server.put<{ Body: { message?: string; imageId?: string | null } }>('/api/v1/admin/settings/homepage-notice', async (request, reply) => {
        const session = await adminSession(request, reply, pool, 'settings.manage', true);
        if (!session) return;
        if (typeof request.body?.message !== 'string' || Array.from(request.body.message).length > 240
            || request.body.message.includes('\u0000')) {
            return reply.code(400).send({ error: 'invalid_homepage_notice' });
        }
        const rawImageId = request.body?.imageId;
        const imageId = rawImageId === undefined || rawImageId === null || rawImageId === ''
            ? null : typeof rawImageId === 'string' && validId(rawImageId) ? rawImageId : undefined;
        if (imageId === undefined) return reply.code(400).send({ error: 'invalid_promotion_image' });
        const message = request.body.message.trim();
        const imageAvailable = await transaction(pool, async (client) => {
            if (message && !await validatePromotionImage(client, imageId, session.userId)) return false;
            if (!message) {
                await client.query(
                    `INSERT INTO impacta.platform_settings (key, value, description, updated_by_user_id)
                     VALUES ('homepage.notice', to_jsonb(''::text), 'Aviso público no topo da página inicial.', $1),
                            ('homepage.notice.image', to_jsonb(''::text), 'Imagem do aviso público.', $1)
                     ON CONFLICT (key) DO UPDATE SET value = to_jsonb(''::text), updated_by_user_id = $1,
                         updated_at = now()`, [session.userId]
                );
            } else {
                await client.query(
                    `INSERT INTO impacta.platform_settings (key, value, description, updated_by_user_id)
                     VALUES ('homepage.notice', to_jsonb($1::text), 'Aviso público no topo da página inicial.', $2)
                     ON CONFLICT (key) DO UPDATE SET value = to_jsonb($1::text),
                         description = 'Aviso público no topo da página inicial.', updated_by_user_id = $2,
                         updated_at = now()`, [message, session.userId]
                );
                if (imageId) {
                    await client.query(
                        `INSERT INTO impacta.platform_settings (key, value, description, updated_by_user_id)
                         VALUES ('homepage.notice.image', to_jsonb($1::text), 'Imagem do aviso público.', $2)
                         ON CONFLICT (key) DO UPDATE SET value = to_jsonb($1::text),
                             description = 'Imagem do aviso público.', updated_by_user_id = $2, updated_at = now()`,
                        [imageId, session.userId]
                    );
                } else {
                    await client.query(
                        `INSERT INTO impacta.platform_settings (key, value, description, updated_by_user_id)
                         VALUES ('homepage.notice.image', to_jsonb(''::text), 'Imagem do aviso público.', $1)
                         ON CONFLICT (key) DO UPDATE SET value = to_jsonb(''::text), updated_by_user_id = $1,
                             updated_at = now()`, [session.userId]
                    );
                }
            }
            await audit(client, session.userId, 'settings.homepage_notice.update', 'platform_setting', 'homepage.notice', message || 'Aviso removido');
            return true;
        });
        if (!imageAvailable) return reply.code(400).send({ error: 'promotion_image_unavailable' });
        return { message, imageId: imageId ?? '' };
    });
}

import 'dotenv/config';

import Fastify, { type FastifyReply, type FastifyRequest, type FastifySchema } from 'fastify';
import { Pool, type PoolConfig } from 'pg';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { registerAdminRoutes } from './admin-routes.js';
import { registerAdminConsoleRoutes } from './admin-console-routes.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerCommunityRoutes, requireMfaSession } from './community-routes.js';
import { registerDirectMessageRoutes } from './direct-message-routes.js';
import { registerHelpRoutes } from './help-routes.js';
import { registerImpactationRoutes } from './impactation-routes.js';
import { registerProfileRoutes } from './profile-routes.js';
import { registerProjectMessageRoutes } from './project-message-routes.js';
import { mfaEncryptionKey } from './mfa.js';

type EnvironmentName = 'development' | 'production';

interface RuntimeConfig {
    environment: EnvironmentName;
    host: string;
    port: number;
    frontendOrigins: string[];
    frontendBaseUrl: string;
    postgres: PoolConfig;
}

function requiredEnvironmentValue(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.length === 0) {
        throw new Error('Missing required environment variable: ' + name);
    }

    return value;
}

function parsePort(name: string, fallback: number): number {
    const raw = process.env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error('Invalid port in ' + name);

    const port = Number(raw);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error('Invalid port in ' + name);
    }

    return port;
}

function parsePoolMax(environment: EnvironmentName): number {
    const configured = process.env.PGPOOL_MAX;
    if (environment === 'production' && !configured) {
        throw new Error('PGPOOL_MAX must be set explicitly in production after database capacity planning');
    }
    const raw = configured ?? '5';
    if (!/^\d+$/.test(raw)) throw new Error('PGPOOL_MAX must be an integer from 1 to 50');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
        throw new Error('PGPOOL_MAX must be an integer from 1 to 50');
    }
    return value;
}

function loadRuntimeConfig(): RuntimeConfig {
    const environment = process.env.APP_ENV;
    if (environment !== 'development' && environment !== 'production') {
        throw new Error('APP_ENV must be explicitly set to development or production');
    }
    if (environment === 'production') {
        const pepper = process.env.AUTH_TOKEN_PEPPER;
        if (!pepper || Buffer.byteLength(pepper, 'utf8') < 32) {
            throw new Error('AUTH_TOKEN_PEPPER must contain at least 32 bytes in production');
        }
        const requiredSmtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'];
        const missingSmtp = requiredSmtp.filter((name) => !process.env[name]?.trim());
        if (missingSmtp.length > 0) {
            throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM_EMAIL are required in production');
        }
        const smtpPort = process.env.SMTP_PORT ?? '';
        if (!/^\d+$/.test(smtpPort) || Number(smtpPort) < 1 || Number(smtpPort) > 65535) {
            throw new Error('SMTP_PORT must be an integer from 1 to 65535 in production');
        }
    }
    if (environment === 'production' && !mfaEncryptionKey()) {
        throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key in production');
    }
    if (environment === 'production') {
        const configuredMediaDirectory = process.env.IMPACTA_MEDIA_DIR?.trim();
        if (!configuredMediaDirectory || !isAbsolute(configuredMediaDirectory)) {
            throw new Error('IMPACTA_MEDIA_DIR must be an absolute path outside the application directory in production');
        }
        const projectRoot = resolve(__dirname, '../..');
        const relativeMediaPath = relative(projectRoot, resolve(configuredMediaDirectory));
        if (relativeMediaPath === '' || relativeMediaPath === '..'
            || (!isAbsolute(relativeMediaPath) && !relativeMediaPath.startsWith(`..${sep}`))) {
            throw new Error('IMPACTA_MEDIA_DIR must be outside the application directory in production');
        }
    }
    const poolMax = parsePoolMax(environment);

    const sslValue = (process.env.PGSSL ?? 'false').toLowerCase();
    if (sslValue !== 'true' && sslValue !== 'false') {
        throw new Error('PGSSL must be true or false');
    }

    const sslEnabled = sslValue === 'true';
    if (environment === 'production' && !sslEnabled) {
        throw new Error('PGSSL=true is required when APP_ENV=production');
    }

    let ssl: PoolConfig['ssl'] = false;
    if (sslEnabled) {
        const caPath = process.env.PGSSL_CA;
        if (caPath) {
            try {
                ssl = { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') };
            } catch {
                throw new Error('Unable to read the certificate configured in PGSSL_CA');
            }
        } else {
            ssl = { rejectUnauthorized: true };
        }
    }

    const configuredOrigins = process.env.FRONTEND_ORIGINS;
    if (environment === 'production' && !configuredOrigins) {
        throw new Error('FRONTEND_ORIGINS is required when APP_ENV=production');
    }
    const frontendOrigins = (configuredOrigins ?? 'http://localhost,http://127.0.0.1,http://localhost:3001,http://127.0.0.1:3001')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    if (frontendOrigins.some((origin) => {
        try {
            const parsed = new URL(origin);
            return parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol);
        } catch {
            return true;
        }
    })) {
        throw new Error('FRONTEND_ORIGINS must contain exact HTTP or HTTPS origins');
    }

    const configuredFrontendBase = process.env.FRONTEND_BASE_URL
        ?? (environment === 'development' ? 'http://localhost/Impacta' : undefined);
    if (!configuredFrontendBase) {
        throw new Error('FRONTEND_BASE_URL is required in production');
    }
    let frontendBase: URL;
    try {
        frontendBase = new URL(configuredFrontendBase);
    } catch {
        throw new Error('FRONTEND_BASE_URL must be an absolute HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(frontendBase.protocol)
        || frontendBase.username || frontendBase.password || frontendBase.search || frontendBase.hash
        || !frontendOrigins.includes(frontendBase.origin)
        || (environment === 'production' && frontendBase.protocol !== 'https:')) {
        throw new Error('FRONTEND_BASE_URL must be a path on an allowed frontend origin');
    }
    const frontendBaseUrl = frontendBase.origin + frontendBase.pathname.replace(/\/+$/, '');
    const configuredApiHost = (process.env.API_HOST || '127.0.0.1').trim().toLowerCase();
    const apiHost = ['::1', 'localhost'].includes(configuredApiHost) ? '127.0.0.1' : configuredApiHost;
    if (environment === 'production' && apiHost !== '127.0.0.1') {
        throw new Error('API_HOST must be 127.0.0.1 in production; expose the API only through the HTTPS reverse proxy');
    }

    return {
        environment,
        host: apiHost,
        port: parsePort('API_PORT', 3001),
        frontendOrigins,
        frontendBaseUrl,
        postgres: {
            host: requiredEnvironmentValue('PGHOST'),
            port: parsePort('PGPORT', 5432),
            database: requiredEnvironmentValue('PGDATABASE'),
            user: requiredEnvironmentValue('PGUSER'),
            password: requiredEnvironmentValue('PGPASSWORD'),
            ssl,
            application_name: 'impacta-api',
            max: poolMax,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: 5000,
            query_timeout: 6000,
            keepAlive: true
        }
    };
}

const config = loadRuntimeConfig();
const pool = new Pool(config.postgres);
const server = Fastify({
    trustProxy: config.environment === 'production' ? ['127.0.0.1', '::1'] : false,
    bodyLimit: 16384,
    connectionTimeout: 10000,
    logger: {
        level: config.environment === 'production' ? 'info' : 'warn',
        redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-csrf-token',
            'res.headers.set-cookie'
        ],
        serializers: {
            req(request) {
                return {
                    method: request.method,
                    url: request.url.split('?')[0]
                };
            },
            res(reply) {
                return { statusCode: reply.statusCode };
            }
        }
    }
});

server.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    { parseAs: 'buffer', bodyLimit: 12 * 1024 * 1024 },
    (_request, body, done) => done(null, body)
);
server.addContentTypeParser(
    ['video/mp4', 'video/quicktime'],
    { parseAs: 'buffer', bodyLimit: 100 * 1024 * 1024 },
    (_request, body, done) => done(null, body)
);

const liveResponseSchema = {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['ok'] } },
    additionalProperties: false
} as const;

const readyResponseSchema = {
    type: 'object',
    required: ['status'],
    properties: {
        status: { type: 'string', enum: ['ready', 'not_ready'] },
        message: { type: 'string' }
    },
    additionalProperties: false
} as const;

const liveRouteSchema: FastifySchema = { response: { 200: liveResponseSchema } };
const readyRouteSchema: FastifySchema = {
    response: { 200: readyResponseSchema, 503: readyResponseSchema }
};

const requiredRelations = [
    'users',
    'user_profiles',
    'profile_documents',
    'media',
    'roles',
    'permissions',
    'role_permissions',
    'user_roles',
    'auth_sessions',
    'auth_tokens',
    'auth_events',
    'mfa_credentials',
    'mfa_recovery_codes',
    'mfa_challenges',
    'account_verification_requests',
    'announcement_metric_events',
    'admin_audit_log',
    'impact_areas',
    'communities',
    'community_members',
    'community_messages',
    'community_message_reads',
    'community_reports',
    'projects',
    'project_members',
    'project_messages',
    'project_message_reads',
    'project_message_preferences',
    'direct_message_requests',
    'direct_conversations',
    'direct_messages',
    'direct_conversation_members',
    'direct_message_blocks',
    'direct_message_preferences',
    'challenges',
    'challenge_participations',
    'challenge_participation_media',
    'challenge_weekly_highlights',
    'post_categories',
    'posts',
    'post_media',
    'comments',
    'reactions',
    'notifications',
    'post_shares',
    'content_mentions',
    'impactation_requests',
    'content_reports',
    'moderation_actions'
];

const MAINTENANCE_CACHE_MS = 1500;
let maintenanceStatusCache: { enabled: boolean; message: string; checkedAt: number } | null = null;

async function getMaintenanceStatus(): Promise<{ enabled: boolean; message: string }> {
    const now = Date.now();
    if (maintenanceStatusCache && now - maintenanceStatusCache.checkedAt < MAINTENANCE_CACHE_MS) {
        return { enabled: maintenanceStatusCache.enabled, message: maintenanceStatusCache.message };
    }
    const result = await pool.query<{ key: string; text_value: string }>(
        `SELECT key, value #>> '{}' AS text_value
         FROM impacta.platform_settings
         WHERE key IN ('maintenance.enabled', 'maintenance.message')`
    );
    const settings = new Map(result.rows.map((row) => [row.key, row.text_value]));
    maintenanceStatusCache = {
        enabled: ['true', '1', 'yes'].includes((settings.get('maintenance.enabled') ?? '').toLowerCase()),
        message: settings.get('maintenance.message') ?? '',
        checkedAt: now
    };
    return { enabled: maintenanceStatusCache.enabled, message: maintenanceStatusCache.message };
}

async function hasPlatformAdminSession(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const session = await requireMfaSession(request, reply, pool, request.method !== 'GET');
    if (!session) return false;
    const result = await pool.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1 FROM impacta.user_roles AS assignment
             JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = assignment.role_id
             JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
             WHERE assignment.user_id = $1 AND assignment.scope_type = 'platform'
               AND assignment.scope_id IS NULL
         ) AS allowed`,
        [session.userId]
    );
    return result.rows[0]?.allowed === true;
}

server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS') {
        if (!origin || !config.frontendOrigins.includes(origin)) {
            return reply.code(403).send({ error: 'origin_not_allowed' });
        }
        return reply
            .header('access-control-allow-origin', origin)
            .header('access-control-allow-credentials', 'true')
            .header('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
            .header('access-control-allow-headers', 'content-type, x-csrf-token, x-direct-message-caption')
            .header('access-control-max-age', '600')
            .header('vary', 'Origin')
            .code(204)
            .send();
    }
    if (origin) {
        if (!config.frontendOrigins.includes(origin)) {
            return reply.code(403).send({ error: 'origin_not_allowed' });
        }
        reply
            .header('access-control-allow-origin', origin)
            .header('access-control-allow-credentials', 'true')
            .header('access-control-expose-headers', 'accept-ranges, content-range, content-length')
            .header('vary', 'Origin');
    }

    const pathname = request.url.split('?')[0];
    const isPublicStatus = pathname === '/api/v1/site/status';
    const isHealthCheck = pathname === '/api/v1/health/live' || pathname === '/api/v1/health/ready';
    const isAuthenticationFlow = /^\/api\/v1\/auth\/(?:login|session|mfa(?:\/.*)?)$/.test(pathname);
    if (!pathname.startsWith('/api/v1/') || isPublicStatus || isHealthCheck || isAuthenticationFlow) return;

    let maintenance: { enabled: boolean; message: string };
    try {
        maintenance = await getMaintenanceStatus();
    } catch (error) {
        request.log.error({ event: 'maintenance_status_read_failed' }, 'Unable to read maintenance mode');
        if (!maintenanceStatusCache) return;
        maintenance = { enabled: maintenanceStatusCache.enabled, message: maintenanceStatusCache.message };
    }
    if (!maintenance.enabled) return;

    if (pathname.startsWith('/api/v1/admin/')) {
        try {
            const isPlatformAdmin = await hasPlatformAdminSession(request, reply);
            if (reply.sent) return;
            if (isPlatformAdmin) return;
        } catch (error) {
            request.log.error({ event: 'maintenance_admin_check_failed' }, 'Unable to verify administrator access during maintenance');
            return reply.code(503).send({ error: 'service_unavailable' });
        }
    }

    return reply.code(503).send({
        error: 'maintenance_mode',
        message: maintenance.message || 'A IMPACTA está em manutenção. A área administrativa continua disponível.'
    });
});

server.addHook('onSend', async (_request, reply, payload) => {
    reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('x-frame-options', 'DENY')
        .header('referrer-policy', 'no-referrer')
        .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    return payload;
});

server.get('/api/v1/site/status', async () => {
    const maintenance = await getMaintenanceStatus();
    return {
        maintenance: maintenance.enabled,
        message: maintenance.enabled ? maintenance.message : ''
    };
});
server.get('/api/v1/health/live', { schema: liveRouteSchema }, async () => ({ status: 'ok' }));

server.get('/api/v1/health/ready', { schema: readyRouteSchema }, async (request, reply) => {
    try {
        await pool.query('SELECT 1');
        const result = await pool.query<{ relation_count: number }>(
            'SELECT count(*)::int AS relation_count ' +
            'FROM pg_catalog.pg_class AS relation ' +
            'JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace ' +
            'WHERE namespace.nspname = $1 ' +
            'AND relation.relname = ANY($2::text[]) ' +
            "AND relation.relkind IN ('r', 'p')",
            ['impacta', requiredRelations]
        );

        if (result.rows[0]?.relation_count !== requiredRelations.length) {
            request.log.warn({ event: 'impacta_schema_incomplete' }, 'Database schema is not ready');
            return reply.code(503).send({
                status: 'not_ready',
                message: 'Database connected; IMPACTA schema is incomplete.'
            });
        }

        for (const query of [
            'SELECT id, email, password_hash, display_name, status, email_verified_at, mfa_required FROM impacta.users LIMIT 0',
            'SELECT user_id, encrypted_totp_secret, verified_at, last_used_step FROM impacta.mfa_credentials LIMIT 0',
            'SELECT id, user_id, code_hash, used_at FROM impacta.mfa_recovery_codes LIMIT 0',
            'SELECT id, user_id, token_hash, purpose, encrypted_totp_secret, failed_attempts, expires_at, consumed_at FROM impacta.mfa_challenges LIMIT 0',
            'SELECT mfa_verified_at FROM impacta.auth_sessions LIMIT 0',
            'SELECT id, user_id, token_hash, purpose, created_at, expires_at, consumed_at FROM impacta.auth_tokens LIMIT 0',
            'SELECT id, user_id, status, category, evidence_url, request_note, reviewed_by_user_id, review_reason, proof_code, proof_expires_at, proof_confirmed_by_user_id, proof_confirmed_at FROM impacta.account_verification_requests LIMIT 0',
            'SELECT user_id, event_type, occurred_at, ip_address FROM impacta.auth_events LIMIT 0',
            'SELECT id, title, advertiser_name, advertiser_email FROM impacta.announcements LIMIT 0',
            'SELECT id, announcement_id, event_type, visitor_hash, event_day, occurred_at FROM impacta.announcement_metric_events LIMIT 0',
            'SELECT id, code FROM impacta.roles LIMIT 0',
            'SELECT id, code FROM impacta.permissions LIMIT 0',
            'SELECT role_id, permission_id FROM impacta.role_permissions LIMIT 0',
            'SELECT user_id, role_id, scope_type, scope_id FROM impacta.user_roles LIMIT 0',
            'SELECT user_id FROM impacta.user_profiles LIMIT 0',
            'SELECT user_id, headline, bio, location, occupation, organization, website_url, skills, impact_area_id, custom_impact_area, is_public, avatar_media_id, cover_media_id FROM impacta.user_profiles LIMIT 0',
            'SELECT user_id, document_type, storage_key, byte_size, updated_at FROM impacta.profile_documents LIMIT 0',
            'SELECT id, owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status FROM impacta.media LIMIT 0',
            'SELECT code, name, description, sort_order, is_active FROM impacta.post_categories LIMIT 0',
            'SELECT post_id, media_id, position FROM impacta.post_media LIMIT 0',
            'SELECT category_code, custom_category, updated_at FROM impacta.posts LIMIT 0',
            'SELECT user_id, token_hash, csrf_token_hash, revoked_at, idle_expires_at, absolute_expires_at FROM impacta.auth_sessions LIMIT 0',
            'SELECT last_seen_at FROM impacta.auth_sessions LIMIT 0',
            'SELECT slug, description, impact_area_id FROM impacta.communities LIMIT 0',
            'SELECT location_province, location_municipality, location_commune, location_neighborhood, location_city FROM impacta.communities LIMIT 0',
            'SELECT id, reporter_user_id, community_id, message_id, reason_code, details, status, assigned_to_user_id, reviewed_by_user_id, decision_reason, created_at, resolved_at FROM impacta.community_reports LIMIT 0',
            'SELECT chat_locked_until FROM impacta.communities LIMIT 0',
            'SELECT community_id, user_id, status, joined_at FROM impacta.community_members LIMIT 0',
            'SELECT id, community_id, author_user_id, body, media_id, created_at, edited_at, edited_by_user_id, deleted_at, deleted_by_user_id, moderation_status FROM impacta.community_messages LIMIT 0',
            'SELECT community_id, user_id, last_read_message_id, updated_at FROM impacta.community_message_reads LIMIT 0',
            'SELECT id, body, created_at, updated_at, author_user_id, post_id, status, deleted_at FROM impacta.comments LIMIT 0',
            'SELECT id, user_id, notification_type, payload, created_at, read_at FROM impacta.notifications LIMIT 0',
            'SELECT actor_user_id, mentioned_user_id, post_id, comment_id, created_at FROM impacta.content_mentions LIMIT 0',
            'SELECT id, requester_user_id, recipient_user_id, status, created_at, responded_at FROM impacta.impactation_requests LIMIT 0',
            'SELECT post_id, sharer_user_id, shared_at FROM impacta.post_shares LIMIT 0',
            'SELECT id, body, author_user_id, created_at, status, deleted_at, moderation_status FROM impacta.posts LIMIT 0',
            'SELECT id, reporter_user_id, post_id, comment_id, reason_code, details, status, created_at FROM impacta.content_reports LIMIT 0',
            'SELECT id, challenge_id, user_id, submission, status, submitted_at, reviewed_by_user_id, reviewed_at, review_reason, delivery_submission, delivery_submitted_at, completed_at FROM impacta.challenge_participations LIMIT 0',
            'SELECT participation_id, media_id, stage, uploader_user_id, created_at FROM impacta.challenge_participation_media LIMIT 0',
            'SELECT week_start, challenge_id, assigned_at FROM impacta.challenge_weekly_highlights LIMIT 0',
            'SELECT user_id, membership_role FROM impacta.project_members LIMIT 0',
            'SELECT id, project_id, author_user_id, body, created_at, edited_at, edited_by_user_id, deleted_at, deleted_by_user_id FROM impacta.project_messages LIMIT 0',
            'SELECT project_id, user_id, last_read_message_id, updated_at FROM impacta.project_message_reads LIMIT 0',
            'SELECT project_id, user_id, muted, updated_at FROM impacta.project_message_preferences LIMIT 0',
            'SELECT direct_message_id, direct_message_request_id FROM impacta.content_reports LIMIT 0',
            'SELECT id, requester_user_id, recipient_user_id, body, status, created_at, responded_at FROM impacta.direct_message_requests LIMIT 0',
            'SELECT id, user_a_id, user_b_id, created_at FROM impacta.direct_conversations LIMIT 0',
            'SELECT id, conversation_id, author_user_id, body, media_id, created_at, edited_at, deleted_at, deleted_by_user_id FROM impacta.direct_messages LIMIT 0',
            'SELECT conversation_id, user_id, last_read_message_id, archived_at, muted, updated_at FROM impacta.direct_conversation_members LIMIT 0',
            'SELECT blocker_user_id, blocked_user_id, created_at FROM impacta.direct_message_blocks LIMIT 0',
            'SELECT user_id, request_policy, updated_at FROM impacta.direct_message_preferences LIMIT 0',
            'SELECT project_id FROM impacta.posts LIMIT 0',
            'SELECT location_city, location_neighborhood, location_municipality, location_province, location_commune, reviewed_at, reviewed_by_user_id, review_reason FROM impacta.projects LIMIT 0'
        ]) {
            await pool.query(query);
        }

        const emailIndex = await pool.query<{ present: boolean }>(
            `SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_indexes
                WHERE schemaname = 'impacta' AND indexname = 'users_email_lower_unique'
                  AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            ) AS present`
        );
        if (emailIndex.rows[0]?.present !== true) {
            request.log.warn({ event: 'normalized_email_unique_index_missing' }, 'Normalized email uniqueness is not enforced by the database');
            return reply.code(503).send({ status: 'not_ready', message: 'Database email uniqueness constraint is missing.' });
        }

        const writePrivileges = await pool.query<{ ready: boolean }>(
            `SELECT
                has_column_privilege(current_user, 'impacta.mfa_credentials', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_credentials', 'encrypted_totp_secret', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_credentials', 'encrypted_totp_secret', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.mfa_credentials', 'verified_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.mfa_credentials', 'last_used_step', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.mfa_recovery_codes', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_recovery_codes', 'code_hash', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_recovery_codes', 'code_hash', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.mfa_recovery_codes', 'used_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_recovery_codes', 'used_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'purpose', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'token_hash', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'token_hash', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'encrypted_totp_secret', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'expires_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'failed_attempts', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.mfa_challenges', 'consumed_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'mfa_verified_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'mfa_verified_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.users', 'mfa_required', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'event_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'occurred_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'ip_address', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'event_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'occurred_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'ip_address', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'token_hash', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'csrf_token_hash', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'idle_expires_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'absolute_expires_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'ip_address', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'user_agent', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'event_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'occurred_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'ip_address', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'event_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'occurred_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_events', 'ip_address', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'author_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'body', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.posts', 'deleted_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.comments', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.comments', 'author_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.comments', 'body', 'INSERT')
                AND has_table_privilege(current_user, 'impacta.reactions', 'DELETE')
                AND has_column_privilege(current_user, 'impacta.reactions', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.reactions', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.reactions', 'reaction_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.challenge_participations', 'challenge_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.challenge_participations', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.challenge_participations', 'submission', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'project_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'membership_role', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'project_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.project_members', 'membership_role', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_city', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_neighborhood', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_municipality', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_province', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_commune', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_city', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_neighborhood', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_municipality', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_province', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.projects', 'location_commune', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.projects', 'reviewed_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'reviewed_by_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'review_reason', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.projects', 'reviewed_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.projects', 'reviewed_by_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.projects', 'review_reason', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_members', 'community_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_members', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_members', 'status', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_members', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_members', 'joined_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_members', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_members', 'joined_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_province', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_municipality', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_commune', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_neighborhood', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_city', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_province', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_municipality', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_commune', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_neighborhood', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.communities', 'location_city', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.communities', 'chat_locked_until', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.communities', 'chat_locked_until', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'community_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'author_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'body', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'media_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'media_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'edited_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'edited_by_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'deleted_by_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'body', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'edited_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'edited_by_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'deleted_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'deleted_by_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'moderation_status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'moderation_status', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_messages', 'moderation_status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'community_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'last_read_message_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'updated_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'community_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'last_read_message_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'updated_at', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'last_read_message_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_message_reads', 'updated_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'reporter_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'community_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'message_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'reason_code', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'details', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'reporter_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'community_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'message_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'reason_code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'details', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'assigned_to_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'reviewed_by_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'decision_reason', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.community_reports', 'resolved_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'reporter_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'comment_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'reason_code', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'details', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'reporter_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'post_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'comment_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'reason_code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'details', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'resolved_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.content_reports', 'assigned_to_user_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.posts', 'body', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'author_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'deleted_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'moderation_status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'moderation_status', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'moderation_status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.comments', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.comments', 'deleted_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.users', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_roles', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_roles', 'role_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_roles', 'scope_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_roles', 'scope_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.role_permissions', 'role_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.role_permissions', 'permission_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.permissions', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.permissions', 'code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.roles', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.roles', 'code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.moderation_actions', 'actor_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.moderation_actions', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.moderation_actions', 'comment_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.moderation_actions', 'action_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.moderation_actions', 'reason', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'last_seen_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'idle_expires_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.auth_sessions', 'csrf_token_hash', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.users', 'display_name', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'headline', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'bio', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'custom_impact_area', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'custom_impact_area', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'avatar_media_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'cover_media_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'cover_media_id', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.media', 'owner_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'storage_key', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'media_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'mime_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'byte_size', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'checksum_sha256', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.media', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.media', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'category_code', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'category_code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'custom_category', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.posts', 'custom_category', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'custom_category', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.posts', 'updated_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.posts', 'body', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.posts', 'category_code', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.posts', 'updated_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.comments', 'updated_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.comments', 'body', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.comments', 'updated_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.post_categories', 'code', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_categories', 'name', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_categories', 'description', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_categories', 'sort_order', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_categories', 'is_active', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'media_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'position', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'post_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'media_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_media', 'position', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'notification_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'payload', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'read_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'notification_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'payload', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.notifications', 'read_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'is_public', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'cover_media_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.user_profiles', 'headline', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'actor_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'mentioned_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'post_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'comment_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'actor_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'mentioned_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.content_mentions', 'comment_id', 'INSERT')
                AND has_table_privilege(current_user, 'impacta.content_mentions', 'DELETE')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'requester_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'recipient_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'status', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'created_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'responded_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'requester_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'recipient_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'status', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'status', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.impactation_requests', 'responded_at', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.post_shares', 'post_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_shares', 'sharer_user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_shares', 'shared_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.post_shares', 'post_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.post_shares', 'sharer_user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'user_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'document_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'storage_key', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'byte_size', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'updated_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'user_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'document_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'storage_key', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'byte_size', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'storage_key', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'byte_size', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.profile_documents', 'updated_at', 'UPDATE')
                AND has_table_privilege(current_user, 'impacta.profile_documents', 'DELETE')
                AND has_table_privilege(current_user, 'impacta.account_verification_requests', 'SELECT')
                AND has_table_privilege(current_user, 'impacta.account_verification_requests', 'INSERT')
                AND has_table_privilege(current_user, 'impacta.account_verification_requests', 'UPDATE')
                AND has_column_privilege(current_user, 'impacta.announcements', 'advertiser_name', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcements', 'advertiser_email', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcements', 'advertiser_name', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.announcements', 'advertiser_email', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'announcement_id', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'event_type', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'visitor_hash', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'event_day', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'occurred_at', 'SELECT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'announcement_id', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'event_type', 'INSERT')
                AND has_column_privilege(current_user, 'impacta.announcement_metric_events', 'visitor_hash', 'INSERT')
                AND has_sequence_privilege(current_user, 'impacta.announcement_metric_events_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.posts_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.comments_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.challenge_participations_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.content_reports_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.auth_events_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.moderation_actions_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.media_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.notifications_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.impactation_requests_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.post_shares_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.community_messages_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.community_reports_id_seq', 'USAGE')
                AND has_sequence_privilege(current_user, 'impacta.account_verification_requests_id_seq', 'USAGE')
                AS ready`
        );
        if (!writePrivileges.rows[0]?.ready) {
            request.log.warn({ event: 'community_permissions_incomplete' }, 'Community write permissions are not ready');
            return reply.code(503).send({
                status: 'not_ready',
                message: 'Database is connected; community permissions are incomplete.'
            });
        }

        const recentFeatureSql = [
            "SELECT",
            "has_column_privilege(current_user, 'impacta.project_messages', 'id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'project_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'author_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'body', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'created_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'edited_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'edited_by_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'deleted_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'deleted_by_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'project_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'author_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'body', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'body', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'edited_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'edited_by_user_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'deleted_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_messages', 'deleted_by_user_id', 'UPDATE')",
            "AND has_sequence_privilege(current_user, 'impacta.project_messages_id_seq', 'USAGE')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'project_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'last_read_message_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'updated_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'project_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'last_read_message_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'updated_at', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'last_read_message_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_message_reads', 'updated_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'project_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'muted', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'updated_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'project_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'muted', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'updated_at', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'muted', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.project_message_preferences', 'updated_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'project_message_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'project_message_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_request_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_request_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.content_reports', 'direct_message_request_id', 'UPDATE')",
            "AS project_messages_ready,",
            "has_column_privilege(current_user, 'impacta.posts', 'project_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.posts', 'project_id', 'INSERT')",
            "AS project_updates_ready,",
            "has_column_privilege(current_user, 'impacta.challenge_participations', 'challenge_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'submission', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'status', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'submitted_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'reviewed_by_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'reviewed_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'review_reason', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'delivery_submission', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'delivery_submitted_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'completed_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'submission', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'status', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'submitted_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'reviewed_by_user_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'reviewed_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'review_reason', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'delivery_submission', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'delivery_submitted_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participations', 'completed_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'participation_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'media_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'stage', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'uploader_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'participation_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'media_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'stage', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_participation_media', 'uploader_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'week_start', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'challenge_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'assigned_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'week_start', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'challenge_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'challenge_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.challenge_weekly_highlights', 'assigned_at', 'UPDATE')",
            "AS challenge_review_ready,",
            "has_column_privilege(current_user, 'impacta.direct_message_requests', 'id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'requester_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'recipient_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'body', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'status', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'created_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'responded_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'requester_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'recipient_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'body', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'body', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'status', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_requests', 'responded_at', 'UPDATE')",
            "AND has_sequence_privilege(current_user, 'impacta.direct_message_requests_id_seq', 'USAGE')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversations', 'id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversations', 'user_a_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversations', 'user_b_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversations', 'user_a_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversations', 'user_b_id', 'INSERT')",
            "AND has_sequence_privilege(current_user, 'impacta.direct_conversations_id_seq', 'USAGE')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'conversation_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'author_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'body', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'media_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'created_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'edited_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'deleted_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'deleted_by_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'conversation_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'author_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'body', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'media_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'deleted_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_messages', 'deleted_by_user_id', 'UPDATE')",
            "AND has_sequence_privilege(current_user, 'impacta.direct_messages_id_seq', 'USAGE')",
            "AND has_column_privilege(current_user, 'impacta.media', 'id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'owner_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'storage_key', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'media_type', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'mime_type', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'byte_size', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'status', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'owner_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'storage_key', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'media_type', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'mime_type', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'byte_size', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'checksum_sha256', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.media', 'status', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'conversation_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'last_read_message_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'archived_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'muted', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'updated_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'conversation_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'last_read_message_id', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'archived_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'muted', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_conversation_members', 'updated_at', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_blocks', 'blocker_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_blocks', 'blocked_user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_blocks', 'created_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_blocks', 'blocker_user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_blocks', 'blocked_user_id', 'INSERT')",
            "AND has_table_privilege(current_user, 'impacta.direct_message_blocks', 'DELETE')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'user_id', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'request_policy', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'updated_at', 'SELECT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'user_id', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'request_policy', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'updated_at', 'INSERT')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'request_policy', 'UPDATE')",
            "AND has_column_privilege(current_user, 'impacta.direct_message_preferences', 'updated_at', 'UPDATE')",
            "AS direct_messages_ready"
        ].join(' ');
        const recentFeaturePrivileges = await pool.query<{
            project_messages_ready: boolean;
            project_updates_ready: boolean;
            challenge_review_ready: boolean;
            direct_messages_ready: boolean;
        }>(recentFeatureSql);
        if (!recentFeaturePrivileges.rows[0]?.project_messages_ready
            || !recentFeaturePrivileges.rows[0]?.project_updates_ready
            || !recentFeaturePrivileges.rows[0]?.challenge_review_ready
            || !recentFeaturePrivileges.rows[0]?.direct_messages_ready) {
            request.log.warn({ event: 'recent_feature_permissions_incomplete' }, 'Recent feature permissions are not ready');
            return reply.code(503).send({
                status: 'not_ready',
                message: 'Database is connected; recent feature tables or permissions are incomplete.'
            });
        }

        return { status: 'ready' };
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'unknown';
        request.log.error({ event: 'postgres_readiness_failed', code }, 'PostgreSQL readiness check failed');
        return reply.code(503).send({
            status: 'not_ready',
            message: code === '42501'
                ? 'Database is connected; application permissions are incomplete.'
                : 'PostgreSQL connection is unavailable.'
        });
    }
});

registerCommunityRoutes(server, pool);
registerProjectMessageRoutes(server, pool);
registerDirectMessageRoutes(server, pool);
registerAdminRoutes(server, pool);
registerAdminConsoleRoutes(server, pool);
registerProfileRoutes(server, pool);
registerImpactationRoutes(server, pool);
registerHelpRoutes(server);
registerAuthRoutes(server, pool, config.frontendBaseUrl);

server.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
});

server.setErrorHandler(async (error, request, reply) => {
    const requestError = error instanceof Error
        ? error as Error & {
            statusCode?: number;
            code?: string;
            schema?: string;
            table?: string;
            column?: string;
            constraint?: string;
        }
        : undefined;
    const candidateStatus = requestError?.statusCode;
    const statusCode = candidateStatus && candidateStatus >= 400 && candidateStatus < 500
        ? candidateStatus
        : 500;

    if (statusCode >= 500) {
        request.log.error(
            {
                event: 'request_failed',
                requestId: request.id,
                method: request.method,
                route: request.routeOptions.url,
                code: requestError?.code ?? 'unknown',
                schema: requestError?.schema,
                table: requestError?.table,
                column: requestError?.column,
                constraint: requestError?.constraint
            },
            'Request failed'
        );
    }

    return reply.code(statusCode).send({
        error: statusCode === 500 ? 'internal_server_error' : 'invalid_request',
        ...(statusCode === 500 ? { requestId: request.id } : {})
    });
});

pool.on('error', (error: Error & { code?: string }) => {
    server.log.error(
        { event: 'postgres_idle_connection_failed', code: error.code ?? 'unknown' },
        'Idle PostgreSQL connection failed'
    );
});

async function start(): Promise<void> {
    await server.listen({ host: config.host, port: config.port });
}

async function shutdown(signal: string): Promise<void> {
    server.log.info({ event: 'shutdown', signal }, 'Stopping IMPACTA API');
    await server.close();
    await pool.end();
}

void start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    server.log.fatal({ event: 'startup_failed', message }, 'IMPACTA API could not start');
    void pool.end();
    process.exitCode = 1;
});

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

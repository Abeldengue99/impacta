import 'dotenv/config';

import Fastify, { type FastifySchema } from 'fastify';
import { Pool, type PoolConfig } from 'pg';
import { readFileSync } from 'node:fs';
import { registerCommunityRoutes } from './community-routes.js';

type EnvironmentName = 'development' | 'production';

interface RuntimeConfig {
    environment: EnvironmentName;
    host: string;
    port: number;
    frontendOrigins: string[];
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

function loadRuntimeConfig(): RuntimeConfig {
    const environment = process.env.APP_ENV ?? 'development';
    if (environment !== 'development' && environment !== 'production') {
        throw new Error('APP_ENV must be development or production');
    }

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

    return {
        environment,
        host: process.env.API_HOST ?? '127.0.0.1',
        port: parsePort('API_PORT', 3001),
        frontendOrigins,
        postgres: {
            host: requiredEnvironmentValue('PGHOST'),
            port: parsePort('PGPORT', 5432),
            database: requiredEnvironmentValue('PGDATABASE'),
            user: requiredEnvironmentValue('PGUSER'),
            password: requiredEnvironmentValue('PGPASSWORD'),
            ssl,
            application_name: 'impacta-api',
            max: 5,
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
    trustProxy: false,
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
    'roles',
    'permissions',
    'role_permissions',
    'user_roles',
    'auth_sessions',
    'mfa_credentials',
    'admin_audit_log',
    'impact_areas',
    'communities',
    'projects',
    'project_members',
    'challenges',
    'challenge_participations',
    'posts',
    'comments',
    'reactions'
];

server.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    if (!config.frontendOrigins.includes(origin)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
    }

    reply
        .header('access-control-allow-origin', origin)
        .header('access-control-allow-credentials', 'true')
        .header('vary', 'Origin');
    if (request.method === 'OPTIONS') {
        return reply
            .header('access-control-allow-methods', 'GET, POST, OPTIONS')
            .header('access-control-allow-headers', 'content-type, x-csrf-token')
            .header('access-control-max-age', '600')
            .code(204)
            .send();
    }
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

        return { status: 'ready' };
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'unknown';
        request.log.error({ event: 'postgres_readiness_failed', code }, 'PostgreSQL readiness check failed');
        return reply.code(503).send({
            status: 'not_ready',
            message: 'PostgreSQL connection is unavailable.'
        });
    }
});

registerCommunityRoutes(server, pool);

server.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
});

server.setErrorHandler(async (error, request, reply) => {
    const requestError = error instanceof Error
        ? error as Error & { statusCode?: number; code?: string }
        : undefined;
    const candidateStatus = requestError?.statusCode;
    const statusCode = candidateStatus && candidateStatus >= 400 && candidateStatus < 500
        ? candidateStatus
        : 500;

    if (statusCode >= 500) {
        request.log.error(
            { event: 'request_failed', code: requestError?.code ?? 'unknown' },
            'Request failed'
        );
    }

    return reply.code(statusCode).send({
        error: statusCode === 500 ? 'internal_server_error' : 'invalid_request'
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

import {
    createHash,
    createHmac,
    randomBytes,
    randomInt,
    scrypt as scryptCallback,
    timingSafeEqual
} from 'node:crypto';
import type { FastifyInstance, FastifySchema } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { isEmailDeliveryConfigured, sendPasswordResetEmail, sendVerificationEmail } from './email.js';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const VERIFICATION_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 30;

interface RegisterBody {
    displayName: string;
    email: string;
}

interface ResendBody {
    email: string;
}

interface VerifyBody {
    email: string;
    code: string;
    displayName: string;
    password: string;
    passwordConfirmation: string;
}

interface LoginBody {
    email: string;
    password: string;
}

interface PasswordResetRequestBody {
    email: string;
}

interface PasswordResetConfirmBody {
    token: string;
    password: string;
    passwordConfirmation: string;
}

interface PasswordResetTokenRecord {
    user_id: string;
}

interface UserRecord {
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    status: string;
    email_verified_at: Date | null;
    mfa_required: boolean;
}

interface VerificationTokenRecord {
    id: string;
    token_hash: string;
}

function normalizeEmail(email: string): string {
    return email.trim().normalize('NFKC').toLowerCase();
}

function validEmail(email: string): boolean {
    return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePepper(): string | undefined {
    const pepper = process.env.AUTH_TOKEN_PEPPER;
    return pepper && Buffer.byteLength(pepper, 'utf8') >= 32 ? pepper : undefined;
}

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scryptCallback(
            password,
            salt,
            SCRYPT_KEY_LENGTH,
            { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
            (error, derivedKey) => error ? reject(error) : resolve(derivedKey)
        );
    });
}

async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await deriveScrypt(password, salt);
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt'
        || parts[1] !== String(SCRYPT_N) || parts[2] !== String(SCRYPT_R) || parts[3] !== String(SCRYPT_P)
        || !/^[A-Za-z0-9_-]{20,24}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{80,90}$/.test(parts[5])) {
        return false;
    }

    const expected = Buffer.from(parts[5], 'base64url');
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await deriveScrypt(password, Buffer.from(parts[4], 'base64url'));
    return timingSafeEqual(actual, expected);
}

function verificationHash(pepper: string, userId: string, code: string): string {
    return createHmac('sha256', pepper).update(`${userId}:verify_email:${code}`).digest('hex');
}

function equalHash(expectedHex: string, actualHex: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(actualHex)) return false;
    return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
}

function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function errorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = String(error.code);
        return /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown';
    }
    return 'unknown';
}

async function reserveIpAttempt(
    pool: Pool,
    ipAddress: string,
    eventType: string,
    recentLimit: number,
    dailyLimit: number
): Promise<boolean> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('impacta:rate:' || $1 || ':' || $2, 0))",
            [eventType, ipAddress]
        );
        const counts = await client.query<{ recent_count: number; daily_count: number }>(
            `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '15 minutes')::int AS recent_count,
                    count(*) FILTER (WHERE occurred_at > now() - interval '24 hours')::int AS daily_count
             FROM impacta.auth_events
             WHERE ip_address = $1::inet AND event_type = $2`,
            [ipAddress, eventType]
        );
        const allowed = (counts.rows[0]?.recent_count ?? 0) < recentLimit
            && (counts.rows[0]?.daily_count ?? 0) < dailyLimit;
        await client.query(
            'INSERT INTO impacta.auth_events (event_type, ip_address) VALUES ($1, $2::inet)',
            [eventType, ipAddress]
        );
        await client.query('COMMIT');
        return allowed;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function issueVerification(
    pool: Pool,
    email: string,
    pepper: string,
    registration?: { displayName: string; passwordHash: string }
): Promise<{ recipient?: string; code?: string }> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('impacta:email:' || $1, 0))",
            [email]
        );

        let user = await client.query<{ id: string; status: string }>(
            'SELECT id::text AS id, status FROM impacta.users WHERE lower(email) = $1 FOR UPDATE',
            [email]
        );

        if (user.rowCount === 0 && registration) {
            user = await client.query<{ id: string; status: string }>(
                `INSERT INTO impacta.users (email, password_hash, display_name, status)
                 VALUES ($1, $2, $3, 'pending')
                 RETURNING id::text AS id, status`,
                [email, registration.passwordHash, registration.displayName]
            );
        }

        const account = user.rows[0];
        if (!account || account.status !== 'pending') {
            await client.query('COMMIT');
            return {};
        }

        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await client.query(
            `INSERT INTO impacta.auth_tokens (user_id, token_hash, purpose, expires_at)
             VALUES ($1, $2, 'verify_email', now() + ($3::int * interval '1 minute'))`,
            [account.id, verificationHash(pepper, account.id, code), VERIFICATION_TTL_MINUTES]
        );
        await client.query('COMMIT');
        return { recipient: email, code };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function issuePasswordReset(
    pool: Pool,
    email: string,
    frontendBaseUrl: string,
    ipAddress: string
): Promise<{ email: string; resetUrl: string } | undefined> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('impacta:password-reset:' || $1, 0))",
            [email]
        );
        const userResult = await client.query<{ id: string; status: string; email_verified_at: Date | null }>(
            `SELECT id::text AS id, status, email_verified_at
             FROM impacta.users WHERE lower(email) = $1`,
            [email]
        );
        const user = userResult.rows[0];
        if (!user || user.status !== 'active' || !user.email_verified_at) {
            await client.query('COMMIT');
            return undefined;
        }

        const recentRequests = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM impacta.auth_events
             WHERE user_id = $1 AND event_type = 'password_reset_requested'
               AND occurred_at > now() - interval '1 hour'`,
            [user.id]
        );
        await client.query(
            `INSERT INTO impacta.auth_events (user_id, event_type, ip_address)
             VALUES ($1, 'password_reset_requested', $2::inet)`,
            [user.id, ipAddress]
        );
        if ((recentRequests.rows[0]?.count ?? 0) >= 3) {
            await client.query('COMMIT');
            return undefined;
        }

        const token = randomBytes(32).toString('hex');
        await client.query(
            `INSERT INTO impacta.auth_tokens (user_id, token_hash, purpose, expires_at)
             VALUES ($1, $2, 'reset_password', now() + ($3::int * interval '1 minute'))`,
            [user.id, tokenHash(token), PASSWORD_RESET_TTL_MINUTES]
        );
        await client.query('COMMIT');

        const resetLink = new URL(frontendBaseUrl + '/frontend/pages/password-reset.html');
        resetLink.searchParams.set('token', token);
        return { email, resetUrl: resetLink.toString() };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function recordUserAuthEvent(client: PoolClient, userId: string, eventType: string, ipAddress: string): Promise<void> {
    await client.query(
        'INSERT INTO impacta.auth_events (user_id, event_type, ip_address) VALUES ($1, $2, $3::inet)',
        [userId, eventType, ipAddress]
    );
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    if (!cookieHeader) return undefined;
    const pair = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

const registrationSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['displayName', 'email'],
        additionalProperties: false,
        properties: {
            displayName: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', minLength: 3, maxLength: 320 }
        }
    }
};

const resendSchema: FastifySchema = {
    body: {
        type: 'object', required: ['email'], additionalProperties: false,
        properties: { email: { type: 'string', minLength: 3, maxLength: 320 } }
    }
};

const verifySchema: FastifySchema = {
    body: {
        type: 'object', required: ['email', 'code', 'displayName', 'password', 'passwordConfirmation'], additionalProperties: false,
        properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            code: { type: 'string', pattern: '^[0-9]{6}$' },
            displayName: { type: 'string', minLength: 2, maxLength: 120 },
            password: { type: 'string', minLength: 12, maxLength: 128 },
            passwordConfirmation: { type: 'string', minLength: 12, maxLength: 128 }
        }
    }
};

const loginSchema: FastifySchema = {
    body: {
        type: 'object', required: ['email', 'password'], additionalProperties: false,
        properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 128 }
        }
    }
};

const passwordResetRequestSchema: FastifySchema = {
    body: {
        type: 'object', required: ['email'], additionalProperties: false,
        properties: { email: { type: 'string', minLength: 3, maxLength: 320 } }
    }
};

const passwordResetConfirmSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['token', 'password', 'passwordConfirmation'],
        additionalProperties: false,
        properties: {
            token: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            password: { type: 'string', minLength: 12, maxLength: 128 },
            passwordConfirmation: { type: 'string', minLength: 12, maxLength: 128 }
        }
    }
};

export function registerAuthRoutes(server: FastifyInstance, pool: Pool, frontendBaseUrl: string): void {
    server.post<{ Body: RegisterBody }>('/api/v1/auth/register', { schema: registrationSchema }, async (request, reply) => {
        const displayName = request.body.displayName.trim();
        const email = normalizeEmail(request.body.email);
        if (displayName.length < 2 || !validEmail(email)) {
            return reply.code(400).send({ error: 'invalid_registration' });
        }

        const pepper = validatePepper();
        if (!pepper) return reply.code(503).send({ error: 'auth_configuration_unavailable' });
        if (!isEmailDeliveryConfigured()) {
            return reply.code(503).send({ error: 'email_delivery_unavailable' });
        }

        try {
            if (!await reserveIpAttempt(pool, request.ip, 'email_code_request', 5, 10)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }
            const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
            const delivery = await issueVerification(pool, email, pepper, { displayName, passwordHash });
            if (delivery.recipient && delivery.code) {
                try {
                    await sendVerificationEmail({ email: delivery.recipient, code: delivery.code });
                } catch (error) {
                    request.log.error({ event: 'verification_email_delivery_failed', code: errorCode(error) }, 'Verification email could not be delivered');
                    return reply.code(503).send({ error: 'email_delivery_unavailable' });
                }
            }
            return reply.code(202).send({
                status: 'verification_pending',
                message: 'Se o endereço puder ser registado, receberás um código de verificação por email.'
            });
        } catch (error) {
            request.log.error({ event: 'registration_failed', code: errorCode(error) }, 'Account registration failed');
            return reply.code(500).send({ error: 'registration_unavailable' });
        }
    });

    server.post<{ Body: ResendBody }>('/api/v1/auth/verification/resend', { schema: resendSchema }, async (request, reply) => {
        const email = normalizeEmail(request.body.email);
        if (!validEmail(email)) return reply.code(400).send({ error: 'invalid_request' });
        const pepper = validatePepper();
        if (!pepper) return reply.code(503).send({ error: 'auth_configuration_unavailable' });
        if (!isEmailDeliveryConfigured()) {
            return reply.code(503).send({ error: 'email_delivery_unavailable' });
        }

        try {
            if (!await reserveIpAttempt(pool, request.ip, 'email_code_request', 5, 10)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }
            const delivery = await issueVerification(pool, email, pepper);
            if (delivery.recipient && delivery.code) {
                try {
                    await sendVerificationEmail({ email: delivery.recipient, code: delivery.code });
                } catch (error) {
                    request.log.error({ event: 'verification_email_delivery_failed', code: errorCode(error) }, 'Verification email could not be delivered');
                    return reply.code(503).send({ error: 'email_delivery_unavailable' });
                }
            }
            return reply.code(202).send({
                status: 'verification_pending',
                message: 'Se o endereço puder ser registado, receberás um código de verificação por email.'
            });
        } catch (error) {
            request.log.error({ event: 'verification_resend_failed', code: errorCode(error) }, 'Verification code could not be resent');
            return reply.code(500).send({ error: 'verification_unavailable' });
        }
    });

    server.post<{ Body: VerifyBody }>('/api/v1/auth/verification/confirm', { schema: verifySchema }, async (request, reply) => {
        const email = normalizeEmail(request.body.email);
        if (!validEmail(email)) return reply.code(400).send({ error: 'invalid_request' });
        if (request.body.displayName.trim().length < 2
            || request.body.password !== request.body.passwordConfirmation) {
            return reply.code(400).send({ error: 'invalid_registration' });
        }
        const pepper = validatePepper();
        if (!pepper) return reply.code(503).send({ error: 'auth_configuration_unavailable' });

        try {
            if (!await reserveIpAttempt(pool, request.ip, 'email_code_attempt', 10, 30)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const userResult = await client.query<{ id: string; status: string }>(
                    'SELECT id::text AS id, status FROM impacta.users WHERE lower(email) = $1 FOR UPDATE',
                    [email]
                );
                const user = userResult.rows[0];
                if (!user || user.status !== 'pending') {
                    await client.query('COMMIT');
                    return reply.code(400).send({ error: 'verification_invalid_or_expired' });
                }

                const failureCount = await client.query<{ count: number }>(
                    `SELECT count(*)::int AS count FROM impacta.auth_events
                     WHERE user_id = $1 AND event_type = 'email_code_failed'
                       AND occurred_at > now() - interval '15 minutes'`,
                    [user.id]
                );
                if ((failureCount.rows[0]?.count ?? 0) >= 5) {
                    await recordUserAuthEvent(client, user.id, 'email_code_failed', request.ip);
                    await client.query('COMMIT');
                    return reply.code(429).send({ error: 'too_many_requests' });
                }

                const tokenResult = await client.query<VerificationTokenRecord>(
                    `SELECT id::text AS id, token_hash
                     FROM impacta.auth_tokens
                     WHERE user_id = $1 AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > now()
                     ORDER BY created_at DESC LIMIT 10 FOR UPDATE`,
                    [user.id]
                );
                const actualHash = verificationHash(pepper, user.id, request.body.code);
                let matchedTokenId: string | undefined;
                for (const token of tokenResult.rows) {
                    if (equalHash(token.token_hash.trim(), actualHash)) matchedTokenId = token.id;
                }

                if (!matchedTokenId) {
                    await recordUserAuthEvent(client, user.id, 'email_code_failed', request.ip);
                    await client.query('COMMIT');
                    return reply.code(400).send({ error: 'verification_invalid_or_expired' });
                }

                const passwordHash = await hashPassword(request.body.password);

                const memberRole = await client.query<{ id: string }>(
                    "SELECT id::text AS id FROM impacta.roles WHERE code = 'member'"
                );
                if (!memberRole.rows[0]) {
                    await client.query('ROLLBACK');
                    request.log.error({ event: 'member_role_missing' }, 'Member role is missing from the database');
                    return reply.code(503).send({ error: 'verification_unavailable' });
                }

                await client.query(
                    `UPDATE impacta.auth_tokens SET consumed_at = now()
                     WHERE user_id = $1 AND purpose = 'verify_email' AND consumed_at IS NULL`,
                    [user.id]
                );
                await client.query(
                    `UPDATE impacta.users
                     SET display_name = $2, password_hash = $3, status = 'active', email_verified_at = now()
                     WHERE id = $1`,
                    [user.id, request.body.displayName.trim(), passwordHash]
                );
                await client.query('INSERT INTO impacta.user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
                await client.query(
                    'INSERT INTO impacta.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [user.id, memberRole.rows[0].id]
                );
                await recordUserAuthEvent(client, user.id, 'email_verified', request.ip);
                await client.query('COMMIT');
                return { status: 'verified', message: 'Email confirmado e conta ativada. Já podes iniciar sessão.' };
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            request.log.error({ event: 'email_verification_failed', code: errorCode(error) }, 'Email verification failed');
            return reply.code(500).send({ error: 'verification_unavailable' });
        }
    });

    server.post<{ Body: PasswordResetRequestBody }>(
        '/api/v1/auth/password/reset/request',
        { schema: passwordResetRequestSchema },
        async (request, reply) => {
            const email = normalizeEmail(request.body.email);
            if (!validEmail(email)) return reply.code(400).send({ error: 'invalid_request' });
            if (!isEmailDeliveryConfigured()) {
                return reply.code(503).send({ error: 'email_delivery_unavailable' });
            }

            try {
                if (!await reserveIpAttempt(pool, request.ip, 'password_reset_request', 5, 10)) {
                    return reply.code(429).send({ error: 'too_many_requests' });
                }
                let delivery: { email: string; resetUrl: string } | undefined;
                try {
                    delivery = await issuePasswordReset(pool, email, frontendBaseUrl, request.ip);
                } catch (error) {
                    request.log.error(
                        { event: 'password_reset_token_issue_failed', code: errorCode(error) },
                        'Password reset token could not be issued'
                    );
                }
                if (delivery) {
                    void sendPasswordResetEmail(delivery).catch((error) => {
                        request.log.error(
                            { event: 'password_reset_email_delivery_failed', code: errorCode(error) },
                            'Password reset email could not be delivered'
                        );
                    });
                }
                return reply.code(202).send({
                    status: 'reset_requested',
                    message: 'Se existir uma conta ativa com este email, receberás uma mensagem com os próximos passos.'
                });
            } catch (error) {
                request.log.error({ event: 'password_reset_request_failed', code: errorCode(error) }, 'Password reset could not be requested');
                return reply.code(500).send({ error: 'password_reset_unavailable' });
            }
        }
    );

    server.post<{ Body: PasswordResetConfirmBody }>(
        '/api/v1/auth/password/reset/confirm',
        { schema: passwordResetConfirmSchema },
        async (request, reply) => {
            if (request.body.password !== request.body.passwordConfirmation) {
                return reply.code(400).send({ error: 'invalid_registration' });
            }

            try {
                if (!await reserveIpAttempt(pool, request.ip, 'password_reset_attempt', 10, 30)) {
                    return reply.code(429).send({ error: 'too_many_requests' });
                }
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const tokenResult = await client.query<PasswordResetTokenRecord>(
                        `SELECT auth_token.id::text AS id, auth_token.user_id::text AS user_id
                         FROM impacta.auth_tokens AS auth_token
                         JOIN impacta.users AS user_account ON user_account.id = auth_token.user_id
                         WHERE auth_token.token_hash = $1
                           AND auth_token.purpose = 'reset_password'
                           AND auth_token.consumed_at IS NULL
                           AND auth_token.expires_at > now()
                           AND user_account.status = 'active'
                           AND user_account.email_verified_at IS NOT NULL
                         FOR UPDATE OF auth_token, user_account`,
                        [tokenHash(request.body.token)]
                    );
                    const resetToken = tokenResult.rows[0];
                    if (!resetToken) {
                        await client.query('COMMIT');
                        return reply.code(400).send({ error: 'password_reset_invalid_or_expired' });
                    }

                    const passwordHash = await hashPassword(request.body.password);
                    await client.query(
                        `UPDATE impacta.auth_tokens SET consumed_at = now()
                         WHERE user_id = $1 AND purpose = 'reset_password' AND consumed_at IS NULL`,
                        [resetToken.user_id]
                    );
                    await client.query(
                        'UPDATE impacta.users SET password_hash = $2 WHERE id = $1',
                        [resetToken.user_id, passwordHash]
                    );
                    await client.query(
                        'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                        [resetToken.user_id]
                    );
                    await recordUserAuthEvent(client, resetToken.user_id, 'password_reset_completed', request.ip);
                    await client.query('COMMIT');
                    return { status: 'password_reset', message: 'Palavra-passe atualizada. Inicia sessão com a nova palavra-passe.' };
                } catch (error) {
                    await client.query('ROLLBACK').catch(() => undefined);
                    throw error;
                } finally {
                    client.release();
                }
            } catch (error) {
                request.log.error({ event: 'password_reset_failed', code: errorCode(error) }, 'Password reset failed');
                return reply.code(500).send({ error: 'password_reset_unavailable' });
            }
        }
    );

    server.post<{ Body: LoginBody }>('/api/v1/auth/login', { schema: loginSchema }, async (request, reply) => {
        const email = normalizeEmail(request.body.email);
        if (!validEmail(email)) return reply.code(400).send({ error: 'invalid_request' });

        try {
            if (!await reserveIpAttempt(pool, request.ip, 'login_attempt', 10, 30)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const userResult = await pool.query<UserRecord>(
                `SELECT id::text AS id, email, display_name, password_hash, status,
                        email_verified_at, mfa_required
                 FROM impacta.users WHERE lower(email) = $1`,
                [email]
            );
            const user = userResult.rows[0];
            const passwordValid = user
                ? await verifyPassword(request.body.password, user.password_hash)
                : (await hashPassword(request.body.password), false);

            if (!user || !passwordValid) {
                return reply.code(401).send({ error: 'invalid_credentials' });
            }
            if (user.status !== 'active' || !user.email_verified_at) {
                return reply.code(403).send({ error: 'email_not_verified' });
            }
            if (user.mfa_required) return reply.code(403).send({ error: 'mfa_required' });

            const sessionToken = randomBytes(32).toString('hex');
            const csrfToken = randomBytes(32).toString('hex');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO impacta.auth_sessions
                        (user_id, token_hash, csrf_token_hash, idle_expires_at, absolute_expires_at, ip_address, user_agent)
                     VALUES ($1, $2, $3, now() + interval '30 minutes', now() + interval '12 hours', $4::inet, $5)`,
                    [user.id, tokenHash(sessionToken), tokenHash(csrfToken), request.ip, request.headers['user-agent']?.slice(0, 1000) ?? null]
                );
                await recordUserAuthEvent(client, user.id, 'login_success', request.ip);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }

            const secure = process.env.APP_ENV === 'production' ? '; Secure' : '';
            reply.header('set-cookie', [
                `impacta_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`,
                `impacta_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=43200${secure}`
            ]);
            return { status: 'authenticated', user: { id: user.id, displayName: user.display_name } };
        } catch (error) {
            request.log.error({ event: 'login_failed', code: errorCode(error) }, 'Login request failed');
            return reply.code(500).send({ error: 'login_unavailable' });
        }
    });

    server.delete('/api/v1/auth/session', async (request, reply) => {
        const session = readCookie(request.headers.cookie, 'impacta_session');
        if (session && /^[a-f0-9]{64}$/i.test(session)) {
            try {
                await pool.query(
                    'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
                    [tokenHash(session)]
                );
            } catch (error) {
                request.log.error({ event: 'logout_failed', code: errorCode(error) }, 'Logout request failed');
                return reply.code(500).send({ error: 'logout_unavailable' });
            }
        }
        const secure = process.env.APP_ENV === 'production' ? '; Secure' : '';
        reply.header('set-cookie', [
            `impacta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
            `impacta_csrf=; Path=/; SameSite=Lax; Max-Age=0${secure}`
        ]);
        return { status: 'logged_out' };
    });
}

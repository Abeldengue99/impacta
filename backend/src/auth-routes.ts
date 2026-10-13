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
import { requireSession } from './community-routes.js';
import { isEmailDeliveryConfigured, sendPasswordResetEmail, sendVerificationEmail } from './email.js';
import {
    createRecoveryCodes,
    createTotpSecret,
    decryptTotpSecret,
    encryptTotpSecret,
    matchingTotpStep,
    mfaEncryptionKey,
    recoveryCodeHash,
    totpProvisioningUri
} from './mfa.js';

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const VERIFICATION_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 30;

interface RegisterBody {
    displayName: string;
    email: string;
    companyWebsite?: string;
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

interface MfaChallengeRecord {
    id: string;
    user_id: string;
    email?: string;
    purpose: 'login' | 'setup' | 'recovery_setup';
    encrypted_totp_secret: string | null;
    failed_attempts: number;
}

interface MfaChallengeBody {
    challengeToken: string;
    code: string;
}

interface MfaSetupStartBody {
    password: string;
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

async function hasAdministrativeAccess(pool: Pool, userId: string): Promise<boolean> {
    const access = await pool.query<{ allowed: boolean }>(
        `SELECT EXISTS (
             SELECT 1
             FROM impacta.user_roles AS assignment
             JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = assignment.role_id
             JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
             WHERE assignment.user_id = $1
               AND (
                   (assignment.scope_type = 'platform' AND assignment.scope_id IS NULL
                    AND permission.code IN ('admin.dashboard.read', 'reports.manage', 'content.moderate',
                                            'communities.manage', 'projects.review', 'accounts.verify'))
                   OR (assignment.scope_type = 'community' AND permission.code = 'projects.review')
               )
         ) AS allowed`,
        [userId]
    );
    return access.rows[0]?.allowed === true;
}

async function createMfaChallenge(
    pool: Pool,
    userId: string,
    purpose: 'login' | 'setup',
    encryptedSecret: string | null,
    request: { ip: string; headers: { 'user-agent'?: string } }
): Promise<string> {
    const challengeToken = randomBytes(32).toString('hex');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM impacta.mfa_challenges
             WHERE expires_at < now() - interval '30 days'
                OR consumed_at < now() - interval '30 days'`
        );
        await client.query(
            `UPDATE impacta.mfa_challenges SET consumed_at = now()
             WHERE user_id = $1 AND purpose = 'setup' AND consumed_at IS NULL`,
            [userId]
        );
        await client.query(
            `INSERT INTO impacta.mfa_challenges
                (user_id, token_hash, purpose, encrypted_totp_secret, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, now() + interval '10 minutes', $5::inet, $6)`,
            [userId, tokenHash(challengeToken), purpose, encryptedSecret, request.ip, request.headers['user-agent']?.slice(0, 1000) ?? null]
        );
        await client.query('COMMIT');
        return challengeToken;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

function createSessionTokens(): { sessionToken: string; csrfToken: string } {
    return { sessionToken: randomBytes(32).toString('hex'), csrfToken: randomBytes(32).toString('hex') };
}

async function storeAuthenticatedSession(
    client: PoolClient,
    userId: string,
    sessionToken: string,
    csrfToken: string,
    ipAddress: string,
    userAgent: string | undefined,
    mfaVerified: boolean
): Promise<void> {
    await client.query(
        `INSERT INTO impacta.auth_sessions
            (user_id, token_hash, csrf_token_hash, idle_expires_at, absolute_expires_at,
             ip_address, user_agent, mfa_verified_at)
         VALUES ($1, $2, $3, now() + interval '30 minutes', now() + interval '12 hours',
                 $4::inet, $5, CASE WHEN $6 THEN now() ELSE NULL END)`,
        [userId, tokenHash(sessionToken), tokenHash(csrfToken), ipAddress, userAgent?.slice(0, 1000) ?? null, mfaVerified]
    );
}

function setSessionCookies(reply: import('fastify').FastifyReply, sessionToken: string, csrfToken: string): void {
    const secure = process.env.APP_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', [
        `impacta_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`,
        `impacta_csrf=${csrfToken}; Path=/; SameSite=Lax; Max-Age=43200${secure}`
    ]);
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
        const counts = await client.query<{
            recent_count: number;
            daily_count: number;
            checked_at: Date;
        }>(
            `WITH decision_time AS (SELECT clock_timestamp() AS checked_at)
             SELECT decision_time.checked_at,
                    (count(auth_event.event_type) FILTER (
                        WHERE auth_event.occurred_at > decision_time.checked_at - interval '15 minutes'
                    ))::int AS recent_count,
                    (count(auth_event.event_type) FILTER (
                        WHERE auth_event.occurred_at > decision_time.checked_at - interval '24 hours'
                    ))::int AS daily_count
             FROM decision_time
             LEFT JOIN impacta.auth_events AS auth_event
               ON auth_event.ip_address = $1::inet AND auth_event.event_type = $2
             GROUP BY decision_time.checked_at`,
            [ipAddress, eventType]
        );
        const decision = counts.rows[0];
        const allowed = decision !== undefined
            && decision.recent_count < recentLimit
            && decision.daily_count < dailyLimit;
        // Count admitted requests only. Recording denied requests here would
        // keep a caller locked out indefinitely as each retry extends the window.
        if (allowed) {
            await client.query(
                'INSERT INTO impacta.auth_events (event_type, ip_address, occurred_at) VALUES ($1, $2::inet, $3)',
                [eventType, ipAddress, decision.checked_at]
            );
        }
        await client.query('COMMIT');
        return allowed;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function reserveAccountLoginAttempt(pool: Pool, userId: string, ipAddress: string): Promise<boolean> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('impacta:login:user:' || $1::text, 0))",
            [userId]
        );
        const counts = await client.query<{
            recent_count: number;
            daily_count: number;
            checked_at: Date;
        }>(
            `WITH decision_time AS (SELECT clock_timestamp() AS checked_at),
                  last_success AS (
                      SELECT COALESCE(max(occurred_at), '-infinity'::timestamptz) AS occurred_at
                      FROM impacta.auth_events
                      WHERE user_id = $1 AND event_type = 'login_success'
                  )
             SELECT decision_time.checked_at,
                    count(auth_event.event_type) FILTER (
                        WHERE auth_event.occurred_at > GREATEST(
                            last_success.occurred_at,
                            decision_time.checked_at - interval '15 minutes'
                        )
                    )::int AS recent_count,
                    count(auth_event.event_type) FILTER (
                        WHERE auth_event.occurred_at > GREATEST(
                            last_success.occurred_at,
                            decision_time.checked_at - interval '24 hours'
                        )
                    )::int AS daily_count
             FROM decision_time
             CROSS JOIN last_success
             LEFT JOIN impacta.auth_events AS auth_event
               ON auth_event.user_id = $1 AND auth_event.event_type = 'login_attempt_account'
             GROUP BY decision_time.checked_at, last_success.occurred_at`,
            [userId]
        );
        const decision = counts.rows[0];
        const allowed = decision !== undefined
            && decision.recent_count < 10
            && decision.daily_count < 30;
        if (allowed) {
            await client.query(
                `INSERT INTO impacta.auth_events (user_id, event_type, ip_address, occurred_at)
                 VALUES ($1, 'login_attempt_account', $2::inet, $3)`,
                [userId, ipAddress, decision.checked_at]
            );
        }
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

        const resetLink = new URL(frontendBaseUrl + '/frontend/pages/index.html');
        resetLink.searchParams.set('token', token);
        resetLink.hash = 'password-reset';
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

async function recordRegistrationBotSignal(pool: Pool, ipAddress: string): Promise<void> {
    await pool.query(
        `INSERT INTO impacta.auth_events (event_type, ip_address)
         VALUES ('registration_honeypot',
                 network(set_masklen($1::inet, CASE WHEN family($1::inet) = 4 THEN 24 ELSE 56 END)))`,
        [ipAddress]
    );
}

const registrationSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['displayName', 'email'],
        additionalProperties: false,
        properties: {
            displayName: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', minLength: 3, maxLength: 320 },
            companyWebsite: { type: 'string', maxLength: 500 }
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

const mfaChallengeSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['challengeToken', 'code'],
        additionalProperties: false,
        properties: {
            challengeToken: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            code: { type: 'string', pattern: '^(?:[0-9]{6}|[A-Fa-f0-9]{4}(?:[- ]?[A-Fa-f0-9]{4}){3})$', maxLength: 32 }
        }
    }
};

const mfaSetupStartSchema: FastifySchema = {
    body: {
        type: 'object',
        required: ['password'],
        additionalProperties: false,
        properties: { password: { type: 'string', minLength: 12, maxLength: 128 } }
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
            if (request.body.companyWebsite?.trim()) {
                await recordRegistrationBotSignal(pool, request.ip);
                return reply.code(202).send({
                    status: 'verification_pending',
                    message: 'Se o endereço puder ser registado, receberás um código de verificação por email.'
                });
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
            if (!await reserveIpAttempt(pool, request.ip, 'login_attempt_ip', 100, 1000)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const userResult = await pool.query<UserRecord>(
                `SELECT id::text AS id, email, display_name, password_hash, status,
                        email_verified_at, mfa_required
                 FROM impacta.users WHERE lower(email) = $1`,
                [email]
            );
            const user = userResult.rows[0];
            if (user && !await reserveAccountLoginAttempt(pool, user.id, request.ip)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }
            const passwordValid = user
                ? await verifyPassword(request.body.password, user.password_hash)
                : (await hashPassword(request.body.password), false);

            if (!user || !passwordValid) {
                return reply.code(401).send({ error: 'invalid_credentials' });
            }
            if (user.status !== 'active' || !user.email_verified_at) {
                return reply.code(403).send({ error: 'email_not_verified' });
            }

            let canEnterAdmin = false;
            try {
                canEnterAdmin = await hasAdministrativeAccess(pool, user.id);
            } catch (error) {
                request.log.error({ event: 'login_admin_access_lookup_failed', code: errorCode(error) }, 'Could not resolve administrative access during login');
                return reply.code(503).send({ error: 'administrative_access_unavailable' });
            }

            const requiresMfa = user.mfa_required || canEnterAdmin;
            if (requiresMfa) {
                const encryptionKey = mfaEncryptionKey();
                if (!encryptionKey) return reply.code(503).send({ error: 'mfa_configuration_unavailable' });

                if (canEnterAdmin && !user.mfa_required) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        await client.query('UPDATE impacta.users SET mfa_required = true WHERE id = $1', [user.id]);
                        await client.query(
                            'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                            [user.id]
                        );
                        await client.query('COMMIT');
                    } catch (error) {
                        await client.query('ROLLBACK').catch(() => undefined);
                        throw error;
                    } finally {
                        client.release();
                    }
                }

                const existingMfa = await pool.query<{ configured: boolean }>(
                    'SELECT EXISTS (SELECT 1 FROM impacta.mfa_credentials WHERE user_id = $1 AND verified_at IS NOT NULL) AS configured',
                    [user.id]
                );
                if (existingMfa.rows[0]?.configured) {
                    const challengeToken = await createMfaChallenge(pool, user.id, 'login', null, request);
                    return reply.code(200).send({ status: 'mfa_required', challengeToken });
                }

                const secret = createTotpSecret();
                const challengeToken = await createMfaChallenge(
                    pool,
                    user.id,
                    'setup',
                    encryptTotpSecret(secret, encryptionKey),
                    request
                );
                return reply.code(200).send({
                    status: 'mfa_setup_required',
                    challengeToken,
                    secret,
                    otpauthUri: totpProvisioningUri(secret, user.email)
                });
            }

            const { sessionToken, csrfToken } = createSessionTokens();
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await storeAuthenticatedSession(client, user.id, sessionToken, csrfToken, request.ip,
                    request.headers['user-agent'], false);
                await recordUserAuthEvent(client, user.id, 'login_success', request.ip);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }

            setSessionCookies(reply, sessionToken, csrfToken);
            return {
                status: 'authenticated',
                user: { id: user.id, displayName: user.display_name },
                canEnterAdmin
            };
        } catch (error) {
            request.log.error({ event: 'login_failed', code: errorCode(error) }, 'Login request failed');
            return reply.code(500).send({ error: 'login_unavailable' });
        }
    });

    server.get('/api/v1/auth/mfa/status', async (request, reply) => {
        const session = await requireSession(request, reply, pool, false);
        if (!session) return;
        const [account, credential] = await Promise.all([
            pool.query<{ mfa_required: boolean }>(
                'SELECT mfa_required FROM impacta.users WHERE id = $1 AND status = \'active\'',
                [session.userId]
            ),
            pool.query<{ enabled: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM impacta.mfa_credentials WHERE user_id = $1 AND verified_at IS NOT NULL) AS enabled',
                [session.userId]
            )
        ]);
        const canEnterAdmin = await hasAdministrativeAccess(pool, session.userId);
        const enabled = credential.rows[0]?.enabled === true;
        return {
            enabled,
            required: account.rows[0]?.mfa_required === true || canEnterAdmin,
            canDisable: false
        };
    });

    server.post<{ Body: MfaSetupStartBody }>(
        '/api/v1/auth/mfa/setup/start', { schema: mfaSetupStartSchema }, async (request, reply) => {
            const session = await requireSession(request, reply, pool, true);
            if (!session) return;
            const encryptionKey = mfaEncryptionKey();
            if (!encryptionKey) return reply.code(503).send({ error: 'mfa_configuration_unavailable' });
            if (!await reserveIpAttempt(pool, request.ip, 'mfa_setup_start_attempt', 10, 30)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const account = await pool.query<{ email: string; password_hash: string }>(
                `SELECT email, password_hash FROM impacta.users
                 WHERE id = $1 AND status = 'active'`,
                [session.userId]
            );
            const user = account.rows[0];
            if (!user || !await verifyPassword(request.body.password, user.password_hash)) {
                return reply.code(401).send({ error: 'mfa_password_invalid' });
            }

            const existing = await pool.query<{ enabled: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM impacta.mfa_credentials WHERE user_id = $1 AND verified_at IS NOT NULL) AS enabled',
                [session.userId]
            );
            if (existing.rows[0]?.enabled) return reply.code(409).send({ error: 'mfa_already_enabled' });

            const secret = createTotpSecret();
            const challengeToken = await createMfaChallenge(
                pool,
                session.userId,
                'setup',
                encryptTotpSecret(secret, encryptionKey),
                request
            );
            reply.header('cache-control', 'no-store');
            return {
                status: 'mfa_setup_required',
                challengeToken,
                secret,
                otpauthUri: totpProvisioningUri(secret, user.email)
            };
        }
    );

    server.post<{ Body: MfaChallengeBody }>(
        '/api/v1/auth/mfa/verify', { schema: mfaChallengeSchema }, async (request, reply) => {
            const encryptionKey = mfaEncryptionKey();
            if (!encryptionKey) return reply.code(503).send({ error: 'mfa_configuration_unavailable' });
            if (!await reserveIpAttempt(pool, request.ip, 'mfa_verify_attempt', 30, 100)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const { sessionToken, csrfToken } = createSessionTokens();
            const client = await pool.connect();
            let result: { status: 'authenticated'; userId: string; canEnterAdmin: boolean; recoveryCodeUsed: boolean }
                | { status: 'recovery_setup'; challengeToken: string; secret: string; email: string }
                | { status: 'invalid'; error: string; httpStatus: number };
            try {
                await client.query('BEGIN');
                const challengeResult = await client.query<MfaChallengeRecord>(
                    `SELECT challenge.id::text AS id, challenge.user_id::text AS user_id,
                            challenge.purpose, challenge.encrypted_totp_secret,
                            challenge.failed_attempts, account.email
                     FROM impacta.mfa_challenges AS challenge
                     JOIN impacta.users AS account ON account.id = challenge.user_id
                     WHERE challenge.token_hash = $1 AND challenge.purpose = 'login'
                       AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
                     FOR UPDATE OF challenge`,
                    [tokenHash(request.body.challengeToken)]
                );
                const challenge = challengeResult.rows[0];
                if (!challenge) {
                    await client.query('COMMIT');
                    result = { status: 'invalid', error: 'mfa_challenge_invalid', httpStatus: 401 };
                } else {
                    await client.query(
                        "SELECT pg_advisory_xact_lock(hashtextextended('impacta:mfa:' || $1::text, 0))",
                        [challenge.user_id]
                    );
                    const recentFailures = await client.query<{ count: number }>(
                        `SELECT count(*)::int AS count FROM impacta.auth_events
                         WHERE user_id = $1 AND event_type IN ('mfa_login_failed', 'mfa_setup_failed')
                           AND occurred_at > now() - interval '15 minutes'`,
                        [challenge.user_id]
                    );
                    if ((recentFailures.rows[0]?.count ?? 0) >= 10) {
                        await client.query('UPDATE impacta.mfa_challenges SET consumed_at = now() WHERE id = $1', [challenge.id]);
                        await client.query('COMMIT');
                        result = { status: 'invalid', error: 'too_many_requests', httpStatus: 429 };
                    } else {
                        const credentialResult = await client.query<{
                            encrypted_totp_secret: string;
                            last_used_step: string;
                        }>(
                            `SELECT encrypted_totp_secret, last_used_step::text AS last_used_step
                             FROM impacta.mfa_credentials WHERE user_id = $1 AND verified_at IS NOT NULL FOR UPDATE`,
                            [challenge.user_id]
                        );
                        const credential = credentialResult.rows[0];
                        const secret = credential
                            ? decryptTotpSecret(credential.encrypted_totp_secret, encryptionKey)
                            : null;
                        if (!credential || !secret) {
                            await client.query('ROLLBACK');
                            result = { status: 'invalid', error: 'mfa_configuration_unavailable', httpStatus: 503 };
                        } else {
                            const lastUsedStep = Number(credential.last_used_step);
                            const matchedStep = matchingTotpStep(secret, request.body.code, Date.now(), lastUsedStep);
                            let recoveryCodeUsed = false;
                            let valid = matchedStep !== null;
                            if (matchedStep !== null) {
                                await client.query(
                                    'UPDATE impacta.mfa_credentials SET last_used_step = $2 WHERE user_id = $1',
                                    [challenge.user_id, matchedStep]
                                );
                            } else {
                                const recoveryHash = recoveryCodeHash(challenge.user_id, request.body.code, encryptionKey);
                                if (recoveryHash) {
                                    const recovery = await client.query<{ id: string }>(
                                        `SELECT id::text AS id FROM impacta.mfa_recovery_codes
                                         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL FOR UPDATE`,
                                        [challenge.user_id, recoveryHash]
                                    );
                                    if (recovery.rows[0]) {
                                        await client.query('UPDATE impacta.mfa_recovery_codes SET used_at = now() WHERE id = $1', [recovery.rows[0].id]);
                                        valid = true;
                                        recoveryCodeUsed = true;
                                    }
                                }
                            }

                            if (!valid) {
                                await client.query(
                                    `UPDATE impacta.mfa_challenges
                                     SET failed_attempts = failed_attempts + 1,
                                         consumed_at = CASE WHEN failed_attempts >= 4 THEN now() ELSE consumed_at END
                                     WHERE id = $1`,
                                    [challenge.id]
                                );
                                await recordUserAuthEvent(client, challenge.user_id, 'mfa_login_failed', request.ip);
                                await client.query('COMMIT');
                                result = {
                                    status: 'invalid',
                                    error: challenge.failed_attempts >= 4 ? 'too_many_requests' : 'mfa_invalid_code',
                                    httpStatus: challenge.failed_attempts >= 4 ? 429 : 401
                                };
                            } else {
                                await client.query('UPDATE impacta.mfa_challenges SET consumed_at = now() WHERE id = $1', [challenge.id]);
                                if (recoveryCodeUsed) {
                                    const replacementSecret = createTotpSecret();
                                    const replacementToken = randomBytes(32).toString('hex');
                                    await client.query(
                                        `INSERT INTO impacta.mfa_challenges
                                            (user_id, token_hash, purpose, encrypted_totp_secret, expires_at, ip_address, user_agent)
                                         VALUES ($1, $2, 'recovery_setup', $3, now() + interval '10 minutes', $4::inet, $5)`,
                                        [challenge.user_id, tokenHash(replacementToken), encryptTotpSecret(replacementSecret, encryptionKey),
                                            request.ip, request.headers['user-agent']?.slice(0, 1000) ?? null]
                                    );
                                    await recordUserAuthEvent(client, challenge.user_id, 'mfa_recovery_used', request.ip);
                                    await client.query('COMMIT');
                                    result = {
                                        status: 'recovery_setup',
                                        challengeToken: replacementToken,
                                        secret: replacementSecret,
                                        email: challenge.email ?? ''
                                    };
                                } else {
                                    await client.query(
                                        'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                                        [challenge.user_id]
                                    );
                                    await storeAuthenticatedSession(client, challenge.user_id, sessionToken, csrfToken,
                                        request.ip, request.headers['user-agent'], true);
                                    await recordUserAuthEvent(client, challenge.user_id, 'login_success', request.ip);
                                    await client.query('COMMIT');
                                    result = {
                                        status: 'authenticated',
                                        userId: challenge.user_id,
                                        canEnterAdmin: await hasAdministrativeAccess(pool, challenge.user_id).catch(() => false),
                                        recoveryCodeUsed: false
                                    };
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }

            if (result.status === 'invalid') return reply.code(result.httpStatus).send({ error: result.error });
            if (result.status === 'recovery_setup') {
                return {
                    status: 'mfa_setup_required',
                    reason: 'recovery',
                    challengeToken: result.challengeToken,
                    secret: result.secret,
                    otpauthUri: totpProvisioningUri(result.secret, result.email)
                };
            }
            setSessionCookies(reply, sessionToken, csrfToken);
            return {
                status: 'authenticated',
                user: { id: result.userId },
                canEnterAdmin: result.canEnterAdmin,
                recoveryCodeUsed: result.recoveryCodeUsed
            };
        }
    );

    server.post<{ Body: MfaChallengeBody }>(
        '/api/v1/auth/mfa/setup/confirm', { schema: mfaChallengeSchema }, async (request, reply) => {
            const encryptionKey = mfaEncryptionKey();
            if (!encryptionKey) return reply.code(503).send({ error: 'mfa_configuration_unavailable' });
            if (!await reserveIpAttempt(pool, request.ip, 'mfa_setup_attempt', 20, 60)) {
                return reply.code(429).send({ error: 'too_many_requests' });
            }

            const { sessionToken, csrfToken } = createSessionTokens();
            const client = await pool.connect();
            let result: { status: 'enabled'; userId: string; canEnterAdmin: boolean; recoveryCodes: string[] }
                | { status: 'invalid'; error: string; httpStatus: number };
            try {
                await client.query('BEGIN');
                const challengeResult = await client.query<MfaChallengeRecord>(
                    `SELECT challenge.id::text AS id, challenge.user_id::text AS user_id,
                            challenge.purpose, challenge.encrypted_totp_secret,
                            challenge.failed_attempts, account.email
                     FROM impacta.mfa_challenges AS challenge
                     JOIN impacta.users AS account ON account.id = challenge.user_id
                     WHERE challenge.token_hash = $1 AND challenge.purpose IN ('setup', 'recovery_setup')
                       AND challenge.consumed_at IS NULL AND challenge.expires_at > now()
                     FOR UPDATE OF challenge`,
                    [tokenHash(request.body.challengeToken)]
                );
                const challenge = challengeResult.rows[0];
                if (!challenge || !challenge.encrypted_totp_secret) {
                    await client.query('COMMIT');
                    result = { status: 'invalid', error: 'mfa_challenge_invalid', httpStatus: 401 };
                } else {
                    await client.query(
                        "SELECT pg_advisory_xact_lock(hashtextextended('impacta:mfa:' || $1::text, 0))",
                        [challenge.user_id]
                    );
                    const recentFailures = await client.query<{ count: number }>(
                        `SELECT count(*)::int AS count FROM impacta.auth_events
                         WHERE user_id = $1 AND event_type IN ('mfa_login_failed', 'mfa_setup_failed')
                           AND occurred_at > now() - interval '15 minutes'`,
                        [challenge.user_id]
                    );
                    if ((recentFailures.rows[0]?.count ?? 0) >= 10) {
                        await client.query('UPDATE impacta.mfa_challenges SET consumed_at = now() WHERE id = $1', [challenge.id]);
                        await client.query('COMMIT');
                        result = { status: 'invalid', error: 'too_many_requests', httpStatus: 429 };
                    } else {
                        const existingSecret = decryptTotpSecret(challenge.encrypted_totp_secret, encryptionKey);
                        const matchedStep = existingSecret
                            ? matchingTotpStep(existingSecret, request.body.code)
                            : null;
                        if (matchedStep === null || !existingSecret) {
                            await client.query(
                                `UPDATE impacta.mfa_challenges
                                 SET failed_attempts = failed_attempts + 1,
                                     consumed_at = CASE WHEN failed_attempts >= 4 THEN now() ELSE consumed_at END
                                 WHERE id = $1`,
                                [challenge.id]
                            );
                            await recordUserAuthEvent(client, challenge.user_id, 'mfa_setup_failed', request.ip);
                            await client.query('COMMIT');
                            result = {
                                status: 'invalid',
                                error: challenge.failed_attempts >= 4 ? 'too_many_requests' : 'mfa_invalid_code',
                                httpStatus: challenge.failed_attempts >= 4 ? 429 : 401
                            };
                        } else {
                            const enrollment = challenge.purpose === 'recovery_setup'
                                ? await client.query(
                                    `UPDATE impacta.mfa_credentials
                                     SET encrypted_totp_secret = $2, verified_at = now(), last_used_step = $3
                                     WHERE user_id = $1 RETURNING user_id`,
                                    [challenge.user_id, challenge.encrypted_totp_secret, matchedStep]
                                )
                                : await client.query(
                                    `INSERT INTO impacta.mfa_credentials
                                        (user_id, encrypted_totp_secret, verified_at, last_used_step)
                                     VALUES ($1, $2, now(), $3)
                                     ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
                                    [challenge.user_id, challenge.encrypted_totp_secret, matchedStep]
                                );
                            if (!enrollment.rows[0]) {
                                await client.query('ROLLBACK');
                                result = { status: 'invalid', error: 'mfa_already_enabled', httpStatus: 409 };
                            } else {
                                const recoveryCodes = createRecoveryCodes();
                                const recoveryHashes = recoveryCodes.map((code) => recoveryCodeHash(challenge.user_id, code, encryptionKey));
                                if (recoveryHashes.some((hash) => hash === null)) throw new Error('Recovery code generation failed');
                                if (challenge.purpose === 'recovery_setup') {
                                    await client.query('DELETE FROM impacta.mfa_recovery_codes WHERE user_id = $1', [challenge.user_id]);
                                }
                                await client.query(
                                    `INSERT INTO impacta.mfa_recovery_codes (user_id, code_hash)
                                     SELECT $1, recovery_hash FROM unnest($2::text[]) AS recovery_hash`,
                                    [challenge.user_id, recoveryHashes]
                                );
                                await client.query('UPDATE impacta.users SET mfa_required = true WHERE id = $1', [challenge.user_id]);
                                await client.query('UPDATE impacta.mfa_challenges SET consumed_at = now() WHERE id = $1', [challenge.id]);
                                await client.query(
                                    'UPDATE impacta.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
                                    [challenge.user_id]
                                );
                                await storeAuthenticatedSession(client, challenge.user_id, sessionToken, csrfToken,
                                    request.ip, request.headers['user-agent'], true);
                                await recordUserAuthEvent(client, challenge.user_id,
                                    challenge.purpose === 'recovery_setup' ? 'mfa_recovered' : 'mfa_enabled', request.ip);
                                await recordUserAuthEvent(client, challenge.user_id, 'login_success', request.ip);
                                await client.query('COMMIT');
                                result = {
                                    status: 'enabled',
                                    userId: challenge.user_id,
                                    canEnterAdmin: await hasAdministrativeAccess(pool, challenge.user_id).catch(() => false),
                                    recoveryCodes
                                };
                            }
                        }
                    }
                }
            } catch (error) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                client.release();
            }

            if (result.status === 'invalid') return reply.code(result.httpStatus).send({ error: result.error });
            setSessionCookies(reply, sessionToken, csrfToken);
            return {
                status: 'authenticated',
                user: { id: result.userId },
                canEnterAdmin: result.canEnterAdmin,
                recoveryCodes: result.recoveryCodes
            };
        }
    );

    server.get('/api/v1/auth/session', async (request, reply) => {
        const sessionToken = readCookie(request.headers.cookie, 'impacta_session');
        if (!sessionToken || !/^[a-f0-9]{64}$/i.test(sessionToken)) {
            return { authenticated: false };
        }

        try {
            let accounts: { display_name: string; mfa_verified_at: Date | null }[];
            try {
                const result = await pool.query<{ display_name: string; mfa_verified_at: Date | null }>(
                    `UPDATE impacta.auth_sessions AS auth_session
                 SET last_seen_at = now(),
                     idle_expires_at = LEAST(auth_session.absolute_expires_at, now() + interval '30 minutes')
                 FROM impacta.users AS account
                 WHERE account.id = auth_session.user_id
                   AND auth_session.token_hash = $1
                   AND auth_session.revoked_at IS NULL
                   AND auth_session.idle_expires_at > now()
                   AND auth_session.absolute_expires_at > now()
                   AND account.status = 'active'
                   AND (NOT account.mfa_required OR auth_session.mfa_verified_at IS NOT NULL)
                     RETURNING account.display_name, auth_session.mfa_verified_at`,
                    [tokenHash(sessionToken)]
                );
                accounts = result.rows;
            } catch (error) {
                if (errorCode(error) !== '42501') throw error;
                const result = await pool.query<{ display_name: string; mfa_verified_at: Date | null }>(
                    `SELECT account.display_name
                           , auth_session.mfa_verified_at
                     FROM impacta.auth_sessions AS auth_session
                     JOIN impacta.users AS account ON account.id = auth_session.user_id
                     WHERE auth_session.token_hash = $1
                       AND auth_session.revoked_at IS NULL
                       AND auth_session.idle_expires_at > now()
                       AND auth_session.absolute_expires_at > now()
                       AND account.status = 'active'
                       AND (NOT account.mfa_required OR auth_session.mfa_verified_at IS NOT NULL)
                     LIMIT 1`,
                    [tokenHash(sessionToken)]
                );
                accounts = result.rows;
            }
            const account = accounts[0];
            return account
                ? { authenticated: true, user: { displayName: account.display_name }, mfaVerified: account.mfa_verified_at !== null }
                : { authenticated: false };
        } catch (error) {
            request.log.error({ event: 'session_lookup_failed', code: errorCode(error) }, 'Session lookup failed');
            return reply.code(503).send({ error: 'session_unavailable' });
        }
    });

    server.delete('/api/v1/auth/session', async (request, reply) => {
        const session = readCookie(request.headers.cookie, 'impacta_session');
        if (session && /^[a-f0-9]{64}$/i.test(session)) {
            try {
                const csrfCookie = readCookie(request.headers.cookie, 'impacta_csrf');
                const csrfHeader = request.headers['x-csrf-token'];
                const activeSession = await pool.query<{ csrf_token_hash: string }>(
                    `SELECT csrf_token_hash FROM impacta.auth_sessions
                     WHERE token_hash = $1 AND revoked_at IS NULL
                       AND idle_expires_at > now() AND absolute_expires_at > now()
                     LIMIT 1`,
                    [tokenHash(session)]
                );
                if (activeSession.rows[0]) {
                    const matchingTokens = typeof csrfHeader === 'string'
                        && Boolean(csrfCookie)
                        && /^[a-f0-9]{64}$/i.test(csrfCookie ?? '')
                        && /^[a-f0-9]{64}$/i.test(csrfHeader)
                        && equalHash(tokenHash(csrfCookie ?? ''), tokenHash(csrfHeader))
                        && equalHash(activeSession.rows[0].csrf_token_hash, tokenHash(csrfCookie ?? ''));
                    if (!matchingTokens) return reply.code(403).send({ error: 'csrf_validation_failed' });
                }
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

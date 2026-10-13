import { spawnSync } from 'node:child_process';

const shared = {
    APP_ENV: 'production',
    API_PORT: '3319',
    AUTH_TOKEN_PEPPER: 'x'.repeat(32),
    SMTP_HOST: 'smtp.example.org',
    SMTP_PORT: '587',
    SMTP_USER: 'smoke-user',
    SMTP_PASSWORD: 'smoke-password',
    SMTP_FROM_EMAIL: 'smoke@example.org'
};

const checks = [
    {
        name: 'missing token pepper',
        env: { ...shared, AUTH_TOKEN_PEPPER: '' },
        expected: 'AUTH_TOKEN_PEPPER must contain at least 32 bytes'
    },
    {
        name: 'incomplete SMTP configuration',
        env: { ...shared, SMTP_HOST: '' },
        expected: 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM_EMAIL are required'
    },
    {
        name: 'invalid SMTP port',
        env: { ...shared, SMTP_PORT: 'not-a-port' },
        expected: 'SMTP_PORT must be an integer from 1 to 65535'
    },
    {
        name: 'public API bind address',
        env: {
            ...shared,
            API_HOST: '0.0.0.0',
            PGSSL: 'true',
            PGPOOL_MAX: '5',
            MFA_ENCRYPTION_KEY: 'a'.repeat(64),
            IMPACTA_MEDIA_DIR: 'C:\\ImpactaData\\media',
            FRONTEND_ORIGINS: 'https://example.org',
            FRONTEND_BASE_URL: 'https://example.org/frontend/pages'
        },
        expected: 'API_HOST must be 127.0.0.1 in production'
    }
];

for (const check of checks) {
    const result = spawnSync(
        process.execPath,
        ['-r', 'dotenv/config', 'backend/dist/server.js'],
        {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 5000,
            env: { ...process.env, ...check.env }
        }
    );
    const output = (result.stdout || '') + (result.stderr || '');
    if (result.error || result.status === 0 || !output.includes(check.expected)) {
        throw new Error('Production startup check failed: ' + check.name);
    }
    process.stdout.write('PASS production startup rejects ' + check.name + '\n');
}
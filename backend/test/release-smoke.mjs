const baseValue = process.env.IMPACTA_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
let base;

try {
    base = new URL(baseValue);
} catch {
    throw new Error('IMPACTA_SMOKE_BASE_URL must be an absolute HTTP or HTTPS origin');
}

if (!['http:', 'https:'].includes(base.protocol)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('IMPACTA_SMOKE_BASE_URL must be an HTTP or HTTPS origin without credentials or a path');
}

const checks = [
    { path: '/api/v1/health/live', expected: 'ok' },
    { path: '/api/v1/health/ready', expected: 'ready' }
];

for (const check of checks) {
    let response;
    try {
        response = await fetch(new URL(check.path, base), {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
            cache: 'no-store'
        });
    } catch {
        throw new Error('Release smoke check could not reach ' + check.path + ' at ' + base.origin);
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error('Release smoke check received a non-JSON response from ' + check.path);
    }

    if (!response.ok || payload?.status !== check.expected) {
        const reason = payload?.status === 'not_ready'
            ? '; readiness reported: ' + (payload.message || 'unknown database configuration issue')
            : '';
        throw new Error('Release smoke check failed for ' + check.path + ' (HTTP ' + response.status + ')' + reason);
    }

    process.stdout.write('PASS ' + check.path + ' (' + response.status + ')\n');
}
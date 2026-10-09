(() => {
    const apiPort = '3001';
    const apiRoot = `${window.location.protocol}//${window.location.hostname}:${apiPort}/api/v1`;

    const request = async (path, method = 'GET', body) => {
        const headers = { Accept: 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${apiRoot}${path}`, {
            method,
            headers,
            credentials: 'include',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error('api_unavailable');
        }
        if (!response.ok) {
            throw Object.assign(new Error(payload?.error || 'api_unavailable'), {
                code: payload?.error || 'api_unavailable'
            });
        }
        return payload;
    };

    const get = async (path) => {
        const payload = await request(path);
        if (!payload || !Array.isArray(payload.items)) throw new Error('api_unavailable');
        return payload.items;
    };

    window.ImpactaAPI = Object.freeze({
        get,
        currentSession: () => request('/auth/session'),
        post: (path, body) => request(path, 'POST', body),
        delete: (path) => request(path, 'DELETE')
    });
})();

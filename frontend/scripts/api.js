(() => {
    const apiPort = '3001';
    const apiRoot = `${window.location.protocol}//${window.location.hostname}:${apiPort}/api/v1`;

    function readCookie(name) {
        const prefix = `${name}=`;
        const cookie = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
        if (!cookie) return '';
        try {
            return decodeURIComponent(cookie.slice(prefix.length));
        } catch {
            return '';
        }
    }

    const request = async (path, method = 'GET', body) => {
        const headers = { Accept: 'application/json' };
        const isBinary = typeof Blob !== 'undefined' && body instanceof Blob;
        if (body !== undefined) headers['Content-Type'] = isBinary ? body.type : 'application/json';
        if (method !== 'GET') {
            const csrfToken = readCookie('impacta_csrf');
            if (csrfToken) headers['x-csrf-token'] = csrfToken;
        }

        let response;
        try {
            response = await fetch(`${apiRoot}${path}`, {
                method,
                headers,
                credentials: 'include',
                cache: 'no-store',
                body: body === undefined ? undefined : (isBinary ? body : JSON.stringify(body))
            });
        } catch {
            throw Object.assign(new Error('api_unavailable'), { code: 'api_unavailable' });
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw Object.assign(new Error('api_unavailable'), { code: 'api_unavailable' });
        }
        if (!response.ok) {
            throw Object.assign(new Error(payload?.error || 'api_unavailable'), {
                code: payload?.error || 'api_unavailable',
                status: response.status
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
        request,
        assetUrl: (path) => `${window.location.protocol}//${window.location.hostname}:${apiPort}${path}`,
        currentSession: () => request('/auth/session'),
        post: (path, body) => request(path, 'POST', body),
        put: (path, body) => request(path, 'PUT', body),
        upload: (path, file) => request(path, 'POST', file),
        delete: (path) => request(path, 'DELETE')
    });
})();

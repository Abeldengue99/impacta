(() => {
    const apiPort = '3001';
    const apiRoot = window.location.protocol === 'https:'
        ? window.location.origin + '/api/v1'
        : window.location.protocol + '//' + window.location.hostname + ':' + apiPort + '/api/v1';

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
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), isBinary ? 180000 : 15000);
        try {
            response = await fetch(`${apiRoot}${path}`, {
                method,
                headers,
                credentials: 'include',
                cache: 'no-store',
                signal: controller.signal,
                body: body === undefined ? undefined : (isBinary ? body : JSON.stringify(body))
            });
        } catch (error) {
            const code = error?.name === 'AbortError' ? 'api_timeout' : 'api_unavailable';
            throw Object.assign(new Error(code), { code });
        } finally {
            window.clearTimeout(timeout);
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
                status: response.status,
                requestId: typeof payload?.requestId === 'string' ? payload.requestId : ''
            });
        }
        return payload;
    };

    const get = async (path) => {
        const payload = await request(path);
        if (!payload || !Array.isArray(payload.items)) throw new Error('api_unavailable');
        return payload.items;
    };

    const track = (path, body) => {
        const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
        const csrfToken = readCookie('impacta_csrf');
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        return fetch(`${apiRoot}${path}`, {
            method: 'POST',
            headers,
            credentials: 'include',
            cache: 'no-store',
            keepalive: true,
            body: JSON.stringify(body)
        }).catch(() => undefined);
    };

    const download = async (path, method = 'GET', body) => {
        const headers = { Accept: 'application/octet-stream' };
        if (method !== 'GET') {
            const csrfToken = readCookie('impacta_csrf');
            if (csrfToken) headers['x-csrf-token'] = csrfToken;
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let response;
        try {
            response = await fetch(`${apiRoot}${path}`, {
                method,
                headers,
                credentials: 'include',
                cache: 'no-store',
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch {
            throw Object.assign(new Error('api_unavailable'), { code: 'api_unavailable' });
        }
        if (!response.ok) {
            let payload = {};
            try { payload = await response.json(); } catch { /* A resposta pode não ser JSON. */ }
            throw Object.assign(new Error(payload?.error || 'api_unavailable'), {
                code: payload?.error || 'api_unavailable', status: response.status
            });
        }
        const disposition = response.headers.get('content-disposition') || '';
        const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'relatorio-impacta';
        return { blob: await response.blob(), filename };
    };

    const avatarPreviewCacheKey = 'impacta.avatar-preview.v1';
    const avatarPreviewRequests = new Map();
    let avatarPreviewGeneration = 0;

    function cachedAvatarPreview() {
        try {
            const value = JSON.parse(window.sessionStorage.getItem(avatarPreviewCacheKey) || 'null');
            if (!value || typeof value.userId !== 'string' || typeof value.avatarUrl !== 'string'
                || !/^data:image\/(?:jpeg|webp|png);base64,/i.test(value.dataUrl || '')) return null;
            return value;
        } catch {
            return null;
        }
    }

    function clearAvatarPreview() {
        avatarPreviewGeneration += 1;
        avatarPreviewRequests.clear();
        try { window.sessionStorage.removeItem(avatarPreviewCacheKey); } catch { /* Storage can be disabled by the browser. */ }
        document.documentElement?.style.removeProperty('--impacta-avatar-preview');
    }

    async function loadAvatarPreview(userId, avatarPath) {
        if (!userId || !avatarPath) return null;
        const normalizedUserId = String(userId);
        const cached = cachedAvatarPreview();
        if (cached?.userId === normalizedUserId && cached.avatarUrl === avatarPath) return cached.dataUrl;

        const requestKey = `${normalizedUserId}:${avatarPath}`;
        if (avatarPreviewRequests.has(requestKey)) return avatarPreviewRequests.get(requestKey);
        const generation = avatarPreviewGeneration;
        const request = (async () => {
            let objectUrl = '';
            try {
                const response = await fetch(`${apiRoot.replace('/api/v1', '')}${avatarPath}`, {
                    credentials: 'include', cache: 'no-store'
                });
                if (!response.ok) return null;
                const imageBlob = await response.blob();
                objectUrl = URL.createObjectURL(imageBlob);
                const image = new Image();
                image.src = objectUrl;
                if (typeof image.decode === 'function') await image.decode();
                else await new Promise((resolve, reject) => {
                    image.onload = resolve;
                    image.onerror = reject;
                });

                const size = 72;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext('2d');
                if (!context) return null;
                context.fillStyle = '#d9e9de';
                context.fillRect(0, 0, size, size);
                const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
                const cropX = (image.naturalWidth - cropSize) / 2;
                const cropY = (image.naturalHeight - cropSize) / 2;
                context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, size, size);
                const dataUrl = canvas.toDataURL('image/jpeg', .76);
                if (generation !== avatarPreviewGeneration) return dataUrl;
                try {
                    window.sessionStorage.setItem(avatarPreviewCacheKey, JSON.stringify({
                        userId: normalizedUserId, avatarUrl: avatarPath, dataUrl
                    }));
                } catch { /* The avatar still renders if this tab has no storage quota. */ }
                document.documentElement?.style.setProperty('--impacta-avatar-preview', 'url("' + dataUrl + '")');
                return dataUrl;
            } catch {
                return null;
            } finally {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        })();
        avatarPreviewRequests.set(requestKey, request);
        try { return await request; }
        finally { avatarPreviewRequests.delete(requestKey); }
    }
    window.ImpactaAPI = Object.freeze({
        get,
        request,
        track,
        download,
        assetUrl: (path) => `${window.location.protocol}//${window.location.hostname}:${apiPort}${path}`,
        cachedAvatarPreview,
        loadAvatarPreview,
        clearAvatarPreview,
        currentSession: () => request('/auth/session'),
        post: (path, body) => request(path, 'POST', body),
        put: (path, body) => request(path, 'PUT', body),
        upload: (path, file) => request(path, 'POST', file),
        delete: (path) => request(path, 'DELETE')
    });
})();

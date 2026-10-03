(() => {
    const apiPort = '3001';
    const apiRoot = `${window.location.protocol}//${window.location.hostname}:${apiPort}/api/v1`;

    const get = async (path) => {
        const response = await fetch(`${apiRoot}${path}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'include'
        });
        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error('api_unavailable');
        }
        if (!response.ok || !payload || !Array.isArray(payload.items)) {
            throw new Error('api_unavailable');
        }
        return payload.items;
    };

    window.ImpactaAPI = Object.freeze({ get });
})();

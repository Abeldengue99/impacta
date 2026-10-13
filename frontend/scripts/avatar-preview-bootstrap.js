(() => {
    try {
        const cached = JSON.parse(window.sessionStorage.getItem('impacta.avatar-preview.v1') || 'null');
        if (!cached || typeof cached.userId !== 'string' || !cached.userId
            || typeof cached.avatarUrl !== 'string'
            || !/^data:image\/(?:jpeg|webp|png);base64,[a-z0-9+/]+=*$/i.test(cached.dataUrl || '')) return;
        document.documentElement.style.setProperty('--impacta-avatar-preview', 'url("' + cached.dataUrl + '")');
    } catch {
        // Storage can be disabled; the account header will still render its initials.
    }
})();
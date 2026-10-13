(() => {
    if (new URLSearchParams(window.location.search).get('modal') !== '1') return;
    document.body.classList.add('is-modal-view');

    document.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const link = event.target.closest('a[href]');
        if (!(link instanceof HTMLAnchorElement)) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return;

        const file = url.pathname.split('/').pop()?.toLowerCase() || '';
        if (url.pathname === window.location.pathname && url.hash) return;
        if (['about.html', 'mentores.html', 'help.html', 'contact.html'].includes(file)) {
            url.searchParams.set('modal', '1');
            event.preventDefault();
            window.location.assign(url.href);
            return;
        }

        if (file === 'feed.html' || file === 'index.html') {
            event.preventDefault();
            try {
                window.parent.location.assign(url.href);
            } catch {
                window.location.assign(url.href);
            }
        }
    });
})();

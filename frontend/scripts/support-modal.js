(() => {
    const page = document.body;
    if (!page || (!page.classList.contains('feed-page') && !document.querySelector('[data-hero-carousel]'))) return;

    const routes = new Map([
        ['about.html', { label: 'Sobre', title: 'Sobre o IMPACTA' }],
        ['mentores.html', { label: 'Mentores', title: 'Mentores do IMPACTA' }],
        ['help.html', { label: 'Ajuda', title: 'Centro de ajuda' }],
        ['contact.html', { label: 'Contacto', title: 'Contacto' }]
    ]);

    const dialog = document.createElement('dialog');
    dialog.className = 'support-modal';
    dialog.setAttribute('aria-label', 'Informações do IMPACTA');

    const header = document.createElement('header');
    header.className = 'support-modal-header';

    const brand = document.createElement('a');
    brand.className = 'brand support-modal-brand';
    brand.href = 'index.html#welcome';
    brand.setAttribute('aria-label', 'Voltar à comunidade');
    brand.innerHTML = '<span class="brand-mark" aria-hidden="true">i</span><span>impacta<span class="brand-period">.</span></span>';

    const nav = document.createElement('nav');
    nav.className = 'support-modal-nav';
    nav.setAttribute('aria-label', 'Informações');
    for (const [file, route] of routes) {
        const link = document.createElement('a');
        link.href = file;
        link.textContent = route.label;
        link.dataset.supportRoute = file;
        nav.append(link);
    }

    const close = document.createElement('button');
    close.className = 'support-modal-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar informações');
    close.textContent = '×';

    const frame = document.createElement('iframe');
    frame.className = 'support-modal-frame';
    frame.title = 'Informações do IMPACTA';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'same-origin';
    frame.addEventListener('load', () => {
        try {
            const embeddedWindow = frame.contentWindow;
            const embeddedDocument = frame.contentDocument;
            const body = embeddedDocument?.body;
            if (!embeddedWindow || !embeddedDocument || !body?.classList.contains('support-page')) return;
            body.classList.add('is-modal-view');
            for (const element of body.children) {
                if (element.matches('header.app-shell-header, footer.site-footer')) {
                    element.style.setProperty('display', 'none', 'important');
                }
            }
            const loadedFile = new URL(embeddedWindow.location.href).pathname.split('/').pop()?.toLowerCase() || '';
            const loadedRoute = routes.get(loadedFile);
            if (loadedRoute) {
                dialog.setAttribute('aria-label', loadedRoute.title);
                nav.querySelectorAll('a').forEach((link) => {
                    if (link.dataset.supportRoute === loadedFile) link.setAttribute('aria-current', 'page');
                    else link.removeAttribute('aria-current');
                });
            }
        } catch { /* O modo modal aplica-se apenas a páginas do mesmo domínio. */ }
    });

    header.append(brand, nav, close);
    dialog.append(header, frame);
    document.body.append(dialog);

    function setRoute(url) {
        const file = url.pathname.split('/').pop()?.toLowerCase() || '';
        const route = routes.get(file);
        if (!route) return false;

        const embeddedUrl = new URL(url.href);
        embeddedUrl.searchParams.set('modal', '1');
        frame.src = embeddedUrl.href;
        dialog.setAttribute('aria-label', route.title);
        nav.querySelectorAll('a').forEach((link) => {
            if (link.dataset.supportRoute === file) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        return true;
    }

    function openRoute(url) {
        if (!setRoute(url)) return;
        if (!dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }
        document.body.classList.add('support-modal-open');
    }

    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
        frame.removeAttribute('src');
        document.body.classList.remove('support-modal-open');
    });

    document.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const link = event.target.closest('a[href]');
        if (!(link instanceof HTMLAnchorElement)) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || !routes.has(url.pathname.split('/').pop()?.toLowerCase() || '')) return;
        event.preventDefault();
        openRoute(url);
    });
})();

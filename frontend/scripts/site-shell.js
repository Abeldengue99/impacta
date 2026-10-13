document.querySelectorAll('[data-smart-back]').forEach((link) => {
    link.addEventListener('click', (event) => {
        if (window.history.length < 2 || !document.referrer) return;
        try {
            const previousPage = new URL(document.referrer);
            if (previousPage.origin !== window.location.origin) return;
            event.preventDefault();
            window.history.back();
        } catch {
            // Keep the page-specific fallback destination.
        }
    });
});

document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const brand = event.target.closest('a.brand');
    if (!brand) return;
    const destination = new URL(brand.href, window.location.href);
    if (destination.origin !== window.location.origin
        || destination.pathname !== window.location.pathname
        || destination.search !== window.location.search
        || destination.hash) return;
    event.preventDefault();
    window.location.reload();
});

(() => {
    const oldHeader = document.querySelector('header.app-shell-header');
    if (!oldHeader) return;
    const getMessageLinks = () => [...document.querySelectorAll('[data-direct-message-link]')];
    const updateMessageBadges = async () => {
        const messageLinks = getMessageLinks();
        if (!window.ImpactaAPI || !messageLinks.length) return;
        try {
            const summary = await window.ImpactaAPI.request('/direct-messages/summary');
            const unread = Math.max(0, Number(summary?.unread_count) || 0);
            const requests = Math.max(0, Number(summary?.request_count) || 0);
            const total = unread + requests;
            messageLinks.forEach((link) => {
                const badge = link.querySelector('[data-direct-message-badge]');
                if (badge) {
                    badge.textContent = total > 99 ? '99+' : String(total);
                    badge.hidden = total === 0;
                }
                link.setAttribute('aria-label', total
                    ? `Mensagens, ${unread} por ler e ${requests} pedidos`
                    : 'Mensagens');
            });
        } catch { /* Keep the messages shortcut available when the count cannot load. */ }
    };
    if (document.body.classList.contains('feed-page')) return;
    if (document.body.classList.contains('support-page')) {
        const callout = document.querySelector('.about-callout[data-hide-for-authenticated]');
        const communityLinks = [...document.querySelectorAll('[data-support-community-link]')];
        if (!callout || !communityLinks.length) return;
        const publicUrl = communityLinks[0].dataset.publicHref || 'index.html#welcome';
        const cachedPreview = window.ImpactaAPI?.cachedAvatarPreview?.();
        if (!window.ImpactaAPI) {
            callout.hidden = true;
            communityLinks.forEach((link) => { link.href = link.dataset.authenticatedHref || 'feed.html'; });
            return;
        }
        const accountState = window.ImpactaAPI.currentSession()
            .then((session) => ({
                known: true,
                authenticated: Boolean(session?.authenticated && session.user)
            }))
            .catch(() => ({ known: false, authenticated: Boolean(cachedPreview) }));
        let resolved = false;
        void accountState.then(({ known, authenticated }) => {
            resolved = true;
            callout.hidden = !known || authenticated;
            communityLinks.forEach((link) => {
                link.href = authenticated || !known
                    ? (link.dataset.authenticatedHref || 'feed.html')
                    : (link.dataset.publicHref || publicUrl);
            });
        });
        communityLinks.forEach((link) => {
            link.addEventListener('click', (event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (resolved) return;
                event.preventDefault();
                void accountState.then(({ known, authenticated }) => {
                    const destination = authenticated || !known
                        ? (link.dataset.authenticatedHref || 'feed.html')
                        : (link.dataset.publicHref || publicUrl);
                    window.location.assign(new URL(destination, window.location.href).href);
                });
            });
        });
        return;
    }
    const isAdminPage = /\/admin\//.test(window.location.pathname);
    const relative = (path) => `${isAdminPage ? '../' : ''}${path}`;
    const feedUrl = relative('feed.html');
    const visitorWelcomeUrl = relative('index.html#welcome');
    let authenticated = false;
    const gateFeedLinksForVisitors = (container) => {
        container.querySelectorAll('a[href]').forEach((link) => {
            const target = link.getAttribute('href') || '';
            if (!target.startsWith(feedUrl)) return;
            link.dataset.authenticatedFeedHref = target;
            link.href = visitorWelcomeUrl;
        });
    };
    const adminUrl = isAdminPage ? 'index.html#overview' : relative('admin/index.html#reports');
    const backLink = oldHeader.querySelector('[data-smart-back], [data-admin-profile-link]');
    if (backLink?.getAttribute('href')?.startsWith(feedUrl)) {
        backLink.dataset.authenticatedFeedHref = backLink.getAttribute('href');
        backLink.href = visitorWelcomeUrl;
    }
    const adminMenu = oldHeader.querySelector('.admin-menu-toggle');
    const adminTitle = oldHeader.querySelector('#admin-current-title');

    const header = document.createElement('header');
    header.className = 'feed-header app-shell-header';
    header.dataset.authState = 'pending';
    const brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = visitorWelcomeUrl;
    brand.dataset.authenticatedFeedHref = feedUrl;
    brand.setAttribute('aria-label', 'IMPACTA, in\u00edcio da comunidade');
    brand.innerHTML = '<span class="brand-mark" aria-hidden="true">i</span><span>impacta<span class="brand-period">.</span></span>';

    const searchShell = document.createElement('div');
    searchShell.className = 'feed-search-shell';
    const searchForm = document.createElement('form');
    searchForm.className = 'feed-search';
    searchForm.setAttribute('role', 'search');
    searchForm.setAttribute('aria-label', 'Pesquisar publicações na comunidade IMPACTA');
    searchForm.innerHTML = `
        <button class="feed-search-scope" type="button" aria-label="Escolher categoria de publicação">Todas as publicações<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button>
        <input type="search" name="q" placeholder="Pesquisar publicações no IMPACTA" aria-label="Pesquisar publicações no IMPACTA">
        <button class="feed-search-action" type="submit" aria-label="Pesquisar no IMPACTA"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></button>
        <button class="feed-search-action" type="button" aria-label="Filtrar publicações"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg></button>`;
    const searchInput = searchForm.querySelector('input');
    searchInput.value = new URLSearchParams(window.location.search).get('q') || '';
    searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = searchInput.value.trim();
        const destination = new URL(authenticated ? feedUrl : visitorWelcomeUrl, window.location.href);
        if (authenticated && query) destination.searchParams.set('q', query);
        window.location.assign(destination.href);
    });
    const openFilters = () => {
        if (!authenticated) {
            window.location.assign(visitorWelcomeUrl);
            return;
        }
        const params = new URLSearchParams({ filters: '1' });
        if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
        window.location.assign(`${feedUrl}?${params.toString()}`);
    };
    searchForm.querySelector('.feed-search-scope').addEventListener('click', openFilters);
    searchForm.querySelector('[aria-label="Filtrar publicações"]').addEventListener('click', openFilters);
    searchShell.append(searchForm);

    const topNav = document.createElement('nav');
    topNav.className = 'feed-top-nav';
    topNav.setAttribute('aria-label', 'Navega\u00e7\u00e3o da comunidade');
    topNav.innerHTML = `
        <a class="icon-nav-link" href="${feedUrl}#feed" aria-label="In\u00edcio" data-tooltip="In\u00edcio"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9M9.5 20v-6h5v6"/></svg><span class="visually-hidden icon-nav-label">In\u00edcio</span></a>
        <a class="icon-nav-link" href="${feedUrl}#desafios" aria-label="Desafios" data-tooltip="Desafios"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M5 5l14 14M19 5 5 19"/></svg><span class="visually-hidden icon-nav-label">Desafios</span></a>
        <a class="icon-nav-link" href="${feedUrl}#projetos" aria-label="Projectos" data-tooltip="Projectos"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19 19 5M8 5h11v11"/></svg><span class="visually-hidden icon-nav-label">Projectos</span></a>
        <a class="icon-nav-link" data-direct-message-link href="${relative('messages.html')}" aria-label="Mensagens" data-tooltip="Mensagens" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.5 11.5a8.3 8.3 0 0 1-8.5 8.2 9 9 0 0 1-3.8-.8L3 20l1.2-4.1A8 8 0 0 1 3.5 12 8.3 8.3 0 0 1 12 3.8a8.3 8.3 0 0 1 8.5 7.7Z"/><path d="M7.5 11.5h9M7.5 15h6"/></svg><span class="notification-badge" data-direct-message-badge hidden></span><span class="visually-hidden icon-nav-label">Mensagens</span></a>
        <a class="icon-nav-link" id="feed-admin-link" href="${adminUrl}" aria-label="Administra\u00e7\u00e3o" data-tooltip="Administra\u00e7\u00e3o" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></svg><span class="visually-hidden icon-nav-label">Administra\u00e7\u00e3o</span></a>
        <a class="icon-nav-link" id="feed-notifications-toggle" href="${feedUrl}#notifications" aria-label="Notifica\u00e7\u00f5es" data-tooltip="Notifica\u00e7\u00f5es" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="notification-badge" id="feed-notifications-badge" hidden></span><span class="visually-hidden icon-nav-label">Notifica\u00e7\u00f5es</span></a>`;
    gateFeedLinksForVisitors(topNav);

    const headerActions = document.createElement('div');
    headerActions.className = 'feed-header-actions';
    if (backLink) {
        backLink.classList.add('shell-back-link');
        if (backLink.hasAttribute('data-admin-profile-link')) {
            const label = backLink.querySelector('.admin-profile-link-label') || document.createElement('span');
            label.className = 'admin-profile-link-label';
            if (!label.textContent.trim()) label.textContent = 'O meu perfil';
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            arrow.setAttribute('aria-hidden', 'true');
            arrow.setAttribute('viewBox', '0 0 24 24');
            arrow.innerHTML = '<path d="m14.5 5-7 7 7 7M8 12h12"/>';
            backLink.replaceChildren(arrow, label);
        }
        headerActions.append(backLink);
    }

    if (adminMenu) {
        adminMenu.classList.add('feed-menu-toggle');
        adminMenu.replaceChildren();
        adminMenu.insertAdjacentHTML('beforeend', '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>');
        headerActions.append(adminMenu);
    }
    if (adminTitle) headerActions.append(adminTitle);

    const loginLink = document.createElement('span');
    loginLink.className = 'user-chip account-state-placeholder';
    loginLink.setAttribute('aria-hidden', 'true');
    headerActions.append(loginLink);

    let menuToggle = adminMenu;
    let mobileMenu = null;
    if (!isAdminPage) {
        menuToggle = document.createElement('button');
        menuToggle.className = 'feed-menu-toggle';
        menuToggle.type = 'button';
        menuToggle.setAttribute('aria-label', 'Abrir menu');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-controls', 'feed-mobile-menu');
        menuToggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

        mobileMenu = document.createElement('nav');
        mobileMenu.className = 'feed-mobile-menu';
        mobileMenu.setAttribute('aria-label', 'Menu da comunidade');
        mobileMenu.hidden = true;
        mobileMenu.innerHTML = `
            <a href="${feedUrl}#feed"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9M9.5 20v-6h5v6"/></svg>In\u00edcio</a>
            <a href="${feedUrl}#desafios"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M5 5l14 14M19 5 5 19"/></svg>Desafios</a>
            <a href="${feedUrl}#projetos"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19 19 5M8 5h11v11"/></svg>Projectos</a>
            <a data-direct-message-link href="${relative('messages.html')}" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.5 11.5a8.3 8.3 0 0 1-8.5 8.2 9 9 0 0 1-3.8-.8L3 20l1.2-4.1A8 8 0 0 1 3.5 12 8.3 8.3 0 0 1 12 3.8a8.3 8.3 0 0 1 8.5 7.7Z"/><path d="M7.5 11.5h9M7.5 15h6"/></svg><span>Mensagens</span></a>
            <a id="feed-mobile-admin-link" href="${adminUrl}" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></svg>Administra\u00e7\u00e3o</a>
            <a href="${feedUrl}#comunidades"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/></svg>Comunidades</a>
            <span class="feed-menu-divider" aria-hidden="true"></span>
            <a id="feed-mobile-account-link" href="${relative('index.html#login')}" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg><span>Entrar</span></a>
            <button class="feed-mobile-logout" id="feed-mobile-logout" type="button" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg><span>Terminar sess\u00e3o</span></button>`;
        gateFeedLinksForVisitors(mobileMenu);
        menuToggle.addEventListener('click', () => {
            const opening = mobileMenu.hidden;
            mobileMenu.hidden = !opening;
            menuToggle.setAttribute('aria-expanded', String(opening));
            menuToggle.setAttribute('aria-label', opening ? 'Fechar menu' : 'Abrir menu');
        });
        mobileMenu.addEventListener('click', (event) => {
            if (!event.target.closest('a')) return;
            mobileMenu.hidden = true;
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Abrir menu');
        });
    }

    header.append(brand, searchShell, topNav, headerActions);
    if (!isAdminPage) header.append(menuToggle, mobileMenu);
    oldHeader.replaceWith(header);

    const directMessageShortcut = topNav.querySelector('[data-direct-message-link]');
    const messageShortcutViewport = window.matchMedia('(max-width: 760px)');
    const placeDirectMessageShortcut = () => {
        if (!directMessageShortcut) return;
        if (messageShortcutViewport.matches) {
            const notificationShortcut = headerActions.querySelector('#feed-notifications-toggle');
            const accountShortcut = headerActions.querySelector('.profile-chip, .account-state-placeholder, .user-chip');
            headerActions.insertBefore(directMessageShortcut, notificationShortcut || accountShortcut || headerActions.firstChild);
            return;
        }
        if (directMessageShortcut.parentElement !== topNav) {
            const adminShortcut = topNav.querySelector('#feed-admin-link');
            const notificationShortcut = topNav.querySelector('#feed-notifications-toggle');
            topNav.insertBefore(directMessageShortcut, adminShortcut || notificationShortcut || null);
        }
    };
    placeDirectMessageShortcut();
    messageShortcutViewport.addEventListener('change', placeDirectMessageShortcut);

    const cachedAvatar = window.ImpactaAPI?.cachedAvatarPreview();
    if (cachedAvatar) {
        const cachedChip = document.createElement('a');
        cachedChip.className = 'user-chip profile-chip';
        cachedChip.href = relative('profile.html');
        cachedChip.setAttribute('aria-label', 'Abrir o teu perfil');
        cachedChip.dataset.tooltip = 'O teu perfil';
        cachedChip.dataset.avatarUserId = cachedAvatar.userId;
        cachedChip.dataset.avatarUrl = cachedAvatar.avatarUrl;
        const image = document.createElement('img');
        image.src = cachedAvatar.dataUrl;
        image.alt = '';
        image.decoding = 'sync';
        cachedChip.append(image);
        loginLink.replaceWith(cachedChip);
    }

    const existingFooter = [...document.body.children].find((child) => child.tagName === 'FOOTER');
    const footer = existingFooter || document.createElement('footer');
    footer.className = isAdminPage ? 'site-footer admin-footer' : 'site-footer';

    const footerBrand = document.createElement('a');
    footerBrand.className = 'brand brand-footer';
    footerBrand.href = relative('index.html');
    footerBrand.setAttribute('aria-label', 'IMPACTA, p\u00e1gina inicial');
    footerBrand.innerHTML = '<span class="brand-mark" aria-hidden="true">i</span><span>impacta<span class="brand-period">.</span></span>';

    const footerTagline = document.createElement('p');
    footerTagline.textContent = 'Aprende. Colabora. Impacta.';

    const footerLinks = document.createElement('nav');
    footerLinks.className = 'site-footer-links';
    footerLinks.id = 'site-footer-links';
    footerLinks.setAttribute('aria-label', 'Informa\u00e7\u00f5es e contactos');

    const footerCopyright = document.createElement('span');
    footerCopyright.append(document.createTextNode('\u00a9 '));
    const footerYear = document.createElement('span');
    footerYear.textContent = '2026';
    footerCopyright.append(footerYear, document.createTextNode(' IMPACTA'));

    const adminStatus = isAdminPage ? document.createElement('span') : null;
    if (adminStatus) {
        adminStatus.id = 'admin-footer-status';
        adminStatus.textContent = 'A carregar estado da plataforma...';
    }

    const setFooterLinks = (authenticated) => {
        const contactLinks = [
            ['LinkedIn', 'https://www.linkedin.com/company/impacta-angola/', 'external'],
            ['E-mail', 'mailto:impactaa2025@gmail.com', 'email']
        ];
        const links = authenticated
            ? [['Ajuda', relative('help.html')], ['Mentores', relative('mentores.html')], ...contactLinks]
            : [
                ['Sobre o IMPACTA', relative('about.html')],
                ['Mentores', relative('mentores.html')],
                ['Ajuda', relative('help.html')],
                ['Contacto', relative('contact.html')],
                ...contactLinks
            ];
        footerLinks.replaceChildren();
        links.forEach(([label, href, type], index) => {
            if (index) {
                const separator = document.createElement('span');
                separator.setAttribute('aria-hidden', 'true');
                separator.textContent = '\u00b7';
                footerLinks.append(separator);
            }
            const link = document.createElement('a');
            link.href = href;
            link.textContent = label;
            if (type === 'external') {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            if (type === 'email') link.setAttribute('aria-label', 'Enviar e-mail para impactaa2025@gmail.com');
            if (authenticated && label === 'Ajuda') link.className = 'feed-help-button';
            footerLinks.append(link);
        });
    };
    const showPublicLinks = () => setFooterLinks(false);
    const showHelpOnly = () => setFooterLinks(true);

    footer.replaceChildren(footerBrand, footerTagline, footerLinks, footerCopyright);
    if (adminStatus) footer.append(adminStatus);
    showPublicLinks();
    if (!existingFooter) document.body.append(footer);

    const loadAccountShell = async () => {
        if (!window.ImpactaAPI) {
            header.dataset.authState = 'unavailable';
            return;
        }
        try {
            const session = await window.ImpactaAPI.currentSession();
            if (!session?.authenticated || !session.user) {
                header.dataset.authState = 'anonymous';
                window.ImpactaAPI.clearAvatarPreview();
                headerActions.querySelector('.profile-chip')?.remove();
                const visitorLogin = document.createElement('a');
                visitorLogin.className = 'user-chip';
                visitorLogin.href = relative('index.html#login');
                visitorLogin.textContent = 'Entrar';
                visitorLogin.setAttribute('aria-label', 'Entrar');
                if (loginLink.isConnected) loginLink.replaceWith(visitorLogin);
                else headerActions.prepend(visitorLogin);
                const mobileAccount = header.querySelector('#feed-mobile-account-link');
                if (mobileAccount) mobileAccount.hidden = false;
                return;
            }

            authenticated = true;
            header.dataset.authState = 'authenticated';
            header.querySelectorAll('[data-authenticated-feed-href]').forEach((link) => {
                link.href = link.dataset.authenticatedFeedHref;
                link.removeAttribute('data-authenticated-feed-href');
            });
            const user = session.user;
            header.querySelectorAll('[data-direct-message-link]').forEach((link) => { link.hidden = false; });
            void updateMessageBadges();
            window.setInterval(() => { void updateMessageBadges(); }, 30000);
            const avatar = headerActions.querySelector('.profile-chip') || document.createElement('a');
            avatar.className = 'user-chip profile-chip';
            avatar.href = relative('profile.html');
            avatar.dataset.tooltip = 'O teu perfil';
            if (loginLink.isConnected) loginLink.remove();
            if (!avatar.isConnected) headerActions.append(avatar);
            renderShellAvatar(avatar, user);

            const leaveForVisitorPage = async (button) => {
                button.disabled = true;
                try { await window.ImpactaAPI.delete('/auth/session'); }
                catch { /* Continue to the public landing page even if the session request fails. */ }
                window.ImpactaAPI.clearAvatarPreview();
                window.location.assign(relative('index.html'));
            };

            const logout = document.createElement('button');
            logout.className = 'logout-button';
            logout.type = 'button';
            logout.textContent = 'Sair';
            logout.addEventListener('click', () => { void leaveForVisitorPage(logout); });
            headerActions.append(logout);
            showHelpOnly();

            const mobileAccount = header.querySelector('#feed-mobile-account-link');
            if (mobileAccount) {
                mobileAccount.href = relative('profile.html');
                const mobileAccountLabel = mobileAccount.querySelector('span');
                if (mobileAccountLabel) mobileAccountLabel.textContent = 'O teu perfil';
                mobileAccount.setAttribute('aria-label', `Abrir perfil de ${user.displayName || 'utilizador'}`);
                mobileAccount.hidden = false;
            }
            const mobileLogout = header.querySelector('#feed-mobile-logout');
            mobileLogout?.addEventListener('click', () => { void leaveForVisitorPage(mobileLogout); });
            if (mobileLogout) mobileLogout.hidden = false;

            void window.ImpactaAPI.request('/profile').then((result) => {
                const profileUser = { ...user, ...result.profile };
                renderShellAvatar(avatar, profileUser);
            }).catch(() => { /* The name-based avatar remains available without profile details. */ });

            const notificationLink = header.querySelector('#feed-notifications-toggle');
            if (notificationLink) notificationLink.hidden = false;
            try {
                const notifications = await window.ImpactaAPI.request('/notifications');
                const badge = header.querySelector('#feed-notifications-badge');
                if (badge && Number(notifications?.unreadCount) > 0) {
                    badge.textContent = notifications.unreadCount > 99 ? '99+' : String(notifications.unreadCount);
                    badge.hidden = false;
                }
            } catch { /* The notification shortcut remains available without its unread count. */ }

            try {
                const access = await window.ImpactaAPI.request('/admin/access');
                const canAdmin = [access?.canManageReports, access?.canModerate,
                    access?.canManageCommunities, access?.canReviewProjects, access?.canVerifyAccounts].some((allowed) => allowed === true);
                header.querySelectorAll('#feed-admin-link, #feed-mobile-admin-link').forEach((link) => {
                    link.hidden = !canAdmin;
                });
            } catch { /* Keep admin navigation hidden without confirmed permissions. */ }
        } catch {
            header.dataset.authState = 'unavailable';
        }
    };

    function initials(name) {
        return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
            .map((part) => part[0]).join('').toLocaleUpperCase('pt') || 'I';
    }

    function renderShellAvatar(avatar, user) {
        const userId = String(user.id || '');
        const avatarUrl = user.avatarUrl || '';
        avatar.setAttribute('aria-label', `Abrir perfil de ${user.displayName || 'utilizador'}`);
        const cached = window.ImpactaAPI.cachedAvatarPreview();
        if (cached?.userId === userId && (!avatarUrl || cached.avatarUrl === avatarUrl)) {
            if (avatar.dataset.avatarUserId === userId && avatar.dataset.avatarUrl === cached.avatarUrl
                && avatar.querySelector('img')) return;
            avatar.dataset.avatarUserId = userId;
            avatar.dataset.avatarUrl = cached.avatarUrl;
            const image = document.createElement('img');
            image.src = cached.dataUrl;
            image.alt = '';
            image.decoding = 'sync';
            avatar.replaceChildren(image);
            return;
        }

        if (avatar.dataset.avatarUserId && avatar.dataset.avatarUserId !== userId) {
            avatar.replaceChildren();
            avatar.textContent = initials(user.displayName);
        } else if (!avatar.querySelector('img')) {
            avatar.textContent = initials(user.displayName);
        }
        avatar.dataset.avatarUserId = userId;
        if (!avatarUrl) return;
        if (avatar.dataset.avatarUrl === avatarUrl && avatar.querySelector('img')) return;
        avatar.dataset.avatarUrl = avatarUrl;
        void window.ImpactaAPI.loadAvatarPreview(userId, avatarUrl).then((dataUrl) => {
            if (!dataUrl || !avatar.isConnected || avatar.dataset.avatarUserId !== userId
                || avatar.dataset.avatarUrl !== avatarUrl) return;
            const image = document.createElement('img');
            image.src = dataUrl;
            image.alt = '';
            image.decoding = 'sync';
            avatar.replaceChildren(image);
        });
    }

    void loadAccountShell();
})();
void (async () => {
    if (/\/admin\//.test(window.location.pathname) || !window.ImpactaAPI) return;
    try {
        const state = await window.ImpactaAPI.request('/site/status');
        if (state?.maintenance !== true) return;
        const screen = document.createElement('main');
        screen.className = 'site-maintenance-screen';
        screen.setAttribute('role', 'main');
        const card = document.createElement('section');
        card.className = 'site-maintenance-card';
        const brand = document.createElement('span');
        brand.className = 'site-maintenance-brand';
        brand.textContent = 'impacta.';
        const title = document.createElement('h1');
        title.textContent = 'Estamos a preparar o IMPACTA.';
        const message = document.createElement('p');
        message.textContent = String(state.message || 'A plataforma está temporariamente em manutenção. Voltamos em breve.');
        const adminLink = document.createElement('a');
        adminLink.className = 'site-maintenance-admin-link';
        adminLink.href = new URL('admin/index.html', window.location.href).href;
        adminLink.textContent = 'Acesso administrativo';
        card.append(brand, title, message, adminLink);
        screen.append(card);
        document.body.classList.add('is-maintenance-mode');
        document.body.prepend(screen);
    } catch {
        // The maintenance screen is optional while the API is unreachable.
    }
})();

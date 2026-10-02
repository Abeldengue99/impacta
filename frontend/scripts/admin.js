(() => {
    const sidebar = document.querySelector('#admin-sidebar');
    const menuToggle = document.querySelector('.admin-menu-toggle');
    const navLinks = [...document.querySelectorAll('[data-admin-nav]')];
    const views = [...document.querySelectorAll('[data-admin-view]')];
    const currentTitle = document.querySelector('#admin-current-title');
    const description = document.querySelector('#admin-description');
    const viewDescriptions = {
        overview: 'Acompanhe a atividade e as decisões que mantêm a comunidade segura.',
        users: 'Consulte contas e aplique ações permitidas com histórico e motivo.',
        roles: 'Controle cada acesso por permissão e âmbito de recurso.',
        communities: 'Acompanhe espaços colaborativos e as respetivas equipas.',
        projects: 'Reveja projetos, desafios e participação da comunidade.',
        moderation: 'Trate conteúdo sinalizado com decisões proporcionais e rastreáveis.',
        reports: 'Organize denúncias e recursos num fluxo de revisão claro.',
        announcements: 'Prepare comunicações da plataforma com público e datas validados.',
        recognition: 'Reconheça contribuições mantendo o histórico dos pontos.',
        privacy: 'Acompanhe pedidos pessoais com acesso estritamente limitado.',
        audit: 'Consulte ações administrativas autorizadas e respetivos motivos.',
        security: 'Acompanhe MFA, sessões e ações de segurança privilegiadas.',
        settings: 'Gira definições não secretas e mantenha as alterações auditáveis.'
    };

    const selectView = (name, updateAddress) => {
        const link = navLinks.find((item) => item.dataset.adminNav === name) || navLinks[0];
        const selected = link.dataset.adminNav;
        navLinks.forEach((item) => {
            if (item === link) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        views.forEach((view) => { view.hidden = view.dataset.adminView !== selected; });
        currentTitle.textContent = link.textContent.trim();
        description.textContent = viewDescriptions[selected];
        if (updateAddress && window.location.hash !== '#' + selected) {
            window.history.replaceState(null, '', '#' + selected);
        }
        sidebar.classList.remove('is-open');
        menuToggle?.setAttribute('aria-expanded', 'false');
        menuToggle?.setAttribute('aria-label', 'Abrir navegação');
    };

    navLinks.forEach((link) => link.addEventListener('click', () => selectView(link.dataset.adminNav, true)));
    menuToggle?.addEventListener('click', () => {
        const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
        menuToggle.setAttribute('aria-expanded', String(!isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Abrir navegação' : 'Fechar navegação');
        sidebar.classList.toggle('is-open', !isOpen);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
            sidebar.classList.remove('is-open');
            menuToggle?.setAttribute('aria-expanded', 'false');
            menuToggle?.setAttribute('aria-label', 'Abrir navegação');
            menuToggle?.focus();
        }
    });

    const initialView = window.location.hash.slice(1);
    selectView(views.some((view) => view.dataset.adminView === initialView) ? initialView : 'overview', false);
})();

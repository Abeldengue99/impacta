(() => {
    const installScrollNavigation = () => {
        if (!document.body || document.querySelector('.scroll-navigation')) return;

        const navigation = document.createElement('div');
        navigation.className = 'scroll-navigation';
        navigation.setAttribute('role', 'group');
        navigation.setAttribute('aria-label', 'Navegação da página');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'scroll-navigation__button';
        button.disabled = true;

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        icon.append(path);
        button.append(icon);
        button.addEventListener('click', () => {
            const root = document.scrollingElement || document.documentElement;
            const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
            const currentScroll = Math.max(window.scrollY, root.scrollTop);
            const goToBottom = currentScroll < maxScroll / 2;
            window.scrollTo({
                top: goToBottom ? maxScroll : 0,
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            });
        });
        navigation.append(button);
        document.body.append(navigation);

        let updateQueued = false;
        const update = () => {
            if (updateQueued) return;
            updateQueued = true;
            window.requestAnimationFrame(() => {
                updateQueued = false;
                const root = document.scrollingElement || document.documentElement;
                const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
                const currentScroll = Math.max(window.scrollY, root.scrollTop);
                const goToBottom = currentScroll < maxScroll / 2;
                const label = goToBottom ? 'Descer para o fim' : 'Subir para o início';

                navigation.hidden = maxScroll < 100;
                button.disabled = maxScroll < 100;
                button.setAttribute('aria-label', label);
                button.title = label;
                path.setAttribute('d', goToBottom ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6');
            });
        };

        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        window.addEventListener('load', update, { once: true });
        if ('ResizeObserver' in window) {
            const observer = new ResizeObserver(update);
            observer.observe(document.documentElement);
            observer.observe(document.body);
        }
        update();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installScrollNavigation, { once: true });
    } else {
        installScrollNavigation();
    }
})();

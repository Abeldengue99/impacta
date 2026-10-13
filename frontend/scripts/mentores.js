(() => {
    const carousel = document.querySelector('[data-founders-carousel]');
    if (!carousel) return;

    const slides = [...carousel.querySelectorAll('[data-founder-slide]')];
    const indicators = [...carousel.querySelectorAll('[data-founder-indicator]')];
    const count = carousel.querySelector('[data-founder-count]');
    const status = carousel.querySelector('[data-founder-status]');
    const toggle = carousel.querySelector('[data-founder-toggle]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const saveData = Boolean(connection?.saveData) || /^(slow-)?2g$/i.test(connection?.effectiveType || '');
    if (!slides.length) return;

    let activeIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
    let autoRotate = !reducedMotion.matches && !saveData && slides.length > 1;
    let timer = null;
    let pointerInside = false;
    let focusInside = false;
    let inView = true;

    const updateToggle = () => {
        if (!toggle) return;
        const paused = !autoRotate;
        toggle.setAttribute('aria-pressed', String(paused));
        toggle.setAttribute('aria-label', paused ? 'Iniciar apresentação automática' : 'Pausar apresentação automática');
        toggle.querySelector('span').textContent = paused ? '▶' : 'Ⅱ';
    };

    const clearTimer = () => {
        if (!timer) return;
        window.clearTimeout(timer);
        timer = null;
    };

    const schedule = () => {
        clearTimer();
        if (!autoRotate || document.hidden || !inView || pointerInside || focusInside) return;
        timer = window.setTimeout(() => show(activeIndex + 1), 7600);
    };

    function show(index) {
        activeIndex = (index + slides.length) % slides.length;
        slides.forEach((slide, position) => {
            const active = position === activeIndex;
            slide.classList.toggle('is-active', active);
            slide.setAttribute('aria-hidden', String(!active));
            slide.toggleAttribute('inert', !active);
        });
        indicators.forEach((indicator, position) => {
            if (position === activeIndex) indicator.setAttribute('aria-current', 'true');
            else indicator.removeAttribute('aria-current');
        });
        if (count) count.textContent = String(activeIndex + 1).padStart(2, '0');
        if (status) status.textContent = `Apresentação ${activeIndex + 1} de ${slides.length}`;
        schedule();
    }

    carousel.querySelector('[data-founder-previous]')?.addEventListener('click', () => show(activeIndex - 1));
    carousel.querySelector('[data-founder-next]')?.addEventListener('click', () => show(activeIndex + 1));
    indicators.forEach((indicator) => indicator.addEventListener('click', () => show(Number(indicator.dataset.founderIndicator))));
    toggle?.addEventListener('click', () => {
        autoRotate = !autoRotate;
        updateToggle();
        schedule();
    });
    carousel.addEventListener('pointerenter', () => { pointerInside = true; clearTimer(); });
    carousel.addEventListener('pointerleave', () => { pointerInside = false; schedule(); });
    carousel.addEventListener('focusin', () => { focusInside = true; clearTimer(); });
    carousel.addEventListener('focusout', (event) => {
        if (carousel.contains(event.relatedTarget)) return;
        focusInside = false;
        schedule();
    });
    document.addEventListener('visibilitychange', schedule);

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            if (inView) schedule();
            else clearTimer();
        }, { threshold: 0.18 });
        observer.observe(carousel);
    }

    updateToggle();
    show(activeIndex);
})();
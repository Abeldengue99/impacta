const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
const siteHeader = document.querySelector('.site-header');

if (siteHeader) {
    let headerUpdateQueued = false;
    const updateHeaderState = () => {
        siteHeader.classList.toggle('is-scrolled', window.scrollY > 24);
        headerUpdateQueued = false;
    };

    window.addEventListener('scroll', () => {
        if (headerUpdateQueued) return;
        headerUpdateQueued = true;
        window.requestAnimationFrame(updateHeaderState);
    }, { passive: true });
    updateHeaderState();
}

if (menuToggle && siteNav) {
    menuToggle.addEventListener('click', () => {
        const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
        menuToggle.setAttribute('aria-expanded', String(!isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
        siteNav.classList.toggle('is-open', !isOpen);
    });

    siteNav.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Abrir menu');
            siteNav.classList.remove('is-open');
        }
    });
}

const hero = document.querySelector('.hero');
const heroVideo = hero?.querySelector('.hero-video');
const heroVideoSource = heroVideo?.querySelector('source[data-src]');
const reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const networkConnection = navigator.connection;
const slowOrMeteredConnection = networkConnection?.saveData
    || ['slow-2g', '2g', '3g'].includes(networkConnection?.effectiveType);
const narrowScreen = window.matchMedia('(max-width: 720px)').matches;

if (hero && heroVideo && heroVideoSource && !reducedMotionPreference.matches && !slowOrMeteredConnection && !narrowScreen) {
    let videoRequested = false;

    const startHeroVideo = () => {
        if (videoRequested || document.hidden || !heroVideoSource.dataset.src) return;
        videoRequested = true;
        heroVideoSource.src = heroVideoSource.dataset.src;
        heroVideo.load();

        heroVideo.play().catch(() => {
            heroVideo.removeAttribute('src');
            heroVideoSource.removeAttribute('src');
            heroVideo.load();
            videoRequested = false;
        });
    };

    heroVideo.addEventListener('playing', () => hero.classList.add('is-video-ready'), { once: true });
    heroVideo.addEventListener('error', () => hero.classList.remove('is-video-ready'));
    reducedMotionPreference.addEventListener('change', (event) => {
        if (!event.matches) return;
        heroVideo.pause();
        heroVideo.removeAttribute('src');
        heroVideoSource.removeAttribute('src');
        heroVideo.load();
        hero.classList.remove('is-video-ready');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) heroVideo.pause();
        else if (videoRequested && !reducedMotionPreference.matches) heroVideo.play().catch(() => undefined);
        else if (!videoRequested && hero.getBoundingClientRect().bottom > 0) startHeroVideo();
    });

    if ('IntersectionObserver' in window) {
        const heroVideoObserver = new IntersectionObserver((entries, observer) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            window.setTimeout(startHeroVideo, 900);
        }, { threshold: 0.08 });
        heroVideoObserver.observe(hero);
    } else {
        window.setTimeout(startHeroVideo, 1500);
    }
}

const impactCarousel = document.querySelector('[data-carousel]');

if (impactCarousel) {
    const slides = [...impactCarousel.querySelectorAll('.carousel-slide')];
    const indicators = [...impactCarousel.querySelectorAll('[data-carousel-indicator]')];
    const previousButton = impactCarousel.querySelector('[data-carousel-previous]');
    const nextButton = impactCarousel.querySelector('[data-carousel-next]');
    const toggleButton = impactCarousel.querySelector('[data-carousel-toggle]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let currentSlide = 0;
    let rotationTimer;
    let isPaused = prefersReducedMotion.matches;

    const showSlide = (index) => {
        currentSlide = (index + slides.length) % slides.length;
        slides.forEach((slide, slideIndex) => {
            slide.classList.toggle('is-active', slideIndex === currentSlide);
        });
        indicators.forEach((indicator, slideIndex) => {
            if (slideIndex === currentSlide) indicator.setAttribute('aria-current', 'true');
            else indicator.removeAttribute('aria-current');
        });
    };

    const stopRotation = () => {
        window.clearInterval(rotationTimer);
        rotationTimer = undefined;
    };

    const startRotation = () => {
        if (isPaused || document.hidden || rotationTimer) return;
        rotationTimer = window.setInterval(() => showSlide(currentSlide + 1), 6500);
    };

    previousButton?.addEventListener('click', () => showSlide(currentSlide - 1));
    nextButton?.addEventListener('click', () => showSlide(currentSlide + 1));
    indicators.forEach((indicator) => {
        indicator.addEventListener('click', () => showSlide(Number(indicator.dataset.carouselIndicator)));
    });
    toggleButton?.addEventListener('click', () => {
        isPaused = !isPaused;
        toggleButton.setAttribute('aria-pressed', String(isPaused));
        toggleButton.setAttribute('aria-label', isPaused ? 'Retomar carrossel' : 'Pausar carrossel');
        toggleButton.querySelector('span').textContent = isPaused ? '▶' : 'Ⅱ';
        if (isPaused) stopRotation();
        else startRotation();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopRotation();
        else startRotation();
    });

    if (isPaused && toggleButton) {
        toggleButton.setAttribute('aria-pressed', 'true');
        toggleButton.setAttribute('aria-label', 'Retomar carrossel');
        toggleButton.querySelector('span').textContent = '▶';
    } else startRotation();
}
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const revealElements = [...document.querySelectorAll('.hero-copy, .hero-art, .section-heading, .feature-card, .closing-content, .closing-banner > .button')];

if (!motionPreference.matches && 'IntersectionObserver' in window && revealElements.length) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.14, rootMargin: '0px 0px -32px 0px' });

    const featureCards = [...document.querySelectorAll('.feature-card')];
    revealElements.forEach((element) => {
        if (element.classList.contains('feature-card')) {
            element.style.setProperty('--reveal-delay', `${featureCards.indexOf(element) * 110}ms`);
        }
        element.classList.add('motion-reveal');
        revealObserver.observe(element);
    });
}

if (!motionPreference.matches && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.feature-card').forEach((card) => {
        card.addEventListener('pointermove', (event) => {
            const bounds = card.getBoundingClientRect();
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            card.style.setProperty('--pointer-x', `${x}px`);
            card.style.setProperty('--pointer-y', `${y}px`);
            card.style.setProperty('--tilt-x', `${((bounds.height / 2 - y) / bounds.height) * 3}deg`);
            card.style.setProperty('--tilt-y', `${((x - bounds.width / 2) / bounds.width) * 3}deg`);
        }, { passive: true });
    });
}

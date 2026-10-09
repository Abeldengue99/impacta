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

const heroCarousel = document.querySelector('[data-hero-carousel]');

if (heroCarousel) {
    const slides = [...heroCarousel.querySelectorAll('.hero-video-slide')];
    const indicators = [...heroCarousel.querySelectorAll('[data-hero-indicator]')];
    const previousButton = heroCarousel.querySelector('[data-hero-previous]');
    const nextButton = heroCarousel.querySelector('[data-hero-next]');
    const toggleButton = heroCarousel.querySelector('[data-hero-toggle]');
    const copy = heroCarousel.querySelector('[data-hero-copy]');
    const eyebrow = heroCarousel.querySelector('[data-hero-eyebrow]');
    const title = heroCarousel.querySelector('[data-hero-title]');
    const highlight = heroCarousel.querySelector('[data-hero-highlight]');
    const description = heroCarousel.querySelector('[data-hero-description]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let currentSlide = 0;
    let rotationTimer;
    let copyTimer;
    let isPaused = prefersReducedMotion.matches;

    const stopVideos = () => {
        slides.forEach((slide) => slide.querySelector('video')?.pause());
    };

    const playActiveVideo = () => {
        const activeSlide = slides[currentSlide];
        const video = activeSlide?.querySelector('video');
        const source = video?.querySelector('source[data-src]');
        if (!video) return;

        slides.forEach((slide, index) => {
            if (index !== currentSlide) slide.querySelector('video')?.pause();
        });

        if (isPaused || document.hidden) {
            video.pause();
            return;
        }

        if (source && !source.hasAttribute('src') && source.dataset.src) {
            source.src = source.dataset.src;
            video.load();
        }

        video.play().catch(() => undefined);
    };

    const showSlide = (index) => {
        currentSlide = (index + slides.length) % slides.length;
        const activeSlide = slides[currentSlide];

        slides.forEach((slide, slideIndex) => {
            slide.classList.toggle('is-active', slideIndex === currentSlide);
        });
        indicators.forEach((indicator, slideIndex) => {
            if (slideIndex === currentSlide) indicator.setAttribute('aria-current', 'true');
            else indicator.removeAttribute('aria-current');
        });

        if (copy && activeSlide) {
            window.clearTimeout(copyTimer);
            copy.classList.add('is-changing');
            copyTimer = window.setTimeout(() => {
                eyebrow.textContent = activeSlide.dataset.eyebrow || '';
                title.textContent = activeSlide.dataset.title || '';
                highlight.textContent = activeSlide.dataset.highlight || '';
                description.textContent = activeSlide.dataset.description || '';
                copy.classList.remove('is-changing');
            }, 180);
        }

        playActiveVideo();
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
        indicator.addEventListener('click', () => showSlide(Number(indicator.dataset.heroIndicator)));
    });
    toggleButton?.addEventListener('click', () => {
        isPaused = !isPaused;
        toggleButton.setAttribute('aria-pressed', String(isPaused));
        toggleButton.setAttribute('aria-label', isPaused ? 'Retomar carrossel' : 'Pausar carrossel');
        toggleButton.querySelector('span').textContent = isPaused ? '▶' : 'Ⅱ';
        if (isPaused) {
            stopRotation();
            stopVideos();
        } else {
            playActiveVideo();
            startRotation();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopRotation();
            stopVideos();
        } else {
            playActiveVideo();
            startRotation();
        }
    });

    if (isPaused && toggleButton) {
        toggleButton.setAttribute('aria-pressed', 'true');
        toggleButton.setAttribute('aria-label', 'Retomar carrossel');
        toggleButton.querySelector('span').textContent = '▶';
    } else {
        playActiveVideo();
        startRotation();
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
const revealElements = [...document.querySelectorAll('.section-heading, .feature-card, .closing-content, .closing-banner > .button')];

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

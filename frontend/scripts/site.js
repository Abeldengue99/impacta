const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');

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

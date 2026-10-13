const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
const siteHeader = document.querySelector('.site-header');
const siteAnnouncement = document.querySelector('[data-site-announcement]');
let landingSessionAuthenticated = false;

async function syncLandingAccountActions() {
    if (!siteHeader) return;
    if (!window.ImpactaAPI) {
        siteHeader.dataset.authState = 'unavailable';
        return;
    }
    try {
        const session = await window.ImpactaAPI.currentSession();
        if (!session?.authenticated || !session.user) {
            siteHeader.dataset.authState = 'anonymous';
            return;
        }
        landingSessionAuthenticated = true;
        siteHeader.dataset.authState = 'authenticated';

        document.querySelectorAll('.site-header a[data-open-auth="login"]')
            .forEach((link) => { link.hidden = true; });
        document.querySelectorAll('.site-header a[data-open-auth="register"]')
            .forEach((link) => {
                link.href = 'feed.html';
                link.removeAttribute('data-open-auth');
                link.textContent = 'Abrir feed ';
                const arrow = document.createElement('span');
                arrow.setAttribute('aria-hidden', 'true');
                arrow.textContent = '↗';
                link.append(arrow);
            });
        document.querySelectorAll('a[data-open-auth="login"]')
            .forEach((link) => { if (!link.closest('.site-header')) link.hidden = true; });
        document.querySelectorAll('a[data-open-auth="register"]')
            .forEach((link) => {
                if (link.closest('.site-header')) return;
                link.href = 'feed.html';
                link.removeAttribute('data-open-auth');
                const arrow = link.querySelector('[aria-hidden="true"]');
                link.textContent = 'Abrir o feed do IMPACTA ';
                if (arrow) link.append(arrow);
            });

        document.querySelectorAll('[data-visitor-auth-gate][data-authenticated-href]').forEach((link) => {
            link.href = link.dataset.authenticatedHref;
            link.removeAttribute('data-visitor-auth-gate');
            link.removeAttribute('data-open-auth');
        });
    } catch {
        siteHeader.dataset.authState = 'unavailable';
    }
}
const landingAccountActionsReady = syncLandingAccountActions();

if (siteAnnouncement && window.ImpactaAPI) {
    window.ImpactaAPI.request('/site/announcement')
        .then((data) => {
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            if (!message) return;
            siteAnnouncement.textContent = message;
            siteAnnouncement.hidden = false;
        })
        .catch(() => undefined);
}

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

if (heroCarousel && window.ImpactaCarouselMedia) {
    const media = window.ImpactaCarouselMedia;
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
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const prefersDataSaving = Boolean(connection?.saveData)
        || /^(slow-)?2g$/i.test(connection?.effectiveType || '');
    let carouselInView = !('IntersectionObserver' in window);
    let currentSlide = 0;
    let pendingSlide = 0;
    let slideRequest = 0;
    let rotationTimer;
    let copyTimer;
    let isPaused = prefersReducedMotion.matches || prefersDataSaving;
    let videoRequestedForCurrentSlide = false;

    const stopVideos = () => media.pause(slides);

    const playActiveVideo = () => {
        media.activate(slides, currentSlide,
            !isPaused && !document.hidden && carouselInView && videoRequestedForCurrentSlide);
    };
    const mobileViewport = window.matchMedia?.('(max-width: 760px)');
    if (mobileViewport?.addEventListener) mobileViewport.addEventListener('change', playActiveVideo);
    else mobileViewport?.addListener?.(playActiveVideo);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)');
    if (coarsePointer?.addEventListener) coarsePointer.addEventListener('change', playActiveVideo);
    else coarsePointer?.addListener?.(playActiveVideo);
    connection?.addEventListener?.('change', playActiveVideo);

    const showSlide = (index, playVideo = false) => {
        if (!slides.length) return;
        const nextIndex = (index + slides.length) % slides.length;
        pendingSlide = nextIndex;
        const request = ++slideRequest;

        media.prepare(slides[nextIndex]).then(() => {
            if (request !== slideRequest) return;
            currentSlide = nextIndex;
            pendingSlide = nextIndex;
            videoRequestedForCurrentSlide = playVideo;
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
            void media.prepareNext(slides, currentSlide);
        });
    };

    const stopRotation = () => {
        window.clearInterval(rotationTimer);
        rotationTimer = undefined;
    };

    const startRotation = () => {
        if (isPaused || document.hidden || !carouselInView || rotationTimer) return;
        rotationTimer = window.setInterval(() => showSlide(currentSlide + 1, true), 6500);
    };

    previousButton?.addEventListener('click', () => showSlide(pendingSlide - 1, true));
    nextButton?.addEventListener('click', () => showSlide(pendingSlide + 1, true));
    indicators.forEach((indicator) => {
        indicator.addEventListener('click', () => showSlide(Number(indicator.dataset.heroIndicator), true));
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
            videoRequestedForCurrentSlide = true;
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

    if ('IntersectionObserver' in window) {
        const carouselObserver = new IntersectionObserver(([entry]) => {
            carouselInView = entry.isIntersecting;
            if (!carouselInView) {
                stopRotation();
                stopVideos();
                return;
            }
            playActiveVideo();
            startRotation();
        }, { threshold: 0.1 });
        carouselObserver.observe(heroCarousel);
    }

    void media.prepare(slides[currentSlide]);
    void media.prepareNext(slides, currentSlide);
    if (isPaused && toggleButton) {
        toggleButton.setAttribute('aria-pressed', 'true');
        toggleButton.setAttribute('aria-label', 'Retomar carrossel');
        toggleButton.querySelector('span').textContent = '▶';
    } else {
        videoRequestedForCurrentSlide = true;
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
const isPageReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
const revealElements = [...document.querySelectorAll('.section-heading, .feature-card, .closing-content, .closing-banner > .button, .impact-journey-intro, .impact-journey-visual')];

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
        const bounds = element.getBoundingClientRect();
        const alreadyVisible = bounds.top < window.innerHeight && bounds.bottom > 0;
        if (isPageReload || alreadyVisible) {
            element.classList.add('is-visible');
            return;
        }
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

// Scroll-linked story for the IMPACTA community journey.
const impactJourney = document.querySelector('[data-impact-journey]');
if (impactJourney) {
    const journeyStage = impactJourney.querySelector('[data-journey-stage]');
    const journeySteps = [...impactJourney.querySelectorAll('[data-journey-step]')];
    const journeyNodes = [...impactJourney.querySelectorAll('[data-journey-node]')];
    const journeyCurrent = impactJourney.querySelector('[data-journey-current]');
    const journeyCaption = impactJourney.querySelector('[data-journey-core-caption]');
    const desktopStory = window.matchMedia('(min-width: 981px) and (prefers-reduced-motion: no-preference)');
    let activeJourneyIndex = -1;
    let journeyFrame = 0;
    let journeyObserver = null;

    const activateJourneyStep = (index) => {
        const nextIndex = Math.max(0, Math.min(journeySteps.length - 1, index));
        if (nextIndex === activeJourneyIndex || !journeySteps[nextIndex]) return;
        activeJourneyIndex = nextIndex;
        journeySteps.forEach((step, stepIndex) => {
            const active = stepIndex === nextIndex;
            step.classList.toggle('is-active', active);
            if (active) step.setAttribute('aria-current', 'step');
            else step.removeAttribute('aria-current');
        });
        journeyNodes.forEach((node, nodeIndex) => node.classList.toggle('is-active', nodeIndex === nextIndex));
        const step = journeySteps[nextIndex];
        const title = step.querySelector('h3')?.textContent?.trim() || '';
        const shortLabel = step.dataset.journeyShort || title;
        if (journeyCurrent) journeyCurrent.textContent = String(nextIndex + 1).padStart(2, '0') + ' / ' + String(journeySteps.length).padStart(2, '0') + ' - ' + title;
        if (journeyCaption) journeyCaption.textContent = shortLabel;
        impactJourney.dataset.activeStep = String(nextIndex);
    };

    const updateJourneyFromScroll = () => {
        journeyFrame = 0;
        const sectionTop = impactJourney.getBoundingClientRect().top;
        const scrollDistance = Math.max(1, impactJourney.offsetHeight - (journeyStage?.offsetHeight || window.innerHeight));
        const travelled = Math.max(0, -sectionTop);
        const progress = Math.min(.9999, travelled / scrollDistance);
        activateJourneyStep(Math.floor(progress * journeySteps.length));
    };
    const scheduleJourneyUpdate = () => {
        if (!journeyFrame) journeyFrame = window.requestAnimationFrame(updateJourneyFromScroll);
    };
    const configureJourneyMotion = () => {
        window.removeEventListener('scroll', scheduleJourneyUpdate);
        if (journeyFrame) window.cancelAnimationFrame(journeyFrame);
        journeyFrame = 0;
        journeyObserver?.disconnect();
        journeyObserver = null;
        if (desktopStory.matches && journeyStage) {
            window.addEventListener('scroll', scheduleJourneyUpdate, { passive: true });
            scheduleJourneyUpdate();
            return;
        }
        activateJourneyStep(0);
        if (!('IntersectionObserver' in window)) return;
        journeyObserver = new IntersectionObserver((entries) => {
            const visibleSteps = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
            const index = Number(visibleSteps[0]?.target?.dataset?.journeyStep);
            if (Number.isInteger(index)) activateJourneyStep(index);
        }, { threshold: [0.2, 0.4, 0.65], rootMargin: '-18% 0px -32% 0px' });
        journeySteps.forEach((step) => journeyObserver.observe(step));
    };

    configureJourneyMotion();
    desktopStory.addEventListener?.('change', configureJourneyMotion);
    window.addEventListener('resize', configureJourneyMotion, { passive: true });
}

// The three visitor cards take turns in the grid. FLIP keeps their movement
// smooth on wide screens and phones without changing card content or size.
const visitorFeatureGrid = document.querySelector('#frentes.feature-grid');
if (visitorFeatureGrid && 'animate' in Element.prototype && 'IntersectionObserver' in window) {
    let firstSwapTimer = 0;
    let repeatSwapTimer = 0;
    let activeSwapAnimations = [];

    const stopVisitorCardRotation = () => {
        window.clearTimeout(firstSwapTimer);
        window.clearInterval(repeatSwapTimer);
        firstSwapTimer = 0;
        repeatSwapTimer = 0;
        activeSwapAnimations.forEach((animation) => animation.cancel());
        activeSwapAnimations = [];
        visitorFeatureGrid.classList.remove('is-shuffling');
    };

    const rotateVisitorCards = () => {
        if (motionPreference.matches || document.hidden || visitorFeatureGrid.matches(':hover, :focus-within')) return;

        const cards = [...visitorFeatureGrid.querySelectorAll(':scope > .feature-card')];
        if (cards.length !== 3) return;

        const before = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
        visitorFeatureGrid.append(cards[0]);
        visitorFeatureGrid.classList.add('is-shuffling');

        const swapAnimations = cards.map((card, index) => {
            const start = before.get(card);
            const end = card.getBoundingClientRect();
            const deltaX = start.left - end.left;
            const deltaY = start.top - end.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return null;

            const turn = deltaX ? Math.sign(deltaX) * 1.1 : Math.sign(deltaY) * .8;
            return card.animate([
                { transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(.94) rotate(${turn}deg)`, opacity: .8 },
                { transform: `translate3d(${deltaX * .46}px, ${deltaY * .46}px, 0) scale(1.025) rotate(${-turn * .35}deg)`, opacity: 1 },
                { transform: 'translate3d(0, 0, 0) scale(1) rotate(0)', opacity: 1 }
            ], {
                duration: 1180,
                delay: index * 85,
                easing: 'cubic-bezier(.2, .8, .2, 1)',
                fill: 'both'
            });
        }).filter(Boolean);
        activeSwapAnimations = swapAnimations;

        Promise.all(swapAnimations.map((animation) => animation.finished.catch(() => {}))).then(() => {
            swapAnimations.forEach((animation) => animation.cancel());
            if (activeSwapAnimations === swapAnimations) {
                activeSwapAnimations = [];
                visitorFeatureGrid.classList.remove('is-shuffling');
            }
        });
    };

    const rotationObserver = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting || motionPreference.matches) {
            stopVisitorCardRotation();
            return;
        }
        if (firstSwapTimer || repeatSwapTimer) return;

        firstSwapTimer = window.setTimeout(() => {
            firstSwapTimer = 0;
            rotateVisitorCards();
            repeatSwapTimer = window.setInterval(rotateVisitorCards, 6400);
        }, 2600);
    }, { threshold: .28 });

    rotationObserver.observe(visitorFeatureGrid);
    const handleMotionPreferenceChange = (event) => {
        if (event.matches) stopVisitorCardRotation();
        else {
            rotationObserver.unobserve(visitorFeatureGrid);
            rotationObserver.observe(visitorFeatureGrid);
        }
    };
    if (motionPreference.addEventListener) motionPreference.addEventListener('change', handleMotionPreferenceChange);
    else motionPreference.addListener?.(handleMotionPreferenceChange);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopVisitorCardRotation();
        else {
            rotationObserver.unobserve(visitorFeatureGrid);
            rotationObserver.observe(visitorFeatureGrid);
        }
    });
}

const embeddedAuthDialogs = (() => {
    if (!document.querySelector('[data-hero-carousel]')) return Promise.resolve(false);

    const forms = [
        ['login', 'login.html'],
        ['register', 'register.html'],
        ['password-reset', 'password-reset.html']
    ];

    return Promise.all(forms.map(async ([name, path]) => {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('auth_modal_unavailable');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        const dialog = page.querySelector('dialog.auth-modal');
        if (!dialog) throw new Error('auth_modal_unavailable');
        dialog.id = `auth-${name}-modal`;
        dialog.dataset.authDialog = name;
        document.body.append(dialog);
        if (name === 'login') {
            const destinationDialog = page.querySelector('#account-destination-modal');
            if (destinationDialog) document.body.append(destinationDialog);
        }
        return dialog;
    })).then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '../scripts/auth.js?v=admin-mfa-login-flow-20261011-2';
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error('auth_script_unavailable'));
        document.body.append(script);
    })).catch(() => false);
})();

function openEmbeddedAuth(name, fallbackHref) {
    if (landingSessionAuthenticated) {
        window.location.assign('feed.html');
        return;
    }
    void embeddedAuthDialogs.then((ready) => {
        if (!ready) {
            window.location.assign(fallbackHref);
            return;
        }

        const target = document.querySelector(`#auth-${name}-modal`);
        if (!(target instanceof HTMLDialogElement)) {
            window.location.assign(fallbackHref);
            return;
        }

        document.querySelectorAll('dialog.auth-modal[open]').forEach((dialog) => {
            if (dialog instanceof HTMLDialogElement && dialog !== target) dialog.close();
        });
        if (typeof target.showModal === 'function') target.showModal();
        else target.setAttribute('open', '');
        if (window.location.hash === `#${name}`) {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
        target.querySelector('form:not([hidden]) input:not([type="hidden"]):not([readonly])')?.focus({ preventScroll: true });
    });
}

function openAuthWelcome(fallbackHref) {
    if (landingSessionAuthenticated) {
        window.location.assign('feed.html');
        return;
    }
    const welcome = document.querySelector('#auth-welcome-modal');
    if (!(welcome instanceof HTMLDialogElement)) {
        window.location.assign(fallbackHref);
        return;
    }
    document.querySelectorAll('dialog.auth-modal[open]').forEach((dialog) => {
        if (dialog instanceof HTMLDialogElement && dialog !== welcome) dialog.close();
    });
    if (typeof welcome.showModal === 'function') welcome.showModal();
    else welcome.setAttribute('open', '');
}

document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('[data-visitor-auth-gate]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openAuthWelcome(link.href);
}, true);

document.querySelectorAll('[data-auth-choice]').forEach((button) => {
    button.addEventListener('click', () => {
        const name = button.getAttribute('data-auth-choice');
        if (name !== 'login' && name !== 'register') return;
        const welcome = document.querySelector('#auth-welcome-modal');
        if (welcome instanceof HTMLDialogElement) welcome.close();
        openEmbeddedAuth(name, `${name}.html`);
    });
});

document.addEventListener('click', (event) => {
    const backButton = event.target instanceof Element ? event.target.closest('[data-auth-back]') : null;
    if (backButton) {
        event.preventDefault();
        const dialog = backButton.closest('dialog.auth-modal');
        if (dialog instanceof HTMLDialogElement) dialog.close();
        const backTo = backButton.getAttribute('data-auth-back-to');
        if (backTo === 'login' || backTo === 'register') openEmbeddedAuth(backTo, `${backTo}.html`);
        else openAuthWelcome('index.html');
        return;
    }

    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    const fileName = destination.pathname.split('/').pop()?.toLowerCase();

    if (fileName === 'login.html' || fileName === 'register.html' || fileName === 'password-reset.html') {
        event.preventDefault();
        const name = fileName === 'login.html' ? 'login' : fileName === 'register.html' ? 'register' : 'password-reset';
        if (link.hasAttribute('data-open-auth')) openAuthWelcome(link.href);
        else openEmbeddedAuth(name, link.href);
        return;
    }

    if (link.closest('dialog.auth-modal') && (link.matches('.auth-modal-close') || fileName === 'index.html')) {
        event.preventDefault();
        const dialog = link.closest('dialog.auth-modal');
        if (dialog instanceof HTMLDialogElement) dialog.close();
    }
});

const initialAuthView = window.location.hash.slice(1).toLowerCase();
if (initialAuthView === 'welcome') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    void landingAccountActionsReady.then(() => openAuthWelcome('feed.html'));
} else if (initialAuthView === 'login' || initialAuthView === 'register' || initialAuthView === 'password-reset') {
    openEmbeddedAuth(initialAuthView, `${initialAuthView}.html`);
}

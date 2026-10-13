(() => {
    const host = document.querySelector('[data-public-promotions]');
    if (!host || !window.ImpactaAPI) return;

    const storageKey = `impacta:collapsed-public-promotions:${window.location.pathname}`;
    const duration = 6500;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let items = [];
    let activeIndex = 0;
    let startedAt = 0;
    let elapsed = 0;
    let timer = 0;
    let paused = false;
    let progressButtons = [];
    let currentSlide = null;
    let currentItem = null;
    let impressionObserver = null;
    let impressionTimer = 0;
    let visitorId = '';
    const impressionsSentOnPage = new Set();

    const make = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };

    function validUrl(value) {
        try {
            const url = new URL(value, window.location.href);
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch { return ''; }
    }

    function getVisitorId() {
        if (visitorId) return visitorId;
        const key = 'impacta:promotion-metrics:visitor';
        try {
            visitorId = localStorage.getItem(key) || '';
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) visitorId = '';
        } catch { /* O código de medição só vive nesta página quando o armazenamento está indisponível. */ }
        if (!visitorId && window.crypto?.getRandomValues) {
            const bytes = window.crypto.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
            visitorId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            try { localStorage.setItem(key, visitorId); } catch { /* Mantém o identificador apenas em memória. */ }
        }
        return visitorId;
    }

    function stopImpressionTracking() {
        if (impressionTimer) window.clearTimeout(impressionTimer);
        impressionTimer = 0;
        impressionObserver?.disconnect();
        impressionObserver = null;
    }

    function trackClick(link, item) {
        if (!/^\d+$/.test(String(item.id)) || item.kind === 'notice' || !window.ImpactaAPI?.track) return;
        link.addEventListener('click', () => {
            const id = getVisitorId();
            if (id) void window.ImpactaAPI.track(`/site/announcements/${encodeURIComponent(item.id)}/metrics`, { eventType: 'click', visitorId: id });
        });
    }

    function observeCurrentImpression() {
        stopImpressionTracking();
        if (!currentSlide || !currentItem || !/^\d+$/.test(String(currentItem.id))
            || currentItem.kind === 'notice' || impressionsSentOnPage.has(currentItem.id)
            || document.hidden || host.classList.contains('is-collapsed') || !window.ImpactaAPI?.track
            || !('IntersectionObserver' in window)) return;
        impressionObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.target !== currentSlide) continue;
                if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && !impressionTimer) {
                    impressionTimer = window.setTimeout(() => {
                        impressionTimer = 0;
                        impressionsSentOnPage.add(currentItem.id);
                        const id = getVisitorId();
                        if (id) void window.ImpactaAPI.track(`/site/announcements/${encodeURIComponent(currentItem.id)}/metrics`, { eventType: 'impression', visitorId: id });
                        stopImpressionTracking();
                    }, 1000);
                } else if (!entry.isIntersecting || entry.intersectionRatio < 0.5) {
                    if (impressionTimer) window.clearTimeout(impressionTimer);
                    impressionTimer = 0;
                }
            }
        }, { threshold: [0, 0.5, 1] });
        impressionObserver.observe(currentSlide);
    }

    function pause() {
        paused = true;
        if (!timer) return;
        elapsed += performance.now() - startedAt;
        window.clearInterval(timer);
        timer = 0;
    }

    function resume() {
        if (items.length < 2 || timer || paused || host.classList.contains('is-collapsed')
            || reducedMotion.matches || document.hidden) return;
        startedAt = performance.now();
        timer = window.setInterval(() => {
            const activeDuration = currentItem?.imageUrl ? 11000 : duration;
            const progress = Math.min(100, ((elapsed + performance.now() - startedAt) / activeDuration) * 100);
            const current = progressButtons[activeIndex];
            if (current) current.style.setProperty('--progress', `${progress}%`);
            if (progress >= 100) show((activeIndex + 1) % items.length);
        }, 70);
    }

    function show(index) {
        if (!items.length) return;
        stopImpressionTracking();
        if (timer) window.clearInterval(timer);
        timer = 0;
        activeIndex = (index + items.length) % items.length;
        elapsed = 0;
        progressButtons.forEach((button, itemIndex) => {
            button.setAttribute('aria-current', String(itemIndex === activeIndex));
            button.style.setProperty('--progress', itemIndex < activeIndex ? '100%' : '0%');
        });

        const item = items[activeIndex];
        currentItem = item;
        const labels = { notice: 'Aviso da plataforma', announcement: 'Novidade da comunidade', advertisement: 'Publicidade' };
        const titleText = typeof item.title === 'string' ? item.title.trim() : '';
        const bodyText = typeof item.body === 'string' ? item.body.trim() : '';
        const hasCopy = Boolean(titleText || bodyText);
        const actionText = item.kind === 'advertisement' ? 'anúncio' : item.kind === 'notice' ? 'aviso' : 'destaque';
        const hideControl = host.querySelector('.public-promotion-hide');
        const showControl = host.querySelector('.public-promotion-show');
        if (hideControl) {
            hideControl.textContent = `⌄ Ocultar ${actionText}`;
            hideControl.setAttribute('aria-label', `Ocultar ${actionText}`);
            hideControl.setAttribute('aria-expanded', String(!host.classList.contains('is-collapsed')));
        }
        if (showControl) {
            showControl.textContent = `⌃ Mostrar ${actionText}`;
            showControl.setAttribute('aria-label', `Mostrar ${actionText}`);
            showControl.setAttribute('aria-expanded', String(!host.classList.contains('is-collapsed')));
        }

        const slide = make('article', `public-promotion-slide${item.imageUrl ? ' has-image' : ''}${item.imageUrl && !hasCopy ? ' is-flyer' : ''}`);
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-label', `${activeIndex + 1} de ${items.length}`);
        const progressTrack = progressButtons[0]?.closest('.public-promotion-progress');
        if (progressTrack) slide.append(progressTrack);

        const copy = make('div', 'public-promotion-copy');
        copy.append(make('p', 'public-promotion-kind', labels[item.kind] || 'Em destaque'));
        if (titleText) copy.append(make('h2', 'public-promotion-title', titleText));
        const body = bodyText ? make('p', 'public-promotion-body', bodyText) : null;
        if (body) {
            body.id = 'public-promotion-body';
            copy.append(body);
        }
        if (bodyText.length > 150 && body) {
            const readToggle = make('button', 'public-promotion-read-toggle', 'Ver mais');
            readToggle.type = 'button';
            readToggle.setAttribute('aria-expanded', 'false');
            readToggle.setAttribute('aria-controls', body.id);
            readToggle.addEventListener('click', () => {
                const expanded = slide.classList.toggle('is-expanded');
                readToggle.textContent = expanded ? 'Ver menos' : 'Ver mais';
                readToggle.setAttribute('aria-expanded', String(expanded));
            });
            copy.append(readToggle);
        }

        const targetUrl = validUrl(item.targetUrl);
        if (item.imageUrl) {
            const imageWrap = make('div', 'public-promotion-image');
            const imageSurface = targetUrl ? document.createElement('a') : make('div');
            imageSurface.className = 'public-promotion-image-link';
            if (targetUrl) {
                imageSurface.href = targetUrl;
                imageSurface.target = '_blank';
                imageSurface.rel = 'noopener noreferrer';
                imageSurface.setAttribute('aria-label', `Abrir detalhes: ${titleText || actionText}`);
                trackClick(imageSurface, item);
            }
            const image = document.createElement('img');
            image.src = window.ImpactaAPI.assetUrl(item.imageUrl);
            image.alt = titleText ? `Flyer: ${titleText}` : `Flyer com informação de ${labels[item.kind] || 'destaque'}`;
            image.loading = 'eager';
            image.decoding = 'async';
            imageSurface.append(image);
            imageWrap.append(imageSurface);
            slide.append(imageWrap);
            if (targetUrl) {
                const cta = make('a', 'public-promotion-cta', 'Conhecer esta iniciativa ↗');
                cta.href = targetUrl;
                cta.target = '_blank';
                cta.rel = 'noopener noreferrer';
                trackClick(cta, item);
                copy.append(cta);
            }
        } else if (targetUrl) {
            const cta = make('a', 'public-promotion-cta', item.kind === 'advertisement' ? 'Conhecer esta iniciativa ↗' : 'Ler o aviso completo ↗');
            cta.href = targetUrl;
            cta.target = '_blank';
            cta.rel = 'noopener noreferrer';
            trackClick(cta, item);
            copy.append(cta);
        }
        slide.append(copy);
        host.querySelector('.public-promotion-content').replaceChildren(slide);
        currentSlide = slide;
        observeCurrentImpression();
        if (!paused && !reducedMotion.matches && !document.hidden) resume();
    }

    function collapse() {
        pause();
        stopImpressionTracking();
        host.classList.add('is-collapsed');
        document.body.classList.remove('has-public-promotion');
        try { sessionStorage.setItem(storageKey, '1'); } catch { /* Mantém o estado recolhido nesta página. */ }
        const hideControl = host.querySelector('.public-promotion-hide');
        const showControl = host.querySelector('.public-promotion-show');
        hideControl?.setAttribute('aria-expanded', 'false');
        showControl?.setAttribute('aria-expanded', 'false');
    }

    function expand() {
        host.classList.remove('is-collapsed');
        document.body.classList.add('has-public-promotion');
        paused = false;
        try { sessionStorage.removeItem(storageKey); } catch { /* O anúncio continua aberto nesta página. */ }
        const hideControl = host.querySelector('.public-promotion-hide');
        const showControl = host.querySelector('.public-promotion-show');
        hideControl?.setAttribute('aria-expanded', 'true');
        showControl?.setAttribute('aria-expanded', 'true');
        observeCurrentImpression();
        resume();
    }

    async function init() {
        try {
            const data = await window.ImpactaAPI.request('/site/announcement');
            items = Array.isArray(data?.items)
                ? data.items.filter((item) => item && ((typeof item.title === 'string' && item.title.trim()) || (typeof item.body === 'string' && item.body.trim()) || (typeof item.imageUrl === 'string' && item.imageUrl.trim())))
                : [];
            if (!items.length && typeof data?.message === 'string' && data.message.trim()) {
                items = [{ id: 'homepage-notice', kind: 'notice', title: 'Aviso da plataforma', body: data.message, imageUrl: data.imageUrl, targetUrl: null }];
            }
        } catch { return; }
        if (!items.length) return;

        let collapsed = false;
        try { collapsed = sessionStorage.getItem(storageKey) === '1'; } catch { /* O estado será mantido apenas nesta página. */ }
        host.dataset.count = String(items.length);
        const controls = make('div', 'public-promotions-controls');
        const progress = make('div', 'public-promotion-progress');
        progress.setAttribute('role', 'group');
        progress.setAttribute('aria-label', 'Escolher anúncio ou aviso');
        progressButtons = items.map((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', `Mostrar destaque ${index + 1}: ${item.title || 'mensagem'}`);
            button.addEventListener('click', () => show(index));
            progress.append(button);
            return button;
        });
        controls.append(progress);

        const hide = make('button', 'public-promotion-hide', '⌄ Ocultar anúncio');
        hide.type = 'button';
        hide.setAttribute('aria-expanded', 'true');
        hide.addEventListener('click', collapse);
        controls.append(hide);
        const content = make('div', 'public-promotion-content');
        const showButton = make('button', 'public-promotion-show', '⌃ Mostrar anúncio');
        showButton.type = 'button';
        showButton.setAttribute('aria-expanded', 'false');
        showButton.addEventListener('click', expand);
        host.replaceChildren(controls, content, showButton);
        host.hidden = false;
        if (collapsed) {
            host.classList.add('is-collapsed');
            paused = true;
        } else {
            document.body.classList.add('has-public-promotion');
        }
        host.addEventListener('mouseenter', pause);
        host.addEventListener('mouseleave', resume);
        host.addEventListener('focusin', pause);
        host.addEventListener('focusout', (event) => { if (!host.contains(event.relatedTarget)) resume(); });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { pause(); stopImpressionTracking(); }
            else { observeCurrentImpression(); resume(); }
        });
        reducedMotion.addEventListener?.('change', () => reducedMotion.matches ? pause() : resume());
        show(0);
    }

    void init();
})();

(() => {
    const posterRequests = new Map();
    const unavailableMobileSources = new WeakSet();
    const mobileViewport = window.matchMedia?.('(max-width: 760px)');
    const coarsePointer = window.matchMedia?.('(pointer: coarse)');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    function prepare(slide) {
        const video = slide?.querySelector('video');
        const posterImage = slide?.querySelector('img[data-carousel-poster]');
        const poster = posterImage?.dataset.carouselPoster || video?.dataset.poster || video?.getAttribute('poster');
        if (!video || !poster) return Promise.resolve();

        if (posterImage) {
            if (posterImage.getAttribute('src') !== poster) posterImage.setAttribute('src', poster);
        } else if (video.getAttribute('poster') !== poster) {
            video.setAttribute('poster', poster);
        }
        if (posterRequests.has(poster)) return posterRequests.get(poster);

        const image = posterImage || new Image();
        image.decoding = 'async';
        if (!posterImage && 'fetchPriority' in image) image.fetchPriority = 'low';
        if (!posterImage) image.src = poster;

        let ready;
        if (typeof image.decode === 'function') {
            ready = image.decode().catch(() => undefined);
        } else {
            ready = new Promise((resolve) => {
                if (image.complete) resolve();
                else {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', resolve, { once: true });
                }
            });
        }

        posterRequests.set(poster, ready);
        return ready;
    }

    function prepareNext(slides, index) {
        if (!slides?.length) return Promise.resolve();
        return prepare(slides[(index + 1) % slides.length]);
    }

    function pause(slides) {
        slides?.forEach((slide) => {
            const video = slide.querySelector('video');
            if (!video) return;
            video.dataset.carouselWantsPlay = 'false';
            video.pause();
        });
    }

    function bindMobileFallback(video, source) {
        if (source.dataset.mobileFallbackBound === 'true') return;
        source.dataset.mobileFallbackBound = 'true';

        video.addEventListener('error', () => {
            const failedSource = source.getAttribute('src');
            if (!source.dataset.mobileSrc || failedSource !== source.dataset.mobileSrc
                || !source.dataset.src) return;

            unavailableMobileSources.add(source);
            source.setAttribute('src', source.dataset.src);
            video.load();
            if (video.dataset.carouselWantsPlay === 'true') {
                video.play().catch(() => undefined);
            }
        });
    }

    function sourceForViewport(source) {
        const slowConnection = /^(slow-)?[23]g$/i.test(connection?.effectiveType || '');
        const compactPlayback = mobileViewport?.matches || coarsePointer?.matches
            || navigator.userAgentData?.mobile || connection?.saveData || slowConnection;
        if (compactPlayback && source.dataset.mobileSrc
            && !unavailableMobileSources.has(source)) {
            return source.dataset.mobileSrc;
        }
        return source.dataset.src;
    }

    function activate(slides, index, shouldPlay) {
        const activeVideo = slides?.[index]?.querySelector('video');
        if (!activeVideo) return;

        slides.forEach((slide, position) => {
            if (position === index) return;
            const video = slide.querySelector('video');
            if (!video) return;
            video.dataset.carouselWantsPlay = 'false';
            video.pause();
        });

        activeVideo.dataset.carouselWantsPlay = String(shouldPlay);
        if (!shouldPlay) {
            activeVideo.pause();
            return;
        }

        const source = activeVideo.querySelector('source[data-src]');
        if (source) {
            bindMobileFallback(activeVideo, source);
            const selectedSource = sourceForViewport(source);
            if (selectedSource && source.getAttribute('src') !== selectedSource) {
                activeVideo.pause();
                source.setAttribute('src', selectedSource);
                activeVideo.load();
            }
        }

        activeVideo.play().catch(() => undefined);
    }

    window.ImpactaCarouselMedia = Object.freeze({ prepare, prepareNext, pause, activate });
})();
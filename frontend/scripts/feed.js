const postList = document.querySelector('#post-list');
const initialPostSkeleton = postList?.querySelector('.feed-post-skeleton')?.cloneNode(true) || null;
const postsMoreButton = document.querySelector('#post-list-more');
const postsMoreStatus = document.querySelector('#post-list-more-status');
const postMediaDialog = document.querySelector('#feed-media-dialog');
const postMediaStage = document.querySelector('#feed-media-stage');
const postMediaCounter = document.querySelector('#feed-media-counter');
const postMediaPrevious = document.querySelector('#feed-media-previous');
const postMediaNext = document.querySelector('#feed-media-next');
const postMediaClose = document.querySelector('#feed-media-close');
const searchField = document.querySelector('#feed-search');
if (searchField) searchField.value = new URLSearchParams(window.location.search).get('q') || '';
const sortField = document.querySelector('#feed-sort');
const categoryFilter = document.querySelector('#feed-category-filter');
const feedSearchScope = document.querySelector('#feed-search-scope');
const feedSearchScopeLabel = document.querySelector('#feed-search-scope-label');
const feedSearchFilterToggle = document.querySelector('#feed-search-filter-toggle');
const feedSearchFilterPanel = document.querySelector('#feed-search-filters');
const feedSearchSubmit = document.querySelector('#feed-search-submit');
const postCategoryField = document.querySelector('#post-category');
const postProjectField = document.querySelector('#post-project');
const customCategoryControl = document.querySelector('.custom-category-control');
const customCategoryField = document.querySelector('#post-custom-category');
const emptyState = document.querySelector('#empty-state');
const feedStatus = document.querySelector('#feed-status');
const challengeList = document.querySelector('#challenge-list');
const projectList = document.querySelector('#projects-list');
const communityList = document.querySelector('#community-list');
const challengeAreaFilter = document.querySelector('#challenge-area-filter');
const projectAreaFilter = document.querySelector('#project-area-filter');
const communityAreaFilter = document.querySelector('#community-area-filter');
const challengeLocationFilter = document.querySelector('#challenge-location-filter');
const projectLocationFilter = document.querySelector('#project-location-filter');
const communityLocationFilter = document.querySelector('#community-location-filter');
const requestedCommunityId = new URLSearchParams(window.location.search).get('community');
const requestedProjectId = new URLSearchParams(window.location.search).get('project');
const resourceListingConfigs = [
    {
        filter: challengeAreaFilter, locationFilter: challengeLocationFilter, container: challengeList, path: '/challenges',
        emptyMessage: 'Não há desafios que correspondam aos filtros. Limpa os filtros para ver as tarefas disponíveis e o destaque semanal.',
        errorMessage: 'Não foi possível carregar os desafios.', createCard: createChallenge
    },
    {
        filter: projectAreaFilter, locationFilter: projectLocationFilter, container: projectList, path: '/projects',
        emptyMessage: 'Ainda não há projectos aprovados disponíveis para participação.',
        errorMessage: 'Não foi possível carregar os projectos.', createCard: createProject
    },
    {
        filter: communityAreaFilter, locationFilter: communityLocationFilter, container: communityList, path: '/communities',
        emptyMessage: 'Ainda não há comunidades públicas para mostrar.',
        errorMessage: 'Não foi possível carregar as comunidades.', createCard: createCommunity
    }
];
const resourceListGenerations = new WeakMap();
const composer = document.querySelector('#composer');
const composerInput = document.querySelector('#post-body');
const shareIdeaLinks = document.querySelectorAll('[data-share-idea-link]');
const composerButton = document.querySelector('#publish-post');
const composerAuthor = document.querySelector('#composer-author');
const composerHint = document.querySelector('#composer-hint');
const composerStatus = document.querySelector('#composer-status');
const characterCount = document.querySelector('#post-character-count');
const mediaPicker = document.querySelector('#post-media-files');
const chooseMediaButton = document.querySelector('#choose-post-media');
const mediaPreview = document.querySelector('#composer-media-preview');
const feedMenuToggle = document.querySelector('#feed-menu-toggle');
const feedMobileMenu = document.querySelector('#feed-mobile-menu');
const mobileAccountLink = document.querySelector('#feed-mobile-account-link');
const mobileLogoutButton = document.querySelector('#feed-mobile-logout');
const notificationsToggle = document.querySelector('#feed-notifications-toggle');
const notificationsBadge = document.querySelector('#feed-notifications-badge');
const notificationPanel = document.querySelector('#feed-notification-panel');
const notificationList = document.querySelector('#feed-notification-list');
const notificationStatus = document.querySelector('#feed-notifications-status');
const notificationsMarkAll = document.querySelector('#feed-notifications-mark-all');
const openProjectDialogButton = document.querySelector('[data-open-project-dialog]');
const projectLoginLink = document.querySelector('#project-login-link');
const openCommunityDialogButton = document.querySelector('[data-open-community-dialog]');
const communityLoginLink = document.querySelector('#community-login-link');
const communityDialog = document.querySelector('#community-dialog');
const projectDialog = document.querySelector('#project-dialog');
const challengeDialog = document.querySelector('#challenge-dialog');
const communityChatDialog = document.querySelector('#community-chat-dialog');
const projectChatDialog = document.querySelector('#project-chat-dialog');
const projectChatTitle = document.querySelector('#project-chat-title');
const projectChatStatus = document.querySelector('#project-chat-status');
const projectChatOlderButton = document.querySelector('#project-chat-older');
const projectChatMessages = document.querySelector('#project-chat-messages');
const projectChatForm = document.querySelector('#project-chat-form');
const projectChatInput = document.querySelector('#project-chat-input');
const projectChatFormStatus = document.querySelector('#project-chat-form-status');
const projectChatSend = document.querySelector('#project-chat-send');
const projectChatMute = document.querySelector('#project-chat-mute');
const communityChatTitle = document.querySelector('#community-chat-title');
const communityChatStatus = document.querySelector('#community-chat-status');
const communityChatOlderButton = document.querySelector('#community-chat-older');
const communityChatMessages = document.querySelector('#community-chat-messages');
const communityChatForm = document.querySelector('#community-chat-form');
const communityChatInput = document.querySelector('#community-chat-input');
const communityChatFile = document.querySelector('#community-chat-file');
const communityChatAttachment = document.querySelector('#community-chat-attachment');
const communityChatFormStatus = document.querySelector('#community-chat-form-status');
const communityChatSend = document.querySelector('#community-chat-send');
const communityChatLockControls = document.querySelector('#community-chat-lock-controls');
const communityChatLockDuration = document.querySelector('#community-chat-lock-duration');
const communityChatLockButton = document.querySelector('#community-chat-lock');
const communityChatUnlockButton = document.querySelector('#community-chat-unlock');
const communityCreateForm = document.querySelector('#community-create-form');
const projectCreateForm = document.querySelector('#project-create-form');
const challengeCreateForm = document.querySelector('#challenge-create-form');

let currentUser = null;
const directMessageLinks = [...document.querySelectorAll('[data-direct-message-link]')];
const cachedAvatarPreview = window.ImpactaAPI?.cachedAvatarPreview?.();
const setDirectMessageShortcutsVisible = (visible) => {
    directMessageLinks.forEach((link) => { link.hidden = !visible; });
};
setDirectMessageShortcutsVisible(Boolean(cachedAvatarPreview));
let directMessageBadgeRefreshTimer = null;
async function refreshDirectMessageBadges() {
    if (!currentUser || !directMessageLinks.length || !window.ImpactaAPI) return;
    try {
        const summary = await window.ImpactaAPI.request('/direct-messages/summary');
        const unread = Math.max(0, Number(summary?.unread_count) || 0);
        const requests = Math.max(0, Number(summary?.request_count) || 0);
        const total = unread + requests;
        directMessageLinks.forEach((link) => {
            const badge = link.querySelector('[data-direct-message-badge]');
            if (badge) {
                badge.textContent = total > 99 ? '99+' : String(total);
                badge.hidden = total === 0;
            }
            link.setAttribute('aria-label', total
                ? `Mensagens, ${unread} por ler e ${requests} pedidos`
                : 'Mensagens');
        });
    } catch { /* Keep the shortcut visible if its unread count is unavailable. */ }
}
function hydrateFeedAvatarPreview() {
    const cached = window.ImpactaAPI?.cachedAvatarPreview();
    const accountActions = document.querySelector('.feed-header-actions');
    const placeholder = accountActions?.querySelector('.account-state-placeholder');
    if (!cached || !accountActions || !placeholder) return;
    const avatar = document.createElement('a');
    avatar.className = 'user-chip profile-chip';
    avatar.href = 'profile.html';
    avatar.setAttribute('aria-label', 'Abrir o teu perfil');
    avatar.dataset.tooltip = 'O teu perfil';
    avatar.dataset.avatarUserId = cached.userId;
    avatar.dataset.avatarSource = cached.avatarUrl;
    avatar.dataset.cachedAvatarPreview = 'true';
    const image = document.createElement('img');
    image.src = cached.dataUrl;
    image.alt = '';
    image.decoding = 'sync';
    avatar.append(image);
    placeholder.replaceWith(avatar);
}
hydrateFeedAvatarPreview();
const feedImpactationStatusByUser = new Map();
const feedImpactationStatusRequests = new Map();
let activeCommunityChat = null;
let activeProjectChat = null;
let lastProjectMessageId = '0';
let firstProjectMessageId = '';
let projectChatPollingTimer = null;
let projectChatPolling = false;
let lastCommunityMessageId = '0';
let firstCommunityMessageId = '';
let communityChatPollingTimer = null;
let communityChatPolling = false;
let communityChatMessageIds = new Set();
let entityActivityRefreshPromise = null;
let selectedMedia = [];
let postCategories = [];
let postCategoriesReady = false;

function showFeedNotice(title, message, { danger = false, durationMs = 2200 } = {}) {
    if (window.ImpactaModal?.notice) {
        void window.ImpactaModal.notice({ title, message, danger, durationMs });
        return;
    }
    if (!composerStatus) return;
    composerStatus.textContent = message;
    window.setTimeout(() => {
        if (composerStatus.textContent === message) composerStatus.textContent = '';
    }, durationMs);
}
let feedPosts = [];
let feedPostsOffset = 0;
let hasMoreFeedPosts = false;
let loadingMorePosts = false;
let currentPostCategory = '';
let postLoadGeneration = 0;
let activePostMedia = [];
let activePostMediaIndex = 0;
let visiblePostCount = 6;
const POST_BATCH_SIZE = 6;
const POST_PREVIEW_CHARACTER_LIMIT = 240;

function initFeedCarousel() {
    const carousel = document.querySelector('[data-feed-carousel]');
    const media = window.ImpactaCarouselMedia;
    if (!carousel || !media) return;

    const slides = [...carousel.querySelectorAll('.feed-welcome-slide')];
    slides.forEach((slide) => {
        const video = slide.querySelector('video');
        video?.addEventListener('playing', () => slide.classList.add('is-video-playing'));
        video?.addEventListener('error', () => slide.classList.remove('is-video-playing'));
    });
    const indicators = [...carousel.querySelectorAll('[data-feed-carousel-indicator]')];
    const eyebrow = carousel.querySelector('[data-feed-carousel-eyebrow]');
    const title = carousel.querySelector('[data-feed-carousel-title]');
    const highlight = carousel.querySelector('[data-feed-carousel-highlight]');
    const description = carousel.querySelector('[data-feed-carousel-description]');
    const toggle = carousel.querySelector('[data-feed-carousel-toggle]');
    if (!slides.length || indicators.length !== slides.length
        || !eyebrow || !title || !highlight || !description || !toggle) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const prefersDataSaving = Boolean(connection?.saveData)
        || /^(slow-)?2g$/i.test(connection?.effectiveType || '');
    let carouselInView = !('IntersectionObserver' in window);
    let activeIndex = 0;
    let pendingIndex = 0;
    let slideRequest = 0;
    let rotationEnabled = !reducedMotion && !prefersDataSaving;
    let videoRequestedForCurrentSlide = false;
    let pointerInside = false;
    let focusInside = false;
    let timer = null;

    function clearTimer() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
    }

    function scheduleRotation() {
        clearTimer();
        if (!rotationEnabled || document.hidden || !carouselInView || pointerInside || focusInside) return;
        timer = window.setInterval(() => showSlide(activeIndex + 1, true), 6500);
    }

    function stopVideos() {
        media.pause(slides);
    }

    function playActiveVideo() {
        media.activate(slides, activeIndex,
            rotationEnabled && !document.hidden && carouselInView && videoRequestedForCurrentSlide);
    }
    const mobileViewport = window.matchMedia?.('(max-width: 760px)');
    if (mobileViewport?.addEventListener) mobileViewport.addEventListener('change', playActiveVideo);
    else mobileViewport?.addListener?.(playActiveVideo);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)');
    if (coarsePointer?.addEventListener) coarsePointer.addEventListener('change', playActiveVideo);
    else coarsePointer?.addListener?.(playActiveVideo);
    connection?.addEventListener?.('change', playActiveVideo);

    function showSlide(index, playVideo = false) {
        const nextIndex = (index + slides.length) % slides.length;
        pendingIndex = nextIndex;
        const request = ++slideRequest;

        media.prepare(slides[nextIndex]).then(() => {
            if (request !== slideRequest) return;
            activeIndex = nextIndex;
            pendingIndex = nextIndex;
            videoRequestedForCurrentSlide = playVideo;
            const activeSlide = slides[activeIndex];
            slides.forEach((slide, position) => slide.classList.toggle('is-active', position === activeIndex));
            indicators.forEach((indicator, position) => {
                if (position === activeIndex) indicator.setAttribute('aria-current', 'true');
                else indicator.removeAttribute('aria-current');
            });
            eyebrow.textContent = activeSlide.dataset.eyebrow || '';
            title.textContent = activeSlide.dataset.title || '';
            highlight.textContent = activeSlide.dataset.highlight || '';
            description.textContent = activeSlide.dataset.description || '';
            carousel.dataset.activeSlide = String(activeIndex + 1);
            playActiveVideo();
            void media.prepareNext(slides, activeIndex);
        });
    }

    function setRotationEnabled(enabled) {
        rotationEnabled = enabled;
        videoRequestedForCurrentSlide = enabled;
        toggle.textContent = enabled ? 'Ⅱ' : '▶';
        toggle.setAttribute('aria-label', enabled ? 'Pausar carrossel' : 'Reproduzir carrossel');
        toggle.setAttribute('aria-pressed', String(!enabled));
        if (enabled) playActiveVideo();
        else stopVideos();
        scheduleRotation();
    }

    carousel.querySelector('[data-feed-carousel-previous]')?.addEventListener('click', () => {
        showSlide(pendingIndex - 1, true);
        scheduleRotation();
    });
    carousel.querySelector('[data-feed-carousel-next]')?.addEventListener('click', () => {
        showSlide(pendingIndex + 1, true);
        scheduleRotation();
    });
    indicators.forEach((indicator, position) => indicator.addEventListener('click', () => {
        showSlide(position, true);
        scheduleRotation();
    }));
    toggle.addEventListener('click', () => setRotationEnabled(!rotationEnabled));
    carousel.addEventListener('pointerenter', () => { pointerInside = true; clearTimer(); });
    carousel.addEventListener('pointerleave', () => { pointerInside = false; scheduleRotation(); });
    carousel.addEventListener('focusin', () => { focusInside = true; clearTimer(); });
    carousel.addEventListener('focusout', (event) => {
        if (carousel.contains(event.relatedTarget)) return;
        focusInside = false;
        scheduleRotation();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopVideos();
        else playActiveVideo();
        scheduleRotation();
    });

    if ('IntersectionObserver' in window) {
        const carouselObserver = new IntersectionObserver(([entry]) => {
            carouselInView = entry.isIntersecting;
            if (!carouselInView) {
                clearTimer();
                stopVideos();
                return;
            }
            playActiveVideo();
            scheduleRotation();
        }, { threshold: 0.1 });
        carouselObserver.observe(carousel);
    }

    void media.prepare(slides[activeIndex]);
    showSlide(activeIndex, rotationEnabled);
    toggle.textContent = rotationEnabled ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', rotationEnabled ? 'Pausar carrossel' : 'Reproduzir carrossel');
    toggle.setAttribute('aria-pressed', String(!rotationEnabled));
    scheduleRotation();
}

initFeedCarousel();

function setMobileMenuOpen(isOpen) {
    if (!feedMenuToggle || !feedMobileMenu) return;
    feedMobileMenu.hidden = !isOpen;
    feedMenuToggle.setAttribute('aria-expanded', String(isOpen));
    feedMenuToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
}

const feedHeader = document.querySelector('.feed-header');
const feedTopNavigation = document.querySelector('.feed-top-nav');
const feedHeaderActions = document.querySelector('.feed-header-actions');
const directMessageShortcut = feedTopNavigation?.querySelector('[data-direct-message-link]');
const feedAdminNavigationSlot = feedTopNavigation?.querySelector('[data-feed-nav-slot="admin"]');
const feedNotificationsNavigationSlot = feedTopNavigation?.querySelector('[data-feed-nav-slot="notifications"]');
const feedNavigationViewport = window.matchMedia('(max-width: 760px)');
const feedSearchViewport = window.matchMedia('(max-width: 980px)');
const feedCarousel = document.querySelector('[data-feed-carousel]');
const feedSearchControl = searchField?.closest('.feed-search-shell');

function setFeedSearchFiltersOpen(isOpen) {
    if (!feedSearchFilterPanel) return;
    feedSearchFilterPanel.hidden = !isOpen;
    feedSearchScope?.setAttribute('aria-expanded', String(isOpen));
    feedSearchFilterToggle?.setAttribute('aria-expanded', String(isOpen));
}

function updateFeedSearchScope() {
    if (!feedSearchScopeLabel || !categoryFilter) return;
    const selected = categoryFilter.selectedOptions[0];
    feedSearchScopeLabel.textContent = categoryFilter.value ? selected?.textContent || 'Categoria' : 'Todas as publicações';
    feedSearchScope?.setAttribute('aria-label', `Pesquisar em ${feedSearchScopeLabel.textContent}`);
}

feedSearchScope?.addEventListener('click', () => setFeedSearchFiltersOpen(feedSearchFilterPanel?.hidden ?? true));
feedSearchFilterToggle?.addEventListener('click', () => setFeedSearchFiltersOpen(feedSearchFilterPanel?.hidden ?? true));
feedSearchSubmit?.addEventListener('click', () => {
    applyFilterAndSort({ resetVisible: true });
    searchField?.focus();
});
feedSearchFilterPanel?.addEventListener('change', (event) => {
    if (event.target === categoryFilter) updateFeedSearchScope();
    setFeedSearchFiltersOpen(false);
});
document.addEventListener('pointerdown', (event) => {
    if (feedSearchFilterPanel && !feedSearchFilterPanel.hidden && !feedSearchControl?.contains(event.target)) {
        setFeedSearchFiltersOpen(false);
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && feedSearchFilterPanel && !feedSearchFilterPanel.hidden) setFeedSearchFiltersOpen(false);
});

function placeFeedSearch() {
    if (!feedSearchControl || !feedHeader || !feedCarousel) return;
    if (feedSearchViewport.matches) {
        if (feedSearchControl.previousElementSibling !== feedCarousel) feedCarousel.after(feedSearchControl);
        return;
    }
    if (feedSearchControl.parentElement !== feedHeader) {
        const brand = feedHeader.querySelector('.brand');
        if (brand) brand.after(feedSearchControl);
    }
}

function syncFeedNavigationSlots() {
    if (feedAdminNavigationSlot) feedAdminNavigationSlot.hidden = !Boolean(document.querySelector('#feed-admin-link')?.hidden);
    if (feedNotificationsNavigationSlot) feedNotificationsNavigationSlot.hidden = !Boolean(notificationsToggle?.hidden);
}

function placeFeedNavigation() {
    if (!feedHeader || !feedTopNavigation || !feedHeaderActions || !notificationsToggle) return;
    if (feedNavigationViewport.matches) {
        if (feedTopNavigation.parentElement !== document.body) feedHeader.after(feedTopNavigation);
        if (notificationsToggle.parentElement !== feedHeaderActions) {
            feedHeaderActions.insertBefore(notificationsToggle, feedHeaderActions.firstChild);
        }
        if (directMessageShortcut && directMessageShortcut.parentElement !== feedHeaderActions) {
            feedHeaderActions.insertBefore(directMessageShortcut, notificationsToggle);
        }
        return;
    }
    if (feedTopNavigation.parentElement !== feedHeader) {
        const notificationPanelAnchor = feedHeader.querySelector('.notification-panel');
        feedHeader.insertBefore(feedTopNavigation, notificationPanelAnchor);
    }
    if (notificationsToggle.parentElement !== feedTopNavigation) {
        const notificationsSlot = feedTopNavigation.querySelector('[data-feed-nav-slot="notifications"]');
        feedTopNavigation.insertBefore(notificationsToggle, notificationsSlot ?? null);
    }
    if (directMessageShortcut && directMessageShortcut.parentElement !== feedTopNavigation) {
        const adminShortcut = feedTopNavigation.querySelector('#feed-admin-link');
        feedTopNavigation.insertBefore(directMessageShortcut, adminShortcut || notificationsToggle);
    }
}
placeFeedNavigation();
placeFeedSearch();
syncFeedNavigationSlots();
feedNavigationViewport.addEventListener('change', placeFeedNavigation);
feedSearchViewport.addEventListener('change', placeFeedSearch);

feedMenuToggle?.addEventListener('click', () => {
    setMobileMenuOpen(feedMobileMenu.hidden);
});

feedMobileMenu?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMobileMenuOpen(false);
});

const feedSectionLinks = document.querySelectorAll(
    '.side-nav a[href^="#"], .feed-top-nav a[href^="#"], .feed-mobile-menu a[href^="#"]'
);
feedSectionLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
        const target = document.getElementById(link.hash.slice(1));
        if (!target) return;

        event.preventDefault();
        window.history.pushState(null, '', link.hash);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

        feedSectionLinks.forEach((item) => {
            const active = item.hash === link.hash;
            if (active) item.setAttribute('aria-current', 'location');
            else item.removeAttribute('aria-current');
            if (item.closest('.side-nav')) item.classList.toggle('side-nav-active', active);
            if (item.closest('.feed-top-nav')) item.classList.toggle('top-nav-active', active);
        });

        target.classList.remove('section-navigation-focus');
        void target.offsetWidth;
        target.classList.add('section-navigation-focus');
        window.setTimeout(() => target.classList.remove('section-navigation-focus'), 1500);
        if (link.hash === '#projetos' || link.hash === '#comunidades') {
            window.setTimeout(() => focusResourceProposal(link.hash), reduceMotion ? 0 : 450);
        }
    });
});

document.addEventListener('click', (event) => {
    if (feedMobileMenu?.hidden) return;
    if (!feedMobileMenu?.contains(event.target) && !feedMenuToggle?.contains(event.target)) {
        setMobileMenuOpen(false);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !feedMobileMenu || feedMobileMenu.hidden) return;
    setMobileMenuOpen(false);
    feedMenuToggle?.focus();
});

mobileLogoutButton?.addEventListener('click', () => {
    setMobileMenuOpen(false);
    void endSession(mobileLogoutButton);
});

const iconMarkup = Object.freeze({
    support: '<path d="M20.5 8.8c0 5-8.5 10.1-8.5 10.1S3.5 13.8 3.5 8.8a4.2 4.2 0 0 1 8.5-.3 4.2 4.2 0 0 1 8.5.3Z"/>',
    comment: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-1-4a7.5 7.5 0 1 1 16-3.5Z"/><path d="M8 11.5h8M8 14.5h5"/>',
    share: '<path d="M5 19 19 5M8 5h11v11"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m3 3v7m6-7v7"/>',
    report: '<path d="M12 3 21 20H3L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    home: '<path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9M9.5 20v-6h5v6"/>',
    challenge: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/>',
    project: '<path d="M5 19 19 5M8 5h11v11"/>',
    previous: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    community: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>'
});

const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function attachMentionPicker(input, initialMentions = []) {
    if (!input) return () => [];
    const field = input.closest('label') || input;
    const existingAnchor = field.parentElement?.classList.contains('mention-field-wrap') ? field.parentElement : null;
    const anchor = existingAnchor || element('div', 'mention-field-wrap');
    if (!existingAnchor) {
        field.parentNode.insertBefore(anchor, field);
        anchor.append(field);
    }
    const list = element('div', 'mention-suggestions');
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    anchor.append(list);

    const selected = new Map();
    for (const mention of initialMentions) {
        if (mention?.user_id && mention?.display_name) selected.set(String(mention.user_id), mention);
    }
    let matchRange = null;
    let searchVersion = 0;
    let activeIndex = -1;
    let searchTimer = 0;

    const hide = () => {
        searchVersion += 1;
        window.clearTimeout(searchTimer);
        list.hidden = true;
        list.replaceChildren();
        matchRange = null;
        activeIndex = -1;
    };
    const containsName = (text, name) => {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
    };
    const activeButtons = () => Array.from(list.querySelectorAll('button'));
    const select = (person) => {
        if (!matchRange) return;
        const before = input.value.slice(0, matchRange.start);
        const after = input.value.slice(matchRange.end);
        const inserted = `@${person.display_name} `;
        input.value = `${before}${inserted}${after}`;
        const caret = before.length + inserted.length;
        input.setSelectionRange(caret, caret);
        selected.set(String(person.id), { user_id: String(person.id), display_name: person.display_name, is_public: true });
        hide();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    };
    const show = async (query, start, end) => {
        const version = ++searchVersion;
        try {
            const people = await window.ImpactaAPI.get(`/people?query=${encodeURIComponent(query)}`);
            if (version !== searchVersion) return;
            list.replaceChildren();
            matchRange = { start, end };
            people.forEach((person, index) => {
                const option = element('button', 'mention-option');
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', 'false');
                const name = element('strong', '', person.display_name);
                option.append(name);
                if (person.headline) option.append(element('small', '', person.headline));
                option.addEventListener('mousedown', (event) => event.preventDefault());
                option.addEventListener('click', () => select(person));
                list.append(option);
                if (index === 0) activeIndex = 0;
            });
            if (!people.length) {
                hide();
                return;
            }
            list.hidden = false;
            activeButtons()[0]?.setAttribute('aria-selected', 'true');
        } catch {
            if (version === searchVersion) hide();
        }
    };

    input.addEventListener('input', () => {
        searchVersion += 1;
        window.clearTimeout(searchTimer);
        for (const [id, mention] of selected) {
            if (!containsName(input.value, mention.display_name)) selected.delete(id);
        }
        const caret = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, caret);
        const match = /(^|[\s([{])@([^\s@]*)$/u.exec(before);
        if (!match || match[2].length < 2 || match[2].length > 60) {
            hide();
            return;
        }
        const start = caret - match[0].length + match[1].length;
        searchTimer = window.setTimeout(() => void show(match[2], start, caret), 120);
    });
    input.addEventListener('keydown', (event) => {
        if (list.hidden) return;
        const buttons = activeButtons();
        if (event.key === 'Escape') {
            hide();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
            buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === activeIndex)));
        } else if (event.key === 'Enter' && buttons[activeIndex]) {
            event.preventDefault();
            buttons[activeIndex].click();
        }
    });
    input.addEventListener('blur', () => window.setTimeout(() => {
        if (!list.contains(document.activeElement)) hide();
    }, 120));

    return (body = input.value) => Array.from(selected.values())
        .filter((mention) => containsName(body, mention.display_name))
        .map((mention) => String(mention.user_id));
}

function renderMentionContent(node, text, mentions = []) {
    const source = String(text || '');
    const candidates = (Array.isArray(mentions) ? mentions : [])
        .filter((mention) => mention?.display_name && mention?.user_id)
        .sort((left, right) => String(right.display_name).length - String(left.display_name).length);
    const lower = source.toLocaleLowerCase('pt');
    const matches = [];
    for (const mention of candidates) {
        const token = `@${mention.display_name}`;
        const search = token.toLocaleLowerCase('pt');
        let from = 0;
        while (from < lower.length) {
            const start = lower.indexOf(search, from);
            if (start < 0) break;
            const end = start + token.length;
            const previous = start > 0 ? source[start - 1] : '';
            const next = source[end] || '';
            const validBefore = !previous || !/[\p{L}\p{N}_]/u.test(previous);
            const validAfter = !next || !/[\p{L}\p{N}_]/u.test(next);
            if (validBefore && validAfter && !matches.some((item) => start < item.end && end > item.start)) {
                matches.push({ start, end, mention });
            }
            from = start + search.length;
        }
    }
    matches.sort((left, right) => left.start - right.start);
    node.replaceChildren();
    let cursor = 0;
    for (const match of matches) {
        if (match.start < cursor) continue;
        if (match.start > cursor) node.append(document.createTextNode(source.slice(cursor, match.start)));
        const label = source.slice(match.start, match.end);
        const token = match.mention.is_public
            ? element('a', 'mention-token', label)
            : element('span', 'mention-token', label);
        if (token.tagName === 'A') token.href = `profile.html?id=${encodeURIComponent(match.mention.user_id)}`;
        node.append(token);
        cursor = match.end;
    }
    if (cursor < source.length) node.append(document.createTextNode(source.slice(cursor)));
}

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = iconMarkup[name] || iconMarkup.profile;
    return svg;
}

function iconButton(className, iconName, label, count) {
    const button = element('button', `${className} icon-action`);
    button.type = 'button';
    button.dataset.tooltip = label;
    button.setAttribute('aria-label', label);
    const labelNode = element('span', 'visually-hidden action-label', label);
    button.append(icon(iconName), labelNode);
    if (count !== undefined) button.append(element('span', 'action-count', String(count)));
    return button;
}

function updateIconButton(button, label, count) {
    button.dataset.tooltip = label;
    button.setAttribute('aria-label', label);
    const labelNode = button.querySelector('.action-label');
    if (labelNode) labelNode.textContent = label;
    const countNode = button.querySelector('.action-count');
    if (countNode && count !== undefined) countNode.textContent = String(count);
}

function avatarImage(node, url, name, accountId = '') {
    if (!node) return;
    const userId = accountId ? String(accountId) : '';
    const cached = userId ? window.ImpactaAPI.cachedAvatarPreview() : null;
    if (!url) {
        if (cached?.userId === userId && cached.dataUrl) {
            if (node.dataset.avatarUserId === userId && node.dataset.avatarSource === cached.avatarUrl
                && node.querySelector('img')) return;
            node.dataset.avatarUserId = userId;
            node.dataset.avatarSource = cached.avatarUrl;
            const preview = document.createElement('img');
            preview.src = cached.dataUrl;
            preview.alt = '';
            preview.decoding = 'sync';
            node.replaceChildren(preview);
            return;
        }
        node.replaceChildren();
        node.textContent = initials(name);
        delete node.dataset.avatarSource;
        delete node.dataset.avatarUserId;
        return;
    }

    if (cached?.userId === userId && cached.avatarUrl === url) {
        if (node.dataset.avatarSource === url && node.querySelector('img')) return;
        node.dataset.avatarUserId = userId;
        node.dataset.avatarSource = url;
        const preview = document.createElement('img');
        preview.src = cached.dataUrl;
        preview.alt = '';
        preview.decoding = 'sync';
        node.replaceChildren(preview);
        return;
    }

    if (userId && node.dataset.avatarUserId && node.dataset.avatarUserId !== userId) {
        window.ImpactaAPI.clearAvatarPreview();
        node.replaceChildren();
        node.textContent = initials(name);
    } else if (!node.querySelector('img')) {
        node.textContent = initials(name);
    }
    if (node.dataset.avatarSource === url && node.querySelector('img')) return;
    node.dataset.avatarUserId = userId;
    node.dataset.avatarSource = url;

    const image = document.createElement('img');
    image.crossOrigin = 'use-credentials';
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.addEventListener('error', () => {
        if (node.dataset.avatarSource === url && node.querySelector('img') === image) {
            node.replaceChildren();
            node.textContent = initials(name);
        }
    }, { once: true });
    node.replaceChildren(image);
    image.src = window.ImpactaAPI.assetUrl(url);

    if (!userId) return;
    void window.ImpactaAPI.loadAvatarPreview(userId, url).then((dataUrl) => {
        const currentImage = node.querySelector('img');
        if (!dataUrl || !node.isConnected || node.dataset.avatarUserId !== userId
            || node.dataset.avatarSource !== url || (currentImage && currentImage !== image)) return;
        const preview = document.createElement('img');
        preview.src = dataUrl;
        preview.alt = '';
        preview.decoding = 'sync';
        node.replaceChildren(preview);
    });
}
function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => part[0]).join('').toLocaleUpperCase('pt');
}

function friendlyError(error, fallback) {
    if (error?.status === 404 && fallback?.toLocaleLowerCase('pt').includes('categorias')) {
        return 'A API que est\u00e1 a correr ainda n\u00e3o tem a rota de categorias. Reinicia o servidor da API.';
    }
    if (error?.code === 'internal_server_error') {
        const reference = error.requestId ? ` Refer\u00eancia: ${error.requestId}.` : '';
        return `A API n\u00e3o conseguiu concluir o pedido e registou a falha para diagn\u00f3stico.${reference}`;
    }
    const messages = {
        project_conversation_not_found: 'Esta conversa é privada e só está disponível para participantes e responsáveis do projecto.',
        project_chat_closed: 'Este projecto já não aceita mensagens.',
        project_message_not_found: 'Esta mensagem já não está disponível ou não pode ser alterada por esta conta.',
        invalid_project_message: 'Escreve uma mensagem com até 1 200 caracteres.',
        project_message_rate_limit: 'Atingiste o limite de mensagens por hora nesta conversa. Tenta mais tarde.',
        project_message_report_rate_limit: 'Atingiste o limite de denúncias por hora. Tenta mais tarde.',
        invalid_project_message_report: 'Escolhe um motivo válido e confirma os detalhes da denúncia.',
        invalid_project_messages_query: 'Não foi possível carregar esta parte da conversa. Actualiza e tenta novamente.',
        project_not_found: 'Não encontrámos este projecto. Pode ter sido removido. Actualiza a lista e tenta novamente.',
        project_not_open: 'Este projecto já não está aprovado ou as inscrições foram encerradas. Actualiza a lista para veres os projectos disponíveis.',
        project_community_unavailable: 'A comunidade deste projecto está inactiva ou privada. Já não é possível pedir adesão.',
        project_membership_setup_required: 'Não foi possível registar a tua inscrição neste projecto. A equipa técnica está a verificar o problema; tenta novamente mais tarde.',
        share_rate_limit: 'Atingiste o limite de partilhas por hora. Tenta mais tarde.',
        notification_not_found: 'Esta notificação já não está disponível.',
        post_not_found: 'Esta publica\u00e7\u00e3o j\u00e1 n\u00e3o est\u00e1 dispon\u00edvel ou n\u00e3o pode ser editada por esta conta.',
        comment_not_found: 'Este coment\u00e1rio j\u00e1 n\u00e3o est\u00e1 dispon\u00edvel ou n\u00e3o pode ser editado por esta conta.',
        invalid_mentions: 'Rev\u00ea as pessoas marcadas. S\u00f3 podes mencionar perfis p\u00fablicos que aparecem no texto.',
        invalid_people_query: 'Escreve pelo menos duas letras para procurar pessoas.',
        impactation_request_not_found: 'Este pedido de impacta\u00e7\u00e3o j\u00e1 n\u00e3o est\u00e1 dispon\u00edvel.',
        impactation_request_already_handled: 'Este pedido j\u00e1 recebeu uma resposta.',
        profile_not_found: 'Este perfil j\u00e1 n\u00e3o est\u00e1 dispon\u00edvel.',
        api_unavailable: 'A ligação à plataforma não está disponível. Tenta novamente.',
        api_timeout: 'A plataforma demorou demasiado a responder. Tenta novamente dentro de alguns instantes.',
        internal_server_error: 'Não foi possível concluir esta acção. A equipa técnica foi informada. Tenta novamente mais tarde.',
        authentication_required: 'A tua sessão terminou. Entra novamente para continuar.',
        csrf_validation_failed: 'A sessão de segurança expirou. Atualiza a página e tenta novamente.',
        post_rate_limit: 'Atingiste o limite de publicações por hora. Tenta mais tarde.',
        comment_rate_limit: 'Atingiste o limite de comentários por hora. Tenta mais tarde.',
        challenge_rate_limit: 'Atingiste o limite de participações por hora. Tenta mais tarde.',
        challenge_delivery_not_allowed: 'A entrega só fica disponível depois de a tua participação ser aceite.',
        challenge_evidence_not_allowed: 'Já não podes anexar evidências nesta etapa do desafio.',
        challenge_evidence_limit: 'Anexa até quatro imagens ou um vídeo por etapa.',
        challenge_evidence_too_large: 'Cada imagem pode ter até 12 MB e cada vídeo até 100 MB antes da otimização.',
        unsupported_challenge_evidence_type: 'Escolhe uma imagem JPEG, PNG ou WebP, ou um vídeo MP4.',
        report_rate_limit: 'Atingiste o limite de denúncias por hora. Tenta mais tarde.',
        already_participating: 'Já enviaste uma participação neste desafio.',
        resource_rate_limit: 'Atingiste o limite de propostas por hora. Tenta novamente mais tarde.',
        challenge_create_rate_limit: 'Atingiste o limite de desafios por hora. Tenta novamente mais tarde.',
        community_membership_required: 'É necessário seres membro ativo desta comunidade para continuar.',
        community_chat_locked: 'A pessoa responsável pausou temporariamente as mensagens. Só ela pode enviar mensagens até reabrir a conversa.',
        community_join_rate_limit: 'Atingiste o limite de pedidos para entrar em comunidades. Tenta mais tarde.',
        membership_blocked: 'O responsável não permite novos pedidos para esta comunidade.',
        request_not_pending: 'Este pedido já foi analisado. Atualiza a lista para ver o estado atual.',
        invalid_community_chat_lock: 'Escolhe um período válido para pausar ou reabrir as mensagens.',
        community_not_found: 'Esta comunidade já não está disponível.',
        community_message_rate_limit: 'Atingiste o limite de mensagens por hora nesta comunidade. Tenta mais tarde.',
        community_report_rate_limit: 'Atingiste o limite de denúncias por hora. Tenta mais tarde.',
        community_report_target_not_found: 'A comunidade ou mensagem já não está disponível.',
        invalid_community_report: 'Escolhe um motivo válido para a denúncia.',
        already_reported: 'Já enviaste uma denúncia que está a ser analisada.',
        cannot_report_own_message: 'Não podes denunciar uma mensagem da tua própria conta.',
        community_content_not_allowed: 'Este texto parece conter conteúdo sexual explícito, exploração ou apelo à violência. Contexto educativo e denúncia continuam permitidos.',
        invalid_location_filter: 'Escreve uma localidade com até 100 caracteres.',
        community_media_rate_limit: 'Atingiste o limite de anexos por hora. Tenta mais tarde.',
        unsupported_community_media_type: 'Escolhe uma imagem JPEG, PNG ou WebP, ou um vídeo MP4.',
        community_media_too_large: 'A imagem pode ter até 12 MB e o vídeo até 100 MB antes da otimização.',
        project_management_required: 'Só a pessoa responsável, a gestão/moderação da comunidade ou uma conta com revisão autorizada pode criar desafios.',
        project_update_access_required: 'Só membros e responsáveis do projecto podem publicar actualizações em seu nome.',
        project_review_required: 'Não tens permissão para consultar as participações deste projecto.',
        invalid_project_id: 'Escolhe um projecto válido para associar à publicação.',
        project_participation_not_found: 'Esta participação já não está disponível.',
        cannot_review_own_participation: 'Outra pessoa responsável deve analisar a tua própria participação.',
        challenge_review_rate_limit: 'Atingiste o limite de análises por hora. Tenta mais tarde.',
        invalid_challenge_participation_decision: 'Escolhe uma decisão válida para esta participação.',
        invalid_challenge_delivery: 'Descreve o resultado que entregaste.',
        challenge_participation_already_reviewed: 'Esta participação já foi analisada. Actualiza a lista.',
        invalid_community: 'Confirma o nome e a descrição da comunidade.',
        invalid_project: 'Confirma o título, a descrição e as datas do projecto.',
        invalid_challenge: 'Confirma o título, a descrição e as datas do desafio.',
        challenge_dates_outside_project: 'As datas do desafio devem ficar dentro do período do projecto.',
        invalid_impact_area: 'A área escolhida já não está disponível. Atualiza a página.',
        invalid_post_body: 'Escreve uma publicação com até 2000 caracteres.',
        invalid_post_category: 'Escolhe uma categoria válida para a publicação.',
        invalid_post_custom_category: 'O tema próprio pode ter até 60 caracteres e só pode ser usado em “Outra categoria”.',
        post_categories_unavailable: 'As categorias ainda não estão disponíveis. Atualiza a página depois de aplicar a migração de categorias.',
        unsupported_post_media_type: 'Escolhe imagens JPEG, PNG ou WebP, ou um vídeo MP4.',
        invalid_post_media: 'Confirma os anexos: até quatro imagens ou um vídeo por publicação.',
        post_media_too_large: 'Cada imagem deve ter até 12 MB e cada vídeo até 100 MB.',
        invalid_post_image: 'Não foi possível ler uma das imagens. Escolhe outro ficheiro.',
        invalid_post_video: 'Não foi possível ler o vídeo. Confirma que é um MP4 válido com uma faixa de vídeo.',
        post_video_too_long: 'Este vídeo tem mais de 90 segundos. Escolhe um vídeo mais curto.',
        post_video_resolution_too_large: 'Este vídeo excede a resolução máxima 4K. Exporta-o em até 4096 × 2160 e tenta novamente.',
        video_processor_unavailable: 'A conversão de vídeo ainda não está instalada no servidor. Podes publicar imagens enquanto isso.',
        video_processing_failed: 'O servidor não conseguiu converter este vídeo. Exporta-o como MP4 com vídeo H.264 e tenta novamente.',
        video_processing_timeout: 'A conversão demorou demasiado. Tenta um vídeo mais curto ou leve.',
        video_processing_busy: 'Há outro vídeo a ser processado agora. Aguarda alguns segundos e tenta novamente.',
        processed_media_too_large: 'O ficheiro convertido continua demasiado grande. Escolhe outro ficheiro.',
        media_rate_limit: 'Atingiste o limite de anexos por hora. Tenta mais tarde.',
        invalid_comment_body: 'Escreve um comentário com até 1000 caracteres.',
        feed_content_not_allowed: 'Este texto parece conter conteúdo sexual explícito, uma ameaça ou um apelo à violência. Contexto educativo continua permitido.',
        invalid_submission: 'Escreve a tua proposta para participar.',
        invalid_report_reason: 'Seleciona um motivo para a denúncia.'
    };
    return messages[error?.code] || fallback;
}

function expandableDescription(text, className) {
    const description = String(text || '').trim();
    const paragraph = element('p', className, description);
    if (Array.from(description).length <= 240) return paragraph;

    const group = element('div', `expandable-description ${className}-group`);
    const toggle = element('button', 'description-toggle', 'Ver mais');
    paragraph.classList.add('is-collapsed');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
        const expanded = paragraph.classList.toggle('is-expanded');
        paragraph.classList.toggle('is-collapsed', !expanded);
        toggle.textContent = expanded ? 'Ver menos' : 'Ver mais';
        toggle.setAttribute('aria-expanded', String(expanded));
    });
    group.append(paragraph, toggle);
    return group;
}

async function endSession(button) {
    button.disabled = true;
    try {
        await window.ImpactaAPI.delete('/auth/session');
    } catch (error) {
        button.disabled = false;
        if (composerHint) composerHint.textContent = friendlyError(error, 'Não foi possível terminar a sessão. Tenta novamente.');
    }
    window.ImpactaAPI.clearAvatarPreview();
    window.location.assign('index.html');
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-AO');
}

function showPostMedia(index) {
    if (!postMediaDialog || !postMediaStage || !activePostMedia.length) return;
    activePostMediaIndex = (index + activePostMedia.length) % activePostMedia.length;
    const media = activePostMedia[activePostMediaIndex];
    const viewer = document.createElement(media.type === 'video' ? 'video' : 'img');
    viewer.className = 'feed-media-viewer';
    viewer.crossOrigin = 'use-credentials';
    viewer.src = media.url;
    if (viewer instanceof HTMLVideoElement) {
        viewer.controls = true;
        viewer.playsInline = true;
        viewer.preload = 'metadata';
        viewer.setAttribute('aria-label', 'Vídeo da publicação');
    } else {
        viewer.alt = `Fotografia ${activePostMediaIndex + 1} da publicação`;
        viewer.decoding = 'async';
    }
    postMediaStage.replaceChildren(viewer);
    if (postMediaCounter) postMediaCounter.textContent = `${activePostMediaIndex + 1} / ${activePostMedia.length}`;
    if (postMediaPrevious) postMediaPrevious.disabled = activePostMedia.length < 2;
    if (postMediaNext) postMediaNext.disabled = activePostMedia.length < 2;
}

function openPostMedia(items, index) {
    if (!(postMediaDialog instanceof HTMLDialogElement)) return;
    activePostMedia = items;
    showPostMedia(index);
    if (typeof postMediaDialog.showModal === 'function') postMediaDialog.showModal();
    else postMediaDialog.setAttribute('open', '');
}

postMediaPrevious?.addEventListener('click', () => showPostMedia(activePostMediaIndex - 1));
postMediaNext?.addEventListener('click', () => showPostMedia(activePostMediaIndex + 1));
postMediaClose?.addEventListener('click', () => postMediaDialog?.close());
postMediaDialog?.addEventListener('click', (event) => {
    if (event.target === postMediaDialog) postMediaDialog.close();
});
postMediaDialog?.addEventListener('close', () => {
    postMediaStage?.replaceChildren();
    activePostMedia = [];
    activePostMediaIndex = 0;
});
document.addEventListener('keydown', (event) => {
    if (!postMediaDialog?.open || activePostMedia.length < 2) return;
    if (event.key === 'ArrowRight') showPostMedia(activePostMediaIndex + 1);
    if (event.key === 'ArrowLeft') showPostMedia(activePostMediaIndex - 1);
});

function updateEmptyState() {
    if (!emptyState || !postList) return;
    emptyState.hidden = postList.querySelectorAll('[data-post]').length > 0;
    if (!emptyState.hidden) return;
    emptyState.textContent = searchField?.value.trim() || categoryFilter?.value
        ? 'Nenhuma publicação corresponde aos filtros selecionados.'
        : 'Ainda não há publicações da comunidade. Partilha a primeira ideia no feed do IMPACTA.';
}

function getMatchingFeedPosts() {
    const query = searchField?.value.trim().toLocaleLowerCase('pt') || '';
    const selectedCategory = categoryFilter?.value || '';
    return feedPosts.filter((post) => {
        const searchableText = [
            post.body, post.author, post.author_headline, post.community,
            post.custom_category, post.category,
            ...(Array.isArray(post.mentions) ? post.mentions.map((mention) => mention.display_name || '') : [])
        ].join(' ').toLocaleLowerCase('pt');
        return searchableText.includes(query)
            && (!selectedCategory || (post.category_code || 'community') === selectedCategory);
    });
}

function sortFeedPosts(posts) {
    return posts.sort((a, b) => {
        const supportOrder = sortField?.value === 'supported'
            ? Number(b.support_count) - Number(a.support_count)
            : 0;
        if (supportOrder) return supportOrder;
        const dateOrder = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (dateOrder) return dateOrder;
        const aId = BigInt(a.id);
        const bId = BigInt(b.id);
        return aId > bId ? -1 : aId < bId ? 1 : 0;
    });
}

function applyFilterAndSort({ resetVisible = false, appendOnly = false } = {}) {
    if (resetVisible) visiblePostCount = POST_BATCH_SIZE;
    const query = searchField?.value.trim().toLocaleLowerCase('pt') || '';
    const matchingPosts = sortFeedPosts(getMatchingFeedPosts());

    const visiblePosts = matchingPosts.slice(0, visiblePostCount);
    if (appendOnly) {
        const renderedIds = new Set([...postList.querySelectorAll('[data-post-id]')].map((post) => post.dataset.postId));
        visiblePosts.forEach((post) => {
            if (!renderedIds.has(String(post.id))) postList.append(createPost(post));
        });
    } else {
        postList.replaceChildren(...visiblePosts.map(createPost));
    }
    if (postsMoreButton) postsMoreButton.hidden = matchingPosts.length <= visiblePostCount && !hasMoreFeedPosts;
    updateEmptyState();

    [challengeList, projectList, communityList].forEach((list) => {
        list?.querySelectorAll('[data-searchable]').forEach((card) => {
            card.hidden = !card.textContent.toLocaleLowerCase('pt').includes(query);
        });
    });
}

function updateCharacterCount() {
    if (characterCount && composerInput) {
        characterCount.textContent = `${Array.from(composerInput.value).length}/2000`;
    }
}

function setComposerAccess() {
    const canPost = Boolean(currentUser);
    composerInput.disabled = !canPost;
    composerButton.disabled = !canPost || !postCategoriesReady;
    if (chooseMediaButton) chooseMediaButton.disabled = !canPost || !postCategoriesReady;
    if (postCategoryField) postCategoryField.disabled = !canPost || !postCategoriesReady;
    if (customCategoryField) customCategoryField.disabled = !canPost || !postCategoriesReady;
    const login = document.querySelector('.composer-login');
    if (login) login.hidden = canPost;
    if (composerAuthor) {
        const displayName = String(currentUser?.displayName || currentUser?.name || '').trim();
        composerAuthor.textContent = displayName || 'Utilizador';
        composerAuthor.hidden = !canPost;
    }
    if (composerHint) {
        composerHint.textContent = canPost
            ? 'Partilha com respeito.'
            : 'Entra na tua conta para partilhar com a comunidade.';
    }
    const avatar = document.querySelector('.composer-avatar');
    if (avatar && canPost) {
        if (Object.prototype.hasOwnProperty.call(currentUser, 'avatarUrl')) {
            avatarImage(avatar, currentUser.avatarUrl, currentUser.displayName, currentUser.id);
        } else {
            avatar.textContent = initials(currentUser.displayName);
        }
    }
}

function updateCustomCategoryVisibility() {
    const isOtherCategory = postCategoryField?.value === 'other';
    if (customCategoryControl) customCategoryControl.hidden = !isOtherCategory;
    if (!isOtherCategory && customCategoryField) customCategoryField.value = '';
}

postCategoryField?.addEventListener('change', updateCustomCategoryVisibility);

async function loadPostCategories() {
    postCategoriesReady = false;
    setComposerAccess();
    try {
        const categories = await window.ImpactaAPI.get('/feed/categories');
        if (!categories.length) {
            throw Object.assign(new Error('post_categories_unavailable'), { code: 'post_categories_unavailable' });
        }
        postCategories = categories;
        if (postCategoryField) {
            const placeholder = element('option', '', 'Escolhe uma categoria');
            placeholder.value = '';
            postCategoryField.replaceChildren(placeholder);
            categories.forEach((category) => {
                const option = element('option', '', category.name);
                option.value = category.code;
                postCategoryField.append(option);
            });
        }
        if (categoryFilter) {
            const allOption = element('option', '', 'Todas as categorias');
            allOption.value = '';
            categoryFilter.replaceChildren(allOption);
            categories.forEach((category) => {
                const option = element('option', '', category.name);
                option.value = category.code;
                categoryFilter.append(option);
            });
            updateFeedSearchScope();
        }
        updateCustomCategoryVisibility();
        postCategoriesReady = true;
        setComposerAccess();
        applyFilterAndSort();
    } catch (error) {
        const unavailable = element('option', '', 'Categorias indisponíveis');
        unavailable.value = '';
        if (postCategoryField) postCategoryField.replaceChildren(unavailable);
        if (currentUser && composerStatus) {
            composerStatus.textContent = friendlyError(error, 'Não foi possível carregar as categorias. Aplica a migração de categorias e atualiza a página.');
        }
        setComposerAccess();
    }
}

function renderSelectedMedia() {
    if (!mediaPreview) return;
    for (const entry of selectedMedia) {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    mediaPreview.replaceChildren();
    mediaPreview.hidden = selectedMedia.length === 0;
    selectedMedia.forEach((entry, index) => {
        const file = entry.file;
        const item = element('div', 'composer-media-item');
        const preview = file.type === 'video/mp4' ? element('video', '') : element('img', '');
        preview.src = URL.createObjectURL(file);
        entry.previewUrl = preview.src;
        if (preview instanceof HTMLVideoElement) {
            preview.muted = true;
            preview.playsInline = true;
        } else {
            preview.alt = file.name;
        }
        const remove = element('button', 'composer-media-remove', 'Remover anexo');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remover ${file.name}`);
        remove.addEventListener('click', () => {
            URL.revokeObjectURL(entry.previewUrl);
            selectedMedia.splice(index, 1);
            renderSelectedMedia();
        });
        const name = element('span', '', file.name);
        item.append(preview, remove, name);
        mediaPreview.append(item);
    });
}

function validateSelectedMedia(files) {
    if (!files.length) return true;
    const kinds = files.map((file) => file.type);
    const videos = kinds.filter((type) => type === 'video/mp4').length;
    const images = kinds.filter((type) => ['image/jpeg', 'image/png', 'image/webp'].includes(type)).length;
    if (videos + images !== files.length || (videos && (files.length !== 1 || selectedMedia.length > 0))
        || (images && (selectedMedia.some((entry) => entry.file.type === 'video/mp4') || files.length + selectedMedia.length > 4))) {
        composerStatus.textContent = 'Podes anexar até quatro imagens ou um único vídeo MP4.';
        return false;
    }
    if (files.some((file) => file.size <= 0 || file.size > (file.type === 'video/mp4' ? 100 : 12) * 1024 * 1024)) {
        composerStatus.textContent = 'Cada imagem deve ter até 12 MB e cada vídeo até 100 MB.';
        return false;
    }
    return true;
}

chooseMediaButton?.addEventListener('click', () => mediaPicker?.click());
mediaPicker?.addEventListener('change', () => {
    const files = [...(mediaPicker.files || [])];
    mediaPicker.value = '';
    if (!validateSelectedMedia(files)) return;
    selectedMedia.push(...files.map((file) => ({ file, previewUrl: '' })));
    composerStatus.textContent = '';
    renderSelectedMedia();
});

function renderFeedHeaderAccount(user) {
    const accountActions = document.querySelector('.feed-header-actions');
    if (!accountActions) return;
    setDirectMessageShortcutsVisible(Boolean(user));
    if (user) {
        void refreshDirectMessageBadges();
        if (directMessageBadgeRefreshTimer === null) {
            directMessageBadgeRefreshTimer = window.setInterval(() => { void refreshDirectMessageBadges(); }, 30000);
        }
    } else {
        if (directMessageBadgeRefreshTimer !== null) {
            window.clearInterval(directMessageBadgeRefreshTimer);
            directMessageBadgeRefreshTimer = null;
        }
        directMessageLinks.forEach((link) => {
            const badge = link.querySelector('[data-direct-message-badge]');
            if (badge) { badge.textContent = ''; badge.hidden = true; }
            link.setAttribute('aria-label', 'Mensagens');
        });
    }
    const accountControl = accountActions.querySelector('.user-chip');

    if (!user) {
        window.ImpactaAPI.clearAvatarPreview();
        accountActions.dataset.accountState = 'anonymous';
        if (!accountControl || accountControl.tagName !== 'A' || accountControl.classList.contains('profile-chip')) {
            const loginLink = element('a', 'user-chip', 'Entrar');
            loginLink.href = 'index.html#login';
            loginLink.setAttribute('aria-label', 'Entrar na conta');
            loginLink.dataset.tooltip = 'Entrar';
            if (accountControl) accountControl.replaceWith(loginLink);
            else accountActions.append(loginLink);
        }
        if (mobileAccountLink) mobileAccountLink.hidden = false;
        if (mobileLogoutButton) mobileLogoutButton.hidden = true;
        return;
    }

    accountActions.dataset.accountState = 'authenticated';
    let avatar = accountActions.querySelector('.profile-chip');
    if (!avatar) {
        avatar = element('a', 'user-chip profile-chip');
        avatar.href = 'profile.html';
        avatar.dataset.tooltip = 'O teu perfil';
        accountControl?.replaceWith(avatar);
        if (!accountControl) accountActions.prepend(avatar);
    }
    avatar.href = 'profile.html';
    avatar.setAttribute('aria-label', `Abrir perfil de ${user.displayName || 'utilizador'}`);
    if (Object.prototype.hasOwnProperty.call(user, 'avatarUrl')) {
        avatarImage(avatar, user.avatarUrl, user.displayName, user.id);
    } else if (!avatar.querySelector('img')) {
        avatar.textContent = initials(user.displayName);
    }

    if (!accountActions.querySelector('.logout-button')) {
        const logoutButton = element('button', 'logout-button', 'Sair');
        logoutButton.type = 'button';
        logoutButton.addEventListener('click', () => { void endSession(logoutButton); });
        accountActions.append(logoutButton);
    }
    if (mobileAccountLink) {
        mobileAccountLink.href = 'profile.html';
        const mobileAccountLabel = mobileAccountLink.querySelector('span');
        if (mobileAccountLabel) mobileAccountLabel.textContent = 'O teu perfil';
        mobileAccountLink.setAttribute('aria-label', `Abrir perfil de ${user.displayName || 'utilizador'}`);
        mobileAccountLink.hidden = false;
    }
    if (mobileLogoutButton) mobileLogoutButton.hidden = false;
    if (notificationsToggle) notificationsToggle.hidden = false;
    syncFeedNavigationSlots();
}

function setFeedHeaderAccountUnavailable() {
    const accountActions = document.querySelector('.feed-header-actions');
    if (accountActions) accountActions.dataset.accountState = 'unavailable';
    setDirectMessageShortcutsVisible(Boolean(cachedAvatarPreview));

    if (mobileAccountLink) mobileAccountLink.hidden = true;
    if (mobileLogoutButton) mobileLogoutButton.hidden = true;
}
async function loadCurrentAccount() {
    try {
        const session = await window.ImpactaAPI.currentSession();
        currentUser = session?.authenticated ? session.user : null;
        renderFeedHeaderAccount(currentUser);
        if (currentUser) {
            try {
                const result = await window.ImpactaAPI.request('/profile');
                currentUser = { ...currentUser, ...result.profile };
                renderFeedHeaderAccount(currentUser);
            } catch {
                // The feed and account session remain usable while profile details are unavailable.
            }
        }
    } catch {
        currentUser = null;
        setFeedHeaderAccountUnavailable();
        if (composerHint) composerHint.textContent = 'Não foi possível confirmar a sessão. Atualiza a página ou entra novamente.';
    }

    setComposerAccess();
    if (openProjectDialogButton) openProjectDialogButton.hidden = !currentUser;
    if (projectLoginLink) projectLoginLink.hidden = Boolean(currentUser);
    if (openCommunityDialogButton) openCommunityDialogButton.hidden = !currentUser;
    if (communityLoginLink) communityLoginLink.hidden = Boolean(currentUser);
    if (currentUser) {
        document.querySelector('.community-note')?.remove();
        const footerLinks = document.querySelector('#feed-footer-links');
        if (footerLinks) {
            const helpButton = element('a', 'feed-help-button', 'Ajuda');
            helpButton.href = 'help.html';
            const linkedInSeparator = element('span', '', '·');
            linkedInSeparator.setAttribute('aria-hidden', 'true');
            const linkedInLink = element('a', '', 'LinkedIn');
            linkedInLink.href = 'https://www.linkedin.com/company/impacta-angola/';
            linkedInLink.target = '_blank';
            linkedInLink.rel = 'noopener noreferrer';
            const emailSeparator = element('span', '', '·');
            emailSeparator.setAttribute('aria-hidden', 'true');
            const emailLink = element('a', '', 'E-mail');
            emailLink.href = 'mailto:impactaa2025@gmail.com';
            emailLink.setAttribute('aria-label', 'Enviar e-mail para impactaa2025@gmail.com');
            footerLinks.replaceChildren(helpButton, linkedInSeparator, linkedInLink, emailSeparator, emailLink);
        }
    }
    if (!currentUser) return;

    void window.ImpactaAPI.request('/admin/access').then((access) => {
        if (access?.canManageReports || access?.canManageCommunities || access?.canReviewProjects) {
            const desktopAdminLink = document.querySelector('#feed-admin-link');
            const mobileAdminLink = document.querySelector('#feed-mobile-admin-link');
            if (desktopAdminLink) desktopAdminLink.hidden = false;
            if (mobileAdminLink) mobileAdminLink.hidden = false;
            syncFeedNavigationSlots();
        }
    }).catch(() => {
        // Admin navigation stays hidden when this account has no admin permission.
    });

    if (notificationsToggle) notificationsToggle.hidden = false;
    syncFeedNavigationSlots();


}

function notificationMessage(notification) {
    const actor = notification.actor_name || 'Alguém';
    if (notification.type === 'space_proposal_reviewed') {
        const approved = notification.payload?.status === 'active';
        return approved
            ? 'A tua proposta foi aprovada e já está disponível.'
            : 'A tua proposta não foi aprovada.';
    }
    if (notification.type === 'post_reaction') return `${actor} apoiou a tua publicação`;
    if (notification.type === 'post_comment') return `${actor} comentou na tua publicação`;
    if (notification.type === 'post_share') return `${actor} partilhou a tua publicação`;
    if (notification.type === 'post_mention') return `${actor} mencionou-te numa publicação`;
    if (notification.type === 'comment_mention') return `${actor} mencionou-te num comentário`;
    if (notification.type === 'impactation_request') return `${actor} enviou-te um pedido de impactação`;
    if (notification.type === 'impactation_accepted') return `${actor} aceitou o teu pedido de impactação`;
    if (notification.type === 'impactation_declined') return `${actor} respondeu ao teu pedido de impactação`;
    return 'Tens uma nova notificação';
}

function renderNotifications(items, unreadCount) {
    if (!notificationList || !notificationsBadge || !notificationsToggle) return;
    notificationList.replaceChildren();
    const unread = Number(unreadCount) || 0;
    notificationsBadge.hidden = unread === 0;
    notificationsBadge.textContent = unread > 99 ? '99+' : String(unread);
    notificationsToggle.setAttribute('aria-label', unread
        ? `Notificações, ${unread} por ler`
        : 'Notificações');
    if (notificationsMarkAll) notificationsMarkAll.hidden = unread === 0;

    if (!items.length) {
        notificationList.append(element('p', 'notification-empty', 'Ainda não tens notificações.'));
        return;
    }

    items.forEach((notification) => {
        const item = element('article', `notification-item${notification.read_at ? '' : ' is-unread'}`);
        item.setAttribute('role', 'listitem');
        const open = element('button', 'notification-open');
        open.type = 'button';
        const message = element('strong', 'notification-message', notificationMessage(notification));
        const excerpt = ['post_comment', 'post_mention', 'comment_mention'].includes(notification.type) && notification.comment_excerpt
            ? element('span', 'notification-excerpt', `“${notification.comment_excerpt}”`)
            : notification.type === 'space_proposal_reviewed' && notification.payload?.reason
                ? element('span', 'notification-excerpt', String(notification.payload.reason))
                : null;
        const date = element('small', 'notification-date', formatDate(notification.created_at));
        const copy = element('span', 'notification-copy');
        copy.append(message);
        if (excerpt) copy.append(excerpt);
        copy.append(date);
        open.append(copy);
        item.append(open);
        const markRead = async () => {
            if (notification.read_at) return;
            await window.ImpactaAPI.put(`/notifications/${encodeURIComponent(notification.id)}/read`, {});
            notification.read_at = new Date().toISOString();
        };
        open.addEventListener('click', async () => {
            const wasUnread = !notification.read_at;
            open.disabled = true;
            try {
                await markRead();
                notificationPanel.hidden = true;
                notificationsToggle.setAttribute('aria-expanded', 'false');
                renderNotifications(items, Math.max(0, unread - (wasUnread ? 1 : 0)));
                if (notification.type === 'space_proposal_reviewed') {
                    notificationPanel.hidden = false;
                    notificationsToggle.setAttribute('aria-expanded', 'true');
                    if (notificationStatus) notificationStatus.textContent = notificationMessage(notification)
                        + (notification.payload?.reason ? ` Motivo: ${notification.payload.reason}` : '');
                    return;
                }
                if (notification.type.startsWith('impactation_') && notification.actor_id) {
                    window.location.assign(`profile.html?id=${encodeURIComponent(notification.actor_id)}`);
                    return;
                }
                const post = document.getElementById(`publicacao-${notification.post_id}`);
                if (post) {
                    post.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    post.tabIndex = -1;
                    post.focus({ preventScroll: true });
                    void loadNotifications();
                } else if (notificationStatus) {
                    notificationPanel.hidden = false;
                    notificationsToggle.setAttribute('aria-expanded', 'true');
                    notificationStatus.textContent = 'A publicação já não está entre as mais recentes do feed.';
                }
            } catch (error) {
                open.disabled = false;
                if (notificationStatus) notificationStatus.textContent = friendlyError(error, 'Não foi possível abrir esta notificação.');
            }
        });
        if (notification.type === 'impactation_request' && notification.request_id
            && notification.request_status === 'pending') {
            const actions = element('div', 'notification-actions');
            for (const [decision, label] of [['accept', 'Aceitar'], ['decline', 'Recusar']]) {
                const action = element('button', `button button-small notification-action${decision === 'decline' ? ' notification-action-quiet' : ''}`, label);
                action.type = 'button';
                action.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    action.disabled = true;
                    try {
                        const result = await window.ImpactaAPI.post(`/impactations/requests/${encodeURIComponent(notification.request_id)}/respond`, { decision });
                        notification.request_status = result.status;
                        await markRead();
                        await loadNotifications();
                    } catch (error) {
                        action.disabled = false;
                        if (notificationStatus) notificationStatus.textContent = friendlyError(error, 'Não foi possível responder ao pedido.');
                    }
                });
                actions.append(action);
            }
            item.append(actions);
        } else if (notification.type === 'impactation_request') {
            const statusLabels = {
                accepted: 'Pedido aceite · já estão impactados',
                declined: 'Pedido recusado',
                cancelled: 'Pedido cancelado'
            };
            const response = element('span', 'notification-excerpt notification-request-status',
                statusLabels[notification.request_status] || 'Este pedido já foi encerrado.');
            item.append(response);
        }
        notificationList.append(item);
    });
}

async function loadNotifications() {
    if (!currentUser || !notificationsToggle) return;
    try {
        const result = await window.ImpactaAPI.request('/notifications');
        renderNotifications(Array.isArray(result.items) ? result.items : [], result.unreadCount);
        if (notificationStatus) notificationStatus.textContent = '';
    } catch (error) {
        if (notificationStatus && notificationPanel && !notificationPanel.hidden) {
            notificationStatus.textContent = friendlyError(error, 'Não foi possível carregar as notificações.');
        }
    }
}

function projectNotificationMessage(notification) {
    const actor = notification.actor_name || 'Um membro';
    if (notification.type === 'project_member_joined') return `${actor} juntou-se ao projecto.`;
    if (notification.type === 'project_challenge_created') {
        return `${actor} publicou um desafio${notification.challenge_title ? `: ${notification.challenge_title}` : ' neste projecto'}.`;
    }
    if (notification.type === 'project_challenge_submission') {
        return `${actor} participou num desafio${notification.challenge_title ? `: ${notification.challenge_title}` : ''}.`;
    }
    if (notification.type === 'project_challenge_participation_reviewed') {
        const title = notification.challenge_title ? ` em ${notification.challenge_title}` : '';
        if (notification.decision === 'approve') return `A tua participação${title} foi aceite. Já podes colaborar na conversa do projecto.`;
        if (notification.decision === 'complete') return `O resultado${title} foi confirmado como concluído.`;
        if (notification.decision === 'request_changes') return `A equipa pediu ajustes na tua entrega${title}. Consulta o motivo no desafio.`;
        return `A tua participação${title} não foi aceite. Consulta o motivo no desafio.`;
    }
    if (notification.type === 'project_challenge_delivery') {
        return `${actor} enviou o resultado de um desafio${notification.challenge_title ? `: ${notification.challenge_title}` : ''}.`;
    }
    return 'Há nova actividade neste projecto.';
}

async function loadProjectNotifications(projectId, panel, badge) {
    panel.replaceChildren(element('p', 'notification-status', 'A carregar actividade…'));
    try {
        const result = await window.ImpactaAPI.request(`/projects/${encodeURIComponent(projectId)}/notifications`);
        panel.replaceChildren();
        const heading = element('strong', 'project-notification-heading', 'Actividade do projecto');
        const list = element('div', 'project-notification-list');
        const markAll = element('button', 'button-quiet project-notification-mark-all', 'Marcar como lida');
        markAll.type = 'button';
        markAll.hidden = Number(result.unreadCount) === 0;
        markAll.addEventListener('click', async () => {
            markAll.disabled = true;
            try {
                await window.ImpactaAPI.post(`/projects/${encodeURIComponent(projectId)}/notifications/read-all`, {});
                await loadProjectNotifications(projectId, panel, badge);
                await refreshEntityNotificationBadges();
            } catch (error) {
                markAll.disabled = false;
                list.prepend(element('p', 'notification-status is-error', friendlyError(error, 'Não foi possível actualizar a actividade.')));
            }
        });
        const items = Array.isArray(result.items) ? result.items : [];
        if (!items.length) list.append(element('p', 'notification-empty', 'Ainda não há actividade neste projecto.'));
        items.forEach((notification) => {
            const item = element('article', `project-notification-item${notification.read_at ? '' : ' is-unread'}`);
            const open = element('button', 'project-notification-open', projectNotificationMessage(notification));
            open.type = 'button';
            const date = element('small', 'notification-date', formatDate(notification.created_at));
            open.append(date);
            open.addEventListener('click', async () => {
                if (notification.read_at) return;
                open.disabled = true;
                try {
                    await window.ImpactaAPI.put(`/notifications/${encodeURIComponent(notification.id)}/read`, {});
                    notification.read_at = new Date().toISOString();
                    item.classList.remove('is-unread');
                    await refreshEntityNotificationBadges();
                    markAll.hidden = true;
                } catch (error) {
                    open.disabled = false;
                    list.prepend(element('p', 'notification-status is-error', friendlyError(error, 'Não foi possível marcar a actividade como lida.')));
                }
            });
            item.append(open);
            list.append(item);
        });
        panel.append(heading, markAll, list);
        badge.setAttribute('aria-expanded', 'true');
    } catch (error) {
        panel.replaceChildren(element('p', 'notification-status is-error', friendlyError(error, 'Não foi possível carregar a actividade do projecto.')));
    }
}

async function refreshEntityNotificationBadges() {
    if (!currentUser || entityActivityRefreshPromise) return entityActivityRefreshPromise;
    entityActivityRefreshPromise = (async () => {
        try {
            const result = await window.ImpactaAPI.request('/activity/badges');
            const communityCounts = new Map((result.communities || []).map((item) => [String(item.id), Number(item.unread_count) || 0]));
            const projectCounts = new Map((result.projects || []).map((item) => [String(item.id), Number(item.unread_count) || 0]));
            const projectMessageCounts = new Map((result.projectMessages || []).map((item) => [String(item.id), Number(item.unread_count) || 0]));
            document.querySelectorAll('.community-entry[data-community-id]').forEach((card) => {
                const badge = card.querySelector('.community-unread-count');
                if (!badge) return;
                const count = communityCounts.get(card.dataset.communityId) || 0;
                badge.hidden = count === 0;
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.setAttribute('aria-label', `${count} mensagens por ler`);
            });
            document.querySelectorAll('.project-card[data-project-id]').forEach((card) => {
                const badge = card.querySelector('.project-notification-count');
                if (!badge) return;
                const count = projectCounts.get(card.dataset.projectId) || 0;
                badge.hidden = count === 0;
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.setAttribute('aria-label', `${count} notificações por ler neste projecto`);
                badge.title = `${count} notificações por ler`;
            });
            document.querySelectorAll('.project-card[data-project-id]').forEach((card) => {
                const badge = card.querySelector('.project-chat-unread-count');
                if (!badge) return;
                const count = projectMessageCounts.get(card.dataset.projectId) || 0;
                badge.hidden = count === 0;
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.setAttribute('aria-label', `${count} mensagens por ler`);
            });
        } catch { /* Keep the last known counts when a brief refresh fails. */ }
    })();
    try { await entityActivityRefreshPromise; }
    finally { entityActivityRefreshPromise = null; }
}

notificationsToggle?.addEventListener('click', () => {
    const opening = notificationPanel?.hidden ?? true;
    if (!notificationPanel) return;
    notificationPanel.hidden = !opening;
    notificationsToggle.setAttribute('aria-expanded', String(opening));
    if (opening) void loadNotifications();
});

notificationsMarkAll?.addEventListener('click', async () => {
    notificationsMarkAll.disabled = true;
    try {
        await window.ImpactaAPI.post('/notifications/read-all', {});
        await loadNotifications();
    } catch (error) {
        if (notificationStatus) notificationStatus.textContent = friendlyError(error, 'Não foi possível atualizar as notificações.');
    } finally {
        notificationsMarkAll.disabled = false;
    }
});

document.addEventListener('click', (event) => {
    if (!notificationPanel || notificationPanel.hidden) return;
    if (notificationPanel.contains(event.target) || notificationsToggle?.contains(event.target)) return;
    notificationPanel.hidden = true;
    notificationsToggle?.setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !notificationPanel || notificationPanel.hidden) return;
    notificationPanel.hidden = true;
    notificationsToggle?.setAttribute('aria-expanded', 'false');
    notificationsToggle?.focus();
});

function createCommentRow(comment) {
    const row = element('article', 'inline-comment');
    const author = element('strong', 'inline-comment-author', comment.author || 'Membro');
    const body = element('span', 'inline-comment-body');
    renderMentionContent(body, comment.body, comment.mentions);
    const time = element('small', 'inline-comment-time', [
        formatDate(comment.created_at), comment.edited ? 'Editado' : ''
    ].filter(Boolean).join(' · '));
    row.append(author, body, time);

    if (!comment.is_author && currentUser) {
        const reportButton = element('button', 'button-quiet inline-comment-report-button', 'Denunciar');
        reportButton.type = 'button';
        const reportForm = element('form', 'inline-comment-report-form');
        reportForm.hidden = true;
        const reason = element('select', 'report-reason');
        reason.setAttribute('aria-label', 'Motivo da denúncia');
        reason.required = true;
        [['', 'Seleciona um motivo'], ['harassment', 'Assédio ou discurso de ódio'],
            ['harmful', 'Conteúdo prejudicial'], ['sexual_content', 'Conteúdo sexual explícito ou exploração'],
            ['spam', 'Spam'], ['misinformation', 'Informação falsa'],
            ['other', 'Outro motivo']].forEach(([value, label]) => {
            const option = element('option', '', label);
            option.value = value;
            reason.append(option);
        });
        const details = element('textarea', 'report-details');
        details.maxLength = 500;
        details.rows = 2;
        details.placeholder = 'Detalhes opcionais';
        const feedback = element('small', 'inline-comment-edit-feedback');
        feedback.setAttribute('role', 'status');
        const submit = element('button', 'button button-small', 'Enviar denúncia');
        submit.type = 'submit';
        const cancel = element('button', 'button-quiet', 'Cancelar');
        cancel.type = 'button';
        cancel.addEventListener('click', () => { reportForm.hidden = true; });
        reportButton.addEventListener('click', () => { reportForm.hidden = !reportForm.hidden; });
        reportForm.append(reason, details, submit, cancel, feedback);
        reportForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
                await window.ImpactaAPI.post(`/feed/comments/${encodeURIComponent(comment.id)}/reports`, {
                    reasonCode: reason.value, details: details.value
                });
                feedback.textContent = '';
                reportButton.disabled = true;
                reportForm.hidden = true;
                showFeedNotice('Denúncia recebida', 'A equipa IMPACTA vai analisar o comentário.', { durationMs: 2100 });
            } catch (error) {
                feedback.textContent = '';
                showFeedNotice('Não foi possível denunciar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
            } finally {
                submit.disabled = false;
            }
        });
        const reportControls = element('div', 'inline-comment-controls');
        reportControls.append(reportButton);
        row.append(reportControls, reportForm);
    }

    if (comment.is_author && currentUser) {
        const controls = element('div', 'inline-comment-controls');
        const editButton = element('button', 'button-quiet inline-comment-edit-button', 'Editar');
        editButton.type = 'button';
        const form = element('form', 'inline-comment-edit-form');
        form.hidden = true;
        const input = element('textarea', 'inline-comment-edit-input');
        input.maxLength = 1000;
        input.rows = 2;
        input.required = true;
        input.setAttribute('aria-label', 'Editar comentário');
        const feedback = element('small', 'inline-comment-edit-feedback');
        feedback.setAttribute('role', 'status');
        const buttons = element('div', 'inline-form-actions');
        const save = element('button', 'button button-small', 'Guardar edição');
        save.type = 'submit';
        const cancel = element('button', 'button-quiet', 'Cancelar');
        cancel.type = 'button';
        buttons.append(save, cancel);
        form.append(input, feedback, buttons);
        const getMentionIds = attachMentionPicker(input, comment.mentions);
        controls.append(editButton);
        row.append(controls, form);

        const closeEditor = () => {
            form.hidden = true;
            controls.hidden = false;
            body.hidden = false;
            time.hidden = false;
            feedback.textContent = '';
        };
        editButton.addEventListener('click', () => {
            input.value = comment.body || '';
            form.hidden = false;
            controls.hidden = true;
            body.hidden = true;
            time.hidden = true;
            input.focus();
        });
        cancel.addEventListener('click', closeEditor);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const nextBody = input.value.trim();
            if (!nextBody) {
                input.focus();
                return;
            }
            save.disabled = true;
            try {
                const updated = await window.ImpactaAPI.put(
                    `/feed/comments/${encodeURIComponent(comment.id)}`,
                    { body: nextBody, mentionUserIds: getMentionIds(nextBody) }
                );
                comment.body = updated.body;
                comment.edited = Boolean(updated.edited);
                comment.mentions = updated.mentions || [];
                renderMentionContent(body, comment.body, comment.mentions);
                time.textContent = [formatDate(comment.created_at), comment.edited ? 'Editado' : '']
                    .filter(Boolean).join(' · ');
                closeEditor();
                showFeedNotice('Comentário editado', 'As alterações foram guardadas.', { durationMs: 1800 });
            } catch (error) {
                feedback.textContent = '';
                showFeedNotice('Não foi possível guardar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
            } finally {
                save.disabled = false;
            }
        });
    }
    return row;
}

function addCommentRow(list, comment) {
    list.append(createCommentRow(comment));
}

async function loadComments(post, commentsList, status) {
    status.textContent = 'A carregar comentários…';
    try {
        const comments = await window.ImpactaAPI.get(`/feed/posts/${post.id}/comments`);
        commentsList.replaceChildren();
        if (comments.length === 0) {
            status.textContent = 'Ainda não há comentários. Sê a primeira pessoa a participar.';
        } else {
            comments.forEach((comment) => addCommentRow(commentsList, comment));
            status.textContent = '';
        }
        return true;
    } catch (error) {
        status.textContent = friendlyError(error, 'Não foi possível carregar os comentários.');
        return false;
    }
}

function createReportForm(post) {
    const form = element('form', 'report-form');
    form.hidden = true;
    const reason = element('select', 'report-reason');
    reason.setAttribute('aria-label', 'Motivo da denúncia');
    reason.required = true;
    [
        ['', 'Seleciona um motivo'],
        ['spam', 'Spam ou conteúdo enganador'],
        ['harassment', 'Assédio ou discurso de ódio'],
        ['harmful', 'Conteúdo prejudicial'],
        ['sexual_content', 'Conteúdo sexual explícito ou exploração'],
        ['misinformation', 'Informação falsa'],
        ['other', 'Outro motivo']
    ].forEach(([value, label]) => {
        const option = element('option', '', label);
        option.value = value;
        reason.append(option);
    });
    const details = element('textarea', 'report-details');
    details.maxLength = 500;
    details.rows = 2;
    details.placeholder = 'Detalhes opcionais';
    const status = element('p', 'form-status');
    status.setAttribute('role', 'status');
    const actions = element('div', 'inline-form-actions');
    const cancel = element('button', 'button button-quiet', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { form.hidden = true; });
    const submit = element('button', 'button button-small', 'Enviar denúncia');
    submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(reason, details, actions, status);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
            const result = await window.ImpactaAPI.post(`/feed/posts/${post.id}/reports`, {
                reasonCode: reason.value,
                details: details.value
            });
            const message = result?.urgent
                ? 'Denúncia registada. A publicação foi encaminhada para revisão urgente da administração após denúncias de ' + result.reporterCount + ' perfis diferentes.'
                : 'Denúncia registada e enviada à equipa de moderação.';
            form.reset();
            status.textContent = '';
            form.hidden = true;
            showFeedNotice(result?.urgent ? 'Denúncia encaminhada' : 'Denúncia recebida', message, { durationMs: 2500 });
        } catch (error) {
            status.textContent = '';
            showFeedNotice('Não foi possível denunciar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
        } finally {
            submit.disabled = false;
        }
    });
    return form;
}

function renderFeedImpactationButton(button, status) {
    const labels = {
        none: 'Impactar',
        outgoing_pending: 'Pedido enviado',
        incoming_pending: 'Aceitar pedido',
        connected: 'Já impactados'
    };
    const currentStatus = labels[status?.status] ? status.status : 'none';
    button.dataset.status = currentStatus;
    button.textContent = labels[currentStatus];
    button.disabled = currentStatus === 'outgoing_pending' || currentStatus === 'connected';
    button.setAttribute('aria-label', currentStatus === 'none'
        ? `Impactar ${button.dataset.authorName || 'este perfil'}`
        : labels[currentStatus]);
}

function setFeedImpactationState(userId, status) {
    const key = String(userId);
    feedImpactationStatusByUser.set(key, status);
    document.querySelectorAll('.post-impactation-button').forEach((button) => {
        if (button.dataset.userId === key) renderFeedImpactationButton(button, status);
    });
}

function loadFeedImpactationStatus(userId, refresh = false) {
    const key = String(userId);
    if (!refresh && feedImpactationStatusByUser.has(key)) {
        return Promise.resolve(feedImpactationStatusByUser.get(key));
    }
    if (feedImpactationStatusRequests.has(key)) return feedImpactationStatusRequests.get(key);

    const request = window.ImpactaAPI.request(`/impactations/status/${encodeURIComponent(key)}`)
        .then((status) => {
            setFeedImpactationState(key, status);
            return status;
        })
        .finally(() => feedImpactationStatusRequests.delete(key));
    feedImpactationStatusRequests.set(key, request);
    return request;
}

function createFeedImpactationButton(postData, postFeedback) {
    const userId = String(postData.author_id || '');
    if (!userId || postData.author_profile_public !== true
        || (currentUser && userId === String(currentUser.id))) return null;

    const button = element('button', 'post-impactation-button', 'Impactar');
    button.type = 'button';
    button.dataset.userId = userId;
    button.dataset.authorName = postData.author || 'este perfil';
    button.setAttribute('aria-label', `Impactar ${postData.author || 'este perfil'}`);

    if (!currentUser) {
        button.title = 'Entra para enviar um pedido de impactação';
        button.addEventListener('click', () => window.location.assign('index.html#login'));
        return button;
    }

    const cachedStatus = feedImpactationStatusByUser.get(userId);
    if (cachedStatus) {
        renderFeedImpactationButton(button, cachedStatus);
    } else {
        button.disabled = true;
        button.textContent = 'A verificar…';
        void loadFeedImpactationStatus(userId).catch(() => renderFeedImpactationButton(button, { status: 'none' }));
    }

    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const status = await loadFeedImpactationStatus(userId, true);
            if (status.status === 'none') {
                const result = await window.ImpactaAPI.post(`/impactations/${encodeURIComponent(userId)}`, {});
                setFeedImpactationState(userId, result);
                postFeedback.textContent = 'Pedido de impactação enviado.';
                return;
            }
            if (status.status === 'incoming_pending' && status.requestId) {
                await window.ImpactaAPI.post(`/impactations/requests/${encodeURIComponent(status.requestId)}/respond`, { decision: 'accept' });
                setFeedImpactationState(userId, { status: 'connected' });
                postFeedback.textContent = 'Pedido aceite. Já estão impactados.';
                return;
            }
            setFeedImpactationState(userId, status);
        } catch (error) {
            postFeedback.textContent = friendlyError(error, 'Não foi possível enviar o pedido de impactação.');
        } finally {
            const status = feedImpactationStatusByUser.get(userId) || { status: 'none' };
            renderFeedImpactationButton(button, status);
        }
    });
    return button;
}

function createPost(postData) {
    const post = element('article', 'post-card panel');
    post.dataset.post = '';
    post.dataset.postId = String(postData.id);
    post.dataset.category = postData.category_code || 'community';
    post.dataset.supports = String(Number(postData.support_count) || 0);
    post.dataset.order = String(new Date(postData.created_at).getTime() || 0);
    post.id = `publicacao-${postData.id}`;

    const heading = element('div', 'post-heading');
    const publicProfile = Boolean(postData.author_id && postData.author_profile_public);
    const authorAvatar = element('span', 'avatar avatar-user', initials(postData.author) || 'I');
    const authorId = String(postData.author_id || '');
    const isCurrentUserAuthor = Boolean(currentUser?.id && authorId === String(currentUser.id));
    const avatarUrl = postData.avatar_id
        ? `/api/v1/media/${encodeURIComponent(postData.avatar_id)}`
        : (isCurrentUserAuthor ? currentUser.avatarUrl : null);
    avatarImage(authorAvatar, avatarUrl, postData.author, isCurrentUserAuthor ? authorId : '');
    if (publicProfile) {
        const avatarLink = element('a', 'post-profile-avatar');
        avatarLink.href = `profile.html?id=${encodeURIComponent(postData.author_id)}`;
        avatarLink.setAttribute('aria-label', `Ver perfil público de ${postData.author}`);
        avatarLink.append(authorAvatar);
        heading.append(avatarLink);
    } else {
        heading.append(authorAvatar);
    }
    const author = element('div', 'post-author');
    const authorName = element('strong', '', postData.author || 'Membro');
    const authorNameLine = element('div', 'post-author-name');
    authorNameLine.append(authorName);
    if (postData.author_is_platform_admin === true) {
        const badge = element('span', 'official-account-badge', '\u2713');
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', 'Conta oficial do IMPACTA');
        badge.title = 'Conta oficial do IMPACTA';
        authorNameLine.append(badge);
    }
    if (postData.author_is_identity_verified === true) {
        const badge = element('span', 'identity-verified-badge', '\u2713');
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', 'Canal oficial confirmado pelo IMPACTA');
        badge.title = 'Canal oficial confirmado pelo IMPACTA';
        authorNameLine.append(badge);
    }
    if (publicProfile) {
        const profileLink = element('a', 'post-author-link');
        profileLink.href = `profile.html?id=${encodeURIComponent(postData.author_id)}`;
        profileLink.append(authorNameLine);
        author.append(profileLink);
    } else {
        author.append(authorNameLine);
    }
    const detail = [postData.author_headline, postData.community, postData.project ? `Actualização de ${postData.project}` : '', formatDate(postData.created_at)].filter(Boolean).join(' · ');
    author.append(element('span', '', detail));
    const postEditedLabel = element('span', 'edited-indicator', postData.edited ? 'Editado' : '');
    author.append(postEditedLabel);
    heading.append(author);

    const tag = element('span', 'post-tag tag-green', postData.custom_category || postData.category || 'Publicação da comunidade');
    const copy = element('p', 'post-copy');
    copy.id = `post-copy-${postData.id}`;
    const readMore = element('button', 'post-read-toggle', 'Ver mais');
    readMore.type = 'button';
    readMore.setAttribute('aria-controls', copy.id);
    const setPostCopy = (body, collapseLongText = true) => {
        const text = String(body || '');
        const isLong = Array.from(text).length > POST_PREVIEW_CHARACTER_LIMIT;
        const isCollapsed = isLong && collapseLongText;
        renderMentionContent(copy, text, postData.mentions);
        copy.classList.toggle('is-collapsed', isCollapsed);
        readMore.hidden = !isLong;
        readMore.textContent = isCollapsed ? 'Ver mais' : 'Ver menos';
        readMore.setAttribute('aria-expanded', String(isLong && !isCollapsed));
    };
    setPostCopy(postData.body);
    readMore.addEventListener('click', () => {
        const isCollapsed = copy.classList.toggle('is-collapsed');
        readMore.textContent = isCollapsed ? 'Ver mais' : 'Ver menos';
        readMore.setAttribute('aria-expanded', String(!isCollapsed));
    });
    const editForm = element('form', 'post-edit-form');
    editForm.hidden = true;
    const editBody = element('textarea', 'post-edit-input');
    editBody.maxLength = 2000;
    editBody.rows = 4;
    editBody.required = true;
    editBody.setAttribute('aria-label', 'Editar texto da publicação');
    const editCategory = element('select', 'post-edit-category');
    editCategory.required = true;
    editCategory.setAttribute('aria-label', 'Categoria da publicação');
    const editCustomCategory = element('input', 'post-edit-custom-category');
    editCustomCategory.type = 'text';
    editCustomCategory.maxLength = 60;
    editCustomCategory.placeholder = 'Tema próprio (opcional, até 60 caracteres)';
    editCustomCategory.setAttribute('aria-label', 'Tema próprio da publicação');
    editCustomCategory.hidden = true;
    const editButtons = element('div', 'inline-form-actions');
    const saveEdit = element('button', 'button button-small', 'Guardar edição');
    saveEdit.type = 'submit';
    const cancelEdit = element('button', 'button-quiet', 'Cancelar');
    cancelEdit.type = 'button';
    editButtons.append(saveEdit, cancelEdit);
    editForm.append(editBody, editCategory, editCustomCategory, editButtons);
    const getEditMentionIds = attachMentionPicker(editBody, postData.mentions);
    const gallery = element('div', 'post-media-gallery');
    const mediaItems = Array.isArray(postData.media) ? postData.media : [];
    const isMediaCarousel = mediaItems.length > 1;
    if (mediaItems.length > 0 && !isMediaCarousel) gallery.classList.add('media-count-1');
    const galleryMedia = mediaItems.map((media) => ({
        type: media.media_type,
        url: window.ImpactaAPI.assetUrl(media.url)
    }));
    const carouselSlides = [];
    const galleryTrack = isMediaCarousel ? element('div', 'post-media-track') : gallery;
    if (isMediaCarousel) {
        gallery.classList.add('is-carousel');
        gallery.setAttribute('role', 'group');
        gallery.setAttribute('aria-label', `Carrossel com ${mediaItems.length} itens da publicação`);
        galleryTrack.setAttribute('aria-label', 'Desliza horizontalmente para ver os anexos');
        gallery.append(galleryTrack);
    }
    mediaItems.forEach((media, index) => {
        const url = window.ImpactaAPI.assetUrl(media.url);
        const tile = element('button', 'post-media-tile');
        tile.type = 'button';
        tile.setAttribute('aria-label', media.media_type === 'video'
            ? `Abrir vídeo ${index + 1} da publicação`
            : `Abrir fotografia ${index + 1} da publicação`);
        tile.addEventListener('click', () => openPostMedia(galleryMedia, index));
        if (media.media_type === 'video') {
            const video = element('video', 'post-media-video');
            video.controls = false;
            video.muted = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.crossOrigin = 'use-credentials';
            video.src = url;
            video.setAttribute('aria-hidden', 'true');
            const playMark = element('span', 'post-video-mark', '▶');
            playMark.setAttribute('aria-hidden', 'true');
            tile.append(video, playMark);
        } else if (media.media_type === 'image') {
            const image = element('img', 'post-media-image');
            image.crossOrigin = 'use-credentials';
            image.src = url;
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            tile.append(image);
        }
        galleryTrack.append(tile);
        if (isMediaCarousel) carouselSlides.push(tile);
    });
    if (isMediaCarousel) {
        const mediaLabel = mediaItems.every((media) => media.media_type === 'image') ? 'imagens' : 'itens';
        const carouselHint = element('span', 'post-carousel-hint', `Desliza para ver mais · ${mediaItems.length} ${mediaLabel}`);
        carouselHint.setAttribute('aria-hidden', 'true');
        const carouselCounter = element('span', 'post-carousel-counter', `1 / ${mediaItems.length}`);
        carouselCounter.setAttribute('aria-live', 'polite');
        carouselCounter.setAttribute('aria-atomic', 'true');
        const carouselControls = element('div', 'post-carousel-controls');
        carouselControls.setAttribute('role', 'group');
        carouselControls.setAttribute('aria-label', 'Navegação do carrossel');
        const previousSlide = element('button', 'post-carousel-control post-carousel-previous');
        previousSlide.type = 'button';
        previousSlide.setAttribute('aria-label', 'Ver anexo anterior');
        previousSlide.append(icon('previous'));
        const nextSlide = element('button', 'post-carousel-control post-carousel-next');
        nextSlide.type = 'button';
        nextSlide.setAttribute('aria-label', 'Ver próximo anexo');
        nextSlide.append(icon('next'));
        previousSlide.disabled = true;
        let activeCarouselIndex = 0;
        const updateCarouselControls = () => {
            let closestDistance = Number.POSITIVE_INFINITY;
            const maxScrollLeft = Math.max(0, galleryTrack.scrollWidth - galleryTrack.clientWidth);
            carouselSlides.forEach((slide, index) => {
                const targetScrollLeft = Math.min(slide.offsetLeft, maxScrollLeft);
                const distance = Math.abs(targetScrollLeft - galleryTrack.scrollLeft);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    activeCarouselIndex = index;
                }
            });
            carouselCounter.textContent = `${activeCarouselIndex + 1} / ${carouselSlides.length}`;
            previousSlide.disabled = activeCarouselIndex === 0;
            nextSlide.disabled = activeCarouselIndex === carouselSlides.length - 1;
        };
        const moveCarousel = (direction) => {
            updateCarouselControls();
            const targetIndex = Math.max(0, Math.min(carouselSlides.length - 1, activeCarouselIndex + direction));
            const maxScrollLeft = Math.max(0, galleryTrack.scrollWidth - galleryTrack.clientWidth);
            const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
            galleryTrack.scrollTo({ left: Math.min(carouselSlides[targetIndex].offsetLeft, maxScrollLeft), behavior });
        };
        previousSlide.addEventListener('click', () => moveCarousel(-1));
        nextSlide.addEventListener('click', () => moveCarousel(1));
        let carouselScrollFrame = 0;
        galleryTrack.addEventListener('scroll', () => {
            if (carouselScrollFrame) return;
            carouselScrollFrame = requestAnimationFrame(() => {
                carouselScrollFrame = 0;
                updateCarouselControls();
            });
        }, { passive: true });
        carouselControls.append(previousSlide, carouselCounter, nextSlide);
        gallery.append(carouselHint, carouselControls);
    }
    gallery.hidden = gallery.childElementCount === 0;
    const commentsArea = element('section', 'post-comments');
    commentsArea.hidden = true;
    commentsArea.setAttribute('aria-label', 'Comentários da publicação');
    const commentsList = element('div', 'comments-list');
    const commentStatus = element('p', 'form-status comment-status');
    commentStatus.setAttribute('role', 'status');
    commentsArea.append(commentsList, commentStatus);
    const postFeedback = element('p', 'form-status post-feedback');
    postFeedback.setAttribute('role', 'status');
    if (postData.moderation_status === 'pending_review') {
        const pendingNotice = element('p', 'form-status post-pending-review', 'Esta publicação foi sinalizada pelas regras de segurança e aguarda revisão da equipa IMPACTA. Enquanto isso, só tu e a equipa de revisão conseguem vê-la.');
        pendingNotice.setAttribute('role', 'status');
        post.append(pendingNotice);
    }
    const impactationButton = createFeedImpactationButton(postData, postFeedback);
    if (impactationButton) heading.append(impactationButton);

    const editPostButton = postData.is_author
        ? iconButton('edit-post-button', 'edit', 'Editar publicação')
        : null;
    editPostButton?.addEventListener('click', () => {
        const options = postCategories.map((category) => {
            const option = element('option', '', category.name);
            option.value = category.code;
            return option;
        });
        if (!postCategories.some((category) => category.code === postData.category_code)) {
            const currentCategory = element('option', '', postData.category || 'Categoria atual');
            currentCategory.value = postData.category_code || 'community';
            options.push(currentCategory);
        }
        editCategory.replaceChildren(...options);
        editCategory.value = postData.category_code || 'community';
        editCustomCategory.value = postData.custom_category || '';
        editCustomCategory.hidden = editCategory.value !== 'other';
        editBody.value = postData.body || '';
        copy.hidden = true;
        readMore.hidden = true;
        tag.hidden = true;
        editForm.hidden = false;
        editBody.focus();
    });
    editCategory.addEventListener('change', () => {
        editCustomCategory.hidden = editCategory.value !== 'other';
        if (editCategory.value !== 'other') editCustomCategory.value = '';
    });
    cancelEdit.addEventListener('click', () => {
        editForm.hidden = true;
        copy.hidden = false;
        readMore.hidden = Array.from(postData.body || '').length <= POST_PREVIEW_CHARACTER_LIMIT;
        tag.hidden = false;
        postFeedback.textContent = '';
    });
    editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = editBody.value.trim();
        if (!body) {
            editBody.focus();
            return;
        }
        saveEdit.disabled = true;
        try {
            const updated = await window.ImpactaAPI.put(`/feed/posts/${encodeURIComponent(postData.id)}`, {
                body,
                categoryCode: editCategory.value,
                customCategory: editCategory.value === 'other' ? editCustomCategory.value.trim() : '',
                mentionUserIds: getEditMentionIds(body)
            });
            postData.body = updated.body;
            postData.category_code = updated.category_code;
            postData.category = updated.category;
            postData.custom_category = updated.custom_category;
            postData.mentions = updated.mentions || [];
            postData.edited = Boolean(updated.edited);
            post.dataset.category = updated.category_code;
            setPostCopy(updated.body);
            tag.textContent = updated.custom_category || updated.category;
            postEditedLabel.textContent = postData.edited ? 'Editado' : '';
            editForm.hidden = true;
            copy.hidden = false;
            readMore.hidden = Array.from(updated.body || '').length <= POST_PREVIEW_CHARACTER_LIMIT;
            tag.hidden = false;
            postFeedback.textContent = '';
            showFeedNotice('Edição guardada', 'A publicação foi actualizada.', { durationMs: 1800 });
            applyFilterAndSort();
        } catch (error) {
            postFeedback.textContent = '';
            showFeedNotice('Não foi possível guardar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
        } finally {
            saveEdit.disabled = false;
        }
    });

    if (currentUser) {
        const commentForm = element('form', 'comment-entry');
        const input = element('textarea', 'comment-input');
        input.maxLength = 1000;
        input.rows = 1;
        input.placeholder = 'Escreve um comentário…';
        input.setAttribute('aria-label', 'Escreve um comentário');
        const send = element('button', '', 'Enviar comentário');
        send.type = 'submit';
        commentForm.append(input, send);
        const getMentionIds = attachMentionPicker(input);
        commentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!input.value.trim()) {
                input.focus();
                return;
            }
            send.disabled = true;
            try {
                const comment = await window.ImpactaAPI.post(`/feed/posts/${postData.id}/comments`, {
                    body: input.value, mentionUserIds: getMentionIds(input.value)
                });
                addCommentRow(commentsList, comment);
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                commentStatus.textContent = '';
                const count = Number(postData.comment_count) + 1;
                postData.comment_count = count;
                updateIconButton(commentButton, `Comentários: ${count}`, count);
                void loadNotifications();
                showFeedNotice('Comentário publicado', 'O teu comentário já está na conversa.', { durationMs: 1700 });
            } catch (error) {
                commentStatus.textContent = '';
                showFeedNotice('Não foi possível comentar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
            } finally {
                send.disabled = false;
            }
        });
        commentsArea.append(commentForm);
    } else {
        const loginPrompt = element('a', 'comment-login', 'Entra para comentar');
        loginPrompt.href = 'index.html#login';
        commentsArea.append(loginPrompt);
    }

    const actions = element('div', 'post-actions');
    const support = iconButton('support-button', 'support', 'Apoiar publicação', Number(postData.support_count) || 0);
    support.setAttribute('aria-pressed', String(Boolean(postData.supported_by_viewer)));
    support.addEventListener('click', async () => {
        if (!currentUser) {
            window.location.assign('index.html#login');
            return;
        }
        support.disabled = true;
        try {
            const result = await window.ImpactaAPI.post(`/feed/posts/${postData.id}/support`, {});
            postData.supported_by_viewer = result.supported;
            postData.support_count = result.supportCount;
            post.dataset.supports = String(result.supportCount);
            updateIconButton(support, result.supported ? 'Retirar apoio' : 'Apoiar publicação', result.supportCount);
            support.setAttribute('aria-pressed', String(result.supported));
            if (result.supported) void loadNotifications();
        } catch (error) {
            postFeedback.textContent = friendlyError(error, 'Não foi possível atualizar o apoio.');
        } finally {
            support.disabled = false;
        }
    });

    const initialComments = Number(postData.comment_count) || 0;
    const commentButton = iconButton('comment-button', 'comment', `Comentários: ${initialComments}`, initialComments);
    commentButton.setAttribute('aria-expanded', 'false');
    let commentsLoaded = false;
    commentButton.addEventListener('click', async () => {
        const willOpen = commentsArea.hidden;
        commentsArea.hidden = !willOpen;
        commentButton.setAttribute('aria-expanded', String(willOpen));
        if (willOpen && !commentsLoaded) {
            commentsLoaded = await loadComments(postData, commentsList, commentStatus);
        }
    });

    const share = iconButton('share-button', 'share', 'Partilhar publicação');
    share.addEventListener('click', async () => {
        if (!currentUser) {
            window.location.assign('index.html#login');
            return;
        }
        const url = `${window.location.origin}${window.location.pathname}#publicacao-${postData.id}`;
        share.disabled = true;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'IMPACTA · publicação da comunidade', text: postData.body, url });
            } else {
                let copied = false;
                try {
                    if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
                    await navigator.clipboard.writeText(url);
                    copied = true;
                } catch {
                    copied = await window.ImpactaModal.copy({
                        title: 'Partilhar publicação',
                        message: 'Copia esta ligação para a enviares a outras pessoas.',
                        text: url
                    });
                }
                if (!copied) return;
                updateIconButton(share, 'Ligação copiada');
                window.setTimeout(() => { updateIconButton(share, 'Partilhar publicação'); }, 1800);
            }
            const result = await window.ImpactaAPI.post(`/feed/posts/${postData.id}/share`, {});
            updateIconButton(share, result.shared ? 'Partilha registada' : 'Já partilhaste esta publicação');
            showFeedNotice('Partilha concluída', result.shared ? 'A publicação foi partilhada.' : 'Já tinhas partilhado esta publicação.', { durationMs: 1800 });
            void loadNotifications();
        } catch (error) {
            if (error?.name === 'AbortError') return;
            updateIconButton(share, friendlyError(error, 'Não foi possível partilhar'));
            showFeedNotice('Não foi possível partilhar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
        } finally {
            share.disabled = false;
            window.setTimeout(() => { updateIconButton(share, 'Partilhar publicação'); }, 1800);
        }
    });

    actions.append(support, commentButton, share);
    if (postData.is_author) {
        actions.append(editPostButton);
        const remove = iconButton('delete-post-button', 'trash', 'Apagar publicação');
        remove.addEventListener('click', async () => {
            remove.disabled = true;
            const confirmed = await window.ImpactaModal.confirm({
                title: 'Apagar publicação?',
                message: 'A publicação será removida do feed. Esta ação não pode ser anulada.',
                confirmLabel: 'Apagar publicação',
                danger: true
            });
            if (!confirmed) { remove.disabled = false; return; }
            try {
                await window.ImpactaAPI.delete(`/feed/posts/${postData.id}`);
                feedPosts = feedPosts.filter((item) => String(item.id) !== String(postData.id));
                applyFilterAndSort();
                showFeedNotice('Publicação eliminada', 'A publicação foi removida do feed.', { durationMs: 1700 });
            } catch (error) {
                postFeedback.textContent = '';
                showFeedNotice('Não foi possível apagar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
                remove.disabled = false;
            }
        });
        actions.append(remove);
    }

    const report = iconButton('report-button', 'report', 'Denunciar publicação');
    const reportForm = createReportForm(postData);
    const isPendingReview = postData.moderation_status === 'pending_review';
    if (isPendingReview) {
        support.hidden = true;
        commentButton.hidden = true;
        share.hidden = true;
        report.hidden = true;
        reportForm.hidden = true;
    }
    report.addEventListener('click', () => {
        if (!currentUser) {
            window.location.assign('index.html#login');
            return;
        }
        reportForm.hidden = !reportForm.hidden;
    });

    post.append(heading, tag, copy, readMore, editForm, gallery, postFeedback, commentsArea, actions);
    if (!postData.is_author && !isPendingReview) {
        const reportRow = element('div', 'post-utility-actions');
        reportRow.append(report);
        post.append(reportForm, reportRow);
    }
    return post;
}

function buildPostsEndpoint(categoryCode, offset = 0) {
    const parameters = new URLSearchParams();
    if (categoryCode) parameters.set('category', categoryCode);
    if (offset > 0) parameters.set('offset', String(offset));
    const query = parameters.toString();
    return query ? `/feed/posts?${query}` : '/feed/posts';
}

async function loadPosts(categoryCode = categoryFilter?.value || '') {
    const generation = ++postLoadGeneration;
    const hasRenderedPosts = Boolean(postList.querySelector('[data-post]'));
    const previousCategory = currentPostCategory;
    const moreWasVisible = Boolean(postsMoreButton && !postsMoreButton.hidden);
    currentPostCategory = categoryCode;
    if (!hasRenderedPosts && initialPostSkeleton) {
        postList.replaceChildren(initialPostSkeleton.cloneNode(true));
    } else if (hasRenderedPosts) {
        postList.classList.add('is-refreshing');
    }
    postList.setAttribute('aria-busy', 'true');
    if (postsMoreButton) postsMoreButton.hidden = true;
    if (postsMoreStatus) postsMoreStatus.hidden = true;
    feedStatus.hidden = true;
    feedStatus.classList.add('visually-hidden');

    try {
        const result = await window.ImpactaAPI.request(buildPostsEndpoint(categoryCode));
        if (generation !== postLoadGeneration) return;
        const posts = Array.isArray(result.items) ? result.items : [];
        feedPosts = posts;
        feedPostsOffset = posts.length;
        hasMoreFeedPosts = result.hasMore === true;
        visiblePostCount = POST_BATCH_SIZE;
        postList.removeAttribute('aria-busy');
        postList.classList.remove('is-refreshing');
        feedStatus.hidden = true;
        emptyState.textContent = 'Ainda n\u00e3o h\u00e1 publica\u00e7\u00f5es da comunidade. Partilha a primeira ideia no feed do IMPACTA.';
        applyFilterAndSort({ resetVisible: true });
    } catch (error) {
        if (generation !== postLoadGeneration) return;
        postList.removeAttribute('aria-busy');
        postList.classList.remove('is-refreshing');
        if (postsMoreButton) postsMoreButton.hidden = true;
        if (hasRenderedPosts) {
            currentPostCategory = previousCategory;
            if (categoryFilter) categoryFilter.value = previousCategory;
            if (postsMoreButton) postsMoreButton.hidden = !moreWasVisible;
        }
        feedStatus.replaceChildren();
        feedStatus.hidden = false;
        feedStatus.classList.remove('visually-hidden');
        feedStatus.append(element('span', '', friendlyError(error, 'N\u00e3o foi poss\u00edvel carregar as publica\u00e7\u00f5es.')));
        const retry = element('button', 'button button-small retry-button', 'Tentar novamente');
        retry.type = 'button';
        retry.addEventListener('click', () => { void loadPosts(hasRenderedPosts ? previousCategory : categoryCode); });
        feedStatus.append(retry);
        emptyState.hidden = true;
        if (!hasRenderedPosts) postList.replaceChildren();
    }
}
async function loadMorePosts() {
    if (loadingMorePosts || !postsMoreButton) return;
    if (postsMoreStatus) postsMoreStatus.hidden = true;
    if (getMatchingFeedPosts().length > visiblePostCount) {
        visiblePostCount += POST_BATCH_SIZE;
        applyFilterAndSort({ appendOnly: sortField?.value !== 'supported' });
        return;
    }
    if (!hasMoreFeedPosts) return;

    loadingMorePosts = true;
    const generation = postLoadGeneration;
    postsMoreButton.disabled = true;
    postsMoreButton.textContent = 'A carregar…';
    if (postsMoreStatus) postsMoreStatus.hidden = true;
    try {
        const result = await window.ImpactaAPI.request(buildPostsEndpoint(currentPostCategory, feedPostsOffset));
        if (generation !== postLoadGeneration) return;
        const nextPage = Array.isArray(result.items) ? result.items : [];
        const loadedIds = new Set(feedPosts.map((post) => String(post.id)));
        nextPage.forEach((post) => {
            if (!loadedIds.has(String(post.id))) feedPosts.push(post);
        });
        feedPostsOffset += nextPage.length;
        hasMoreFeedPosts = result.hasMore === true;
        visiblePostCount += POST_BATCH_SIZE;
        applyFilterAndSort({ appendOnly: true });
    } catch (error) {
        if (postsMoreStatus) {
            postsMoreStatus.textContent = friendlyError(error, 'Não foi possível carregar mais publicações. Tenta novamente.');
            postsMoreStatus.hidden = false;
        }
        postsMoreButton.textContent = 'Tentar novamente';
    } finally {
        loadingMorePosts = false;
        postsMoreButton.disabled = false;
        if (postsMoreButton.textContent === 'A carregar…') postsMoreButton.textContent = 'Carregar mais publicações da comunidade';
    }
}

async function submitPost(event) {
    event.preventDefault();
    if (!currentUser) {
        window.location.assign('index.html#login');
        return;
    }
    const body = composerInput.value.trim();
    if (!body) {
        composerInput.focus();
        return;
    }
    const categoryCode = postCategoryField?.value || '';
    if (!categoryCode) {
        composerStatus.textContent = 'Seleciona uma categoria para a publicação.';
        postCategoryField?.focus();
        return;
    }
    composerButton.disabled = true;
    if (chooseMediaButton) chooseMediaButton.disabled = true;
    const uploadedMedia = [];
    try {
        for (let index = 0; index < selectedMedia.length; index += 1) {
            composerStatus.textContent = `A otimizar e enviar anexo ${index + 1}/${selectedMedia.length}…`;
            uploadedMedia.push(await window.ImpactaAPI.upload('/feed/media', selectedMedia[index].file));
        }
        composerStatus.textContent = 'A publicar…';
        const post = await window.ImpactaAPI.post('/feed/posts', {
            body,
            categoryCode,
            customCategory: categoryCode === 'other' ? customCategoryField?.value.trim() || '' : '',
            projectId: postProjectField?.value || null,
            mediaIds: uploadedMedia.map((media) => media.id),
            mentionUserIds: getComposerMentionIds(body)
        });
        composerInput.value = '';
        composerInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (customCategoryField) customCategoryField.value = '';
        if (postProjectField) postProjectField.value = '';
        updateCustomCategoryVisibility();
        selectedMedia.forEach((entry) => entry.previewUrl && URL.revokeObjectURL(entry.previewUrl));
        selectedMedia = [];
        renderSelectedMedia();
        updateCharacterCount();
        composerStatus.textContent = '';
        const isPendingReview = post.moderation_status === 'pending_review';
        showFeedNotice(
            isPendingReview ? 'Publicação em revisão' : 'Publicação partilhada',
            isPendingReview
                ? 'A publicação foi sinalizada pelas regras de segurança e aguarda revisão da equipa IMPACTA.'
                : 'A tua publicação já aparece no feed IMPACTA.',
            { durationMs: isPendingReview ? 2800 : 2000 }
        );
        feedPosts.unshift(post);
        if (feedPosts.length > 50) feedPosts.pop();
        emptyState.hidden = true;
        applyFilterAndSort();
    } catch (error) {
        await Promise.allSettled(uploadedMedia.map((media) => window.ImpactaAPI.delete(`/feed/media/${encodeURIComponent(media.id)}`)));
        composerStatus.textContent = '';
        showFeedNotice('Não foi possível publicar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
    } finally {
        composerButton.disabled = !currentUser || !postCategoriesReady;
        if (chooseMediaButton) chooseMediaButton.disabled = !currentUser || !postCategoriesReady;
    }
}

function createChallengeEvidenceGallery(evidence = []) {
    const items = Array.isArray(evidence) ? evidence : [];
    const gallery = element('div', 'challenge-evidence-gallery');
    const proposal = items.filter((item) => item.stage === 'proposal');
    const delivery = items.filter((item) => item.stage === 'delivery');
    [[proposal, 'Evidências da proposta'], [delivery, 'Evidências da entrega']].forEach(([group, title]) => {
        if (!group.length) return;
        gallery.append(element('strong', 'challenge-evidence-title', title));
        const row = element('div', 'challenge-evidence-items');
        group.forEach((item) => {
            const url = window.ImpactaAPI.assetUrl(`/api/v1/challenge-evidence/${encodeURIComponent(item.id)}`);
            const link = element('a', 'challenge-evidence-item');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', item.media_type === 'video' ? 'Abrir vídeo de evidência' : 'Abrir imagem de evidência');
            if (item.media_type === 'video') {
                const video = element('video');
                video.src = url;
                video.controls = true;
                video.preload = 'metadata';
                video.playsInline = true;
                link.append(video);
            } else {
                const image = element('img');
                image.src = url;
                image.alt = 'Evidência privada do desafio';
                image.loading = 'lazy';
                link.append(image);
            }
            row.append(link);
        });
        gallery.append(row);
    });
    return gallery;
}

function appendChallengeEvidenceControl(card, challenge, stage) {
    if (!currentUser || !challenge.viewer_participation_id) return;
    const control = element('div', 'challenge-evidence-control');
    const label = element('label', 'challenge-evidence-label', stage === 'proposal' ? 'Anexar protótipo ou evidência da ideia' : 'Anexar evidência do resultado');
    const input = element('input', 'challenge-evidence-input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
    input.multiple = true;
    label.append(input);
    const note = element('small', '', 'Privado: só tu e a equipa responsável pelo projecto podem consultar. Até quatro imagens ou um vídeo por etapa; os ficheiros são otimizados.');
    const status = element('p', 'challenge-evidence-status');
    status.setAttribute('role', 'status');
    const upload = element('button', 'button button-small challenge-evidence-upload', 'Enviar evidências');
    upload.type = 'button';
    upload.disabled = true;
    let queuedFiles = [];
    input.addEventListener('change', () => {
        queuedFiles = [...(input.files || [])];
        const isVideo = (file) => ['video/mp4', 'video/quicktime'].includes(file.type);
        if (queuedFiles.length > 4 || (queuedFiles.some(isVideo) && queuedFiles.length !== 1)
            || queuedFiles.some((file) => !isVideo(file) && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
            queuedFiles = [];
            input.value = '';
            status.textContent = 'Escolhe até quatro imagens ou um único vídeo.';
            upload.disabled = true;
            return;
        }
        if (queuedFiles.some((file) => !file.size || file.size > (isVideo(file) ? 100 : 12) * 1024 * 1024)) {
            queuedFiles = [];
            input.value = '';
            status.textContent = 'Cada imagem pode ter até 12 MB e cada vídeo até 100 MB antes da otimização.';
            upload.disabled = true;
            return;
        }
        status.textContent = queuedFiles.length ? `${queuedFiles.length} ficheiro(s) pronto(s) para enviar.` : '';
        upload.disabled = queuedFiles.length === 0;
    });
    upload.addEventListener('click', async () => {
        upload.disabled = true;
        input.disabled = true;
        try {
            while (queuedFiles.length) {
                status.textContent = `A otimizar e enviar evidência ${Number(input.dataset.uploaded || 0) + 1}…`;
                const file = queuedFiles[0];
                const result = await window.ImpactaAPI.upload(
                    `/challenge-participations/${encodeURIComponent(challenge.viewer_participation_id)}/evidence`,
                    file,
                    { evidenceStage: stage }
                );
                challenge.viewer_evidence = [...(Array.isArray(challenge.viewer_evidence) ? challenge.viewer_evidence : []), {
                    id: result.id, stage, media_type: result.mediaType
                }];
                queuedFiles.shift();
                const oldGallery = card.querySelector('.challenge-evidence-gallery');
                const newGallery = createChallengeEvidenceGallery(challenge.viewer_evidence);
                if (oldGallery) oldGallery.replaceWith(newGallery);
                else control.before(newGallery);
                input.dataset.uploaded = String(Number(input.dataset.uploaded || 0) + 1);
            }
            status.textContent = 'Evidências enviadas em privado.';
            input.value = '';
            input.dataset.uploaded = '0';
        } catch (error) {
            status.textContent = friendlyError(error, 'Não foi possível enviar a evidência. Podes tentar novamente.');
        } finally {
            input.disabled = false;
            upload.disabled = queuedFiles.length === 0;
        }
    });
    control.append(label, note, status, upload);
    card.append(control);
}

function createChallengeDeliveryForm(challenge) {
    const form = element('form', 'action-form challenge-form challenge-delivery-form');
    const label = element('label', '', 'Conta o que entregaste, o que aprendeste e onde está o resultado.');
    const submission = element('textarea', 'action-input');
    submission.maxLength = 3000;
    submission.rows = 4;
    submission.required = true;
    submission.value = challenge.viewer_delivery_submission || '';
    submission.placeholder = 'Resume o resultado e o impacto esperado. Podes anexar imagens ou vídeo abaixo.';
    label.append(submission);
    const status = element('p', 'form-status');
    status.setAttribute('role', 'status');
    const submit = element('button', 'button button-small', 'Enviar resultado para revisão');
    submit.type = 'submit';
    form.append(label, status, submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
            await window.ImpactaAPI.post(`/challenges/${encodeURIComponent(challenge.id)}/participation/delivery`, {
                submission: submission.value
            });
            challenge.viewer_participation_status = 'delivery_submitted';
            challenge.viewer_participates = true;
            challenge.viewer_delivery_submission = submission.value.trim();
            challenge.viewer_review_reason = null;
            const card = form.closest('.challenge-entry');
            if (card) card.replaceWith(createChallenge(challenge));
            showFeedNotice('Resultado enviado', 'A equipa do projecto vai rever a entrega e poderá confirmar a conclusão ou pedir ajustes.', { durationMs: 2600 });
        } catch (error) {
            status.textContent = friendlyError(error, 'Não foi possível enviar o resultado. Tenta novamente.');
            submit.disabled = false;
        }
    });
    return form;
}

function shareCompletedChallenge(challenge) {
    if (!postProjectField || !composerInput || !challenge.project_id) return;
    ensureProjectPostOption({ id: challenge.project_id, title: challenge.project_title || 'Projecto' });
    postProjectField.value = String(challenge.project_id);
    composerInput.value = `Concluí o desafio “${challenge.title}” no projecto “${challenge.project_title || 'da comunidade'}”.\n\n${challenge.viewer_delivery_submission || ''}`.trim();
    composerInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#partilhar-ideia')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    composerInput.focus({ preventScroll: true });
    showFeedNotice('Resultado pronto para partilhar', 'Revê o texto: a publicação será visível no feed público.', { durationMs: 3200 });
}

function createChallenge(challenge) {
    const card = element('article', 'challenge-entry');
    card.dataset.searchable = '';
    if (challenge.is_weekly_featured) card.append(element('span', 'challenge-weekly-label', 'Destaque desta semana'));
    card.append(element('span', 'tag tag-green', challenge.impact_area || 'Desafio comunitário'));
    card.append(element('h3', '', challenge.title));
    if (challenge.project_title) card.append(element('small', 'challenge-project-name', `Projecto: ${challenge.project_title}`));
    if (challenge.description) card.append(expandableDescription(challenge.description, 'challenge-description'));
    const openDate = challenge.opens_at ? new Date(`${String(challenge.opens_at).slice(0, 10)}T12:00:00`) : null;
    const closeDate = challenge.closes_at ? new Date(`${String(challenge.closes_at).slice(0, 10)}T12:00:00`) : null;
    const canParticipate = challenge.can_participate === true;
    const schedule = challenge.status === 'draft' && !canParticipate
        ? (openDate && !Number.isNaN(openDate.getTime()) ? `Agendado para ${openDate.toLocaleDateString('pt-AO')}` : 'A aguardar publicação')
        : !canParticipate && openDate && !Number.isNaN(openDate.getTime())
            ? `Abre em ${openDate.toLocaleDateString('pt-AO')}`
            : closeDate && !Number.isNaN(closeDate.getTime()) ? `Participação até ${closeDate.toLocaleDateString('pt-AO')}` : '';
    if (schedule) card.append(element('small', 'challenge-dates', schedule));
    card.append(element('small', 'participant-count', `${Number(challenge.participant_count) || 0} participantes`));
    const challengeLocation = [challenge.location_neighborhood, challenge.location_commune,
        challenge.location_municipality, challenge.location_city, challenge.location_province]
        .filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    if (challengeLocation.length) card.append(element('small', 'project-location', `Local: ${challengeLocation.join(', ')}`));

    const status = challenge.viewer_participation_status;
    if (challenge.viewer_participates) {
        const statusText = status === 'approved' ? 'A equipa aceitou a tua proposta. Já és participante do projecto e podes colaborar na conversa privada.'
            : status === 'delivery_submitted' ? 'Resultado enviado. Aguarda a revisão da equipa do projecto.'
                : status === 'changes_requested' ? 'A equipa pediu ajustes antes de confirmar a conclusão.'
                    : status === 'completed' ? 'A equipa confirmou que o desafio foi concluído.'
                        : 'A tua participação foi recebida e aguarda análise.';
        card.append(element('p', 'participation-done', statusText));
        if (challenge.viewer_review_reason) card.append(element('p', 'challenge-review-reason', `Nota da equipa: ${challenge.viewer_review_reason}`));
        const evidence = createChallengeEvidenceGallery(challenge.viewer_evidence);
        if (evidence.childElementCount) card.append(evidence);
        if (status === 'submitted') appendChallengeEvidenceControl(card, challenge, 'proposal');
        if (status === 'approved' || status === 'changes_requested') card.append(createChallengeDeliveryForm(challenge));
        if (status === 'approved' || status === 'changes_requested' || status === 'delivery_submitted') {
            appendChallengeEvidenceControl(card, challenge, 'delivery');
        }
        if (status === 'completed' && challenge.project_id) {
            const share = element('button', 'button button-small challenge-share-result', 'Partilhar resultado no feed');
            share.type = 'button';
            share.addEventListener('click', () => shareCompletedChallenge(challenge));
            card.append(share);
        }
        return card;
    }
    if (status === 'rejected') {
        card.append(element('p', 'challenge-scheduled-state', 'A equipa não aceitou a proposta. Podes ajustar a resposta e tentar novamente enquanto o desafio estiver aberto.'));
        if (challenge.viewer_review_reason) card.append(element('p', 'challenge-review-reason', `Motivo: ${challenge.viewer_review_reason}`));
        const rejectedEvidence = createChallengeEvidenceGallery(challenge.viewer_evidence);
        if (rejectedEvidence.childElementCount) card.append(rejectedEvidence);
    }
    if (!canParticipate) {
        const state = challenge.status === 'draft' ? 'Este desafio está agendado e ainda não aceita participações.' : 'As participações ainda não começaram.';
        card.append(element('p', 'challenge-scheduled-state', state));
        return card;
    }
    if (!currentUser) {
        const login = element('a', 'button button-full', 'Entrar para participar');
        login.href = 'index.html#login';
        card.append(login);
        return card;
    }
    const toggle = element('button', 'button button-full challenge-button', status === 'rejected' ? 'Enviar nova proposta' : 'Participar neste desafio');
    toggle.type = 'button';
    const form = element('form', 'action-form challenge-form');
    form.hidden = true;
    const submission = element('textarea', 'action-input');
    submission.maxLength = 2000;
    submission.rows = 3;
    submission.required = true;
    submission.value = status === 'rejected' ? (challenge.viewer_submission || '') : '';
    submission.placeholder = 'Explica como pretendes contribuir e que resultado gostarias de alcançar.';
    const note = element('small', 'challenge-participation-note', 'A resposta é uma proposta. Se for aceite, passarás a integrar a equipa do projecto e poderás enviar a entrega e evidências em privado.');
    const formStatus = element('p', 'form-status');
    formStatus.setAttribute('role', 'status');
    const submit = element('button', 'button button-small', status === 'rejected' ? 'Enviar nova proposta' : 'Enviar a minha proposta');
    submit.type = 'submit';
    form.append(submission, note, formStatus, submit);
    toggle.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) submission.focus();
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
            const response = await window.ImpactaAPI.post(`/challenges/${encodeURIComponent(challenge.id)}/participations`, { submission: submission.value });
            challenge.viewer_participation_id = response.id;
            challenge.viewer_participates = true;
            challenge.viewer_participation_status = 'submitted';
            challenge.viewer_submission = submission.value.trim();
            challenge.viewer_review_reason = null;
            challenge.participant_count = Number(challenge.participant_count) + 1;
            card.replaceWith(createChallenge(challenge));
            showFeedNotice('Proposta enviada', 'A equipa do projecto foi notificada e vai analisar a tua participação.', { durationMs: 2200 });
        } catch (error) {
            formStatus.textContent = friendlyError(error, 'Não foi possível participar. Tenta novamente.');
            submit.disabled = false;
        }
    });
    card.append(toggle, form);
    return card;
}

function createProject(project) {
    const card = element('article', 'project-card');
    card.dataset.searchable = '';
    card.dataset.projectId = String(project.id);
    const row = element('div', 'project-row');
    row.append(element('span', 'project-icon project-icon-green', '↗'));
    const copy = element('span');
    copy.append(element('strong', '', project.title));
    const applicantCount = Number(project.participant_count) || 0;
    const details = [project.impact_area, `${applicantCount} ${applicantCount === 1 ? 'pessoa inscrita' : 'pessoas inscritas'}`].filter(Boolean).join(' · ');
    const detailsNode = element('small', '', details);
    copy.append(detailsNode);
    row.append(copy);
    let activityBadge = null;
    let activityPanel = null;
    if (currentUser) {
        activityBadge = element('button', 'entity-notification-count project-notification-count', '0');
        activityBadge.type = 'button';
        activityBadge.hidden = true;
        activityBadge.setAttribute('aria-label', 'Notificações por ler neste projecto');
        activityBadge.setAttribute('aria-expanded', 'false');
        activityPanel = element('section', 'project-notification-panel');
        activityPanel.id = `project-notification-${String(project.id)}`;
        activityPanel.hidden = true;
        activityBadge.setAttribute('aria-controls', activityPanel.id);
        activityBadge.addEventListener('click', () => {
            const opening = activityPanel.hidden;
            activityPanel.hidden = !opening;
            activityBadge.setAttribute('aria-expanded', String(opening));
            if (opening) void loadProjectNotifications(project.id, activityPanel, activityBadge);
        });
        row.append(activityBadge);
    }
    card.append(row);
    if (activityPanel) card.append(activityPanel);
    if (project.description) card.append(expandableDescription(project.description, 'project-description'));
    if (project.is_upcoming && project.starts_at) {
        const startDate = new Date(`${String(project.starts_at).slice(0, 10)}T12:00:00`);
        if (!Number.isNaN(startDate.getTime())) {
            card.append(element('small', 'project-schedule', `Começa em ${startDate.toLocaleDateString('pt-AO')}`));
        }
    }
    if (project.status === 'completed') {
        card.append(element('small', 'project-schedule', 'Projecto concluído · actualizações e resultados continuam públicos.'));
    }
    card.append(element('small', 'project-community', project.community || 'Projecto independente'));
    if (project.moderator_name) {
        card.append(element('small', 'project-moderator', `Moderador: ${project.moderator_name}${project.viewer_is_moderator ? ' · és tu' : ''}`));
    }
    const location = [project.location_neighborhood, project.location_commune, project.location_municipality,
        project.location_city, project.location_province].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    if (location.length) card.append(element('small', 'project-location', `Local: ${location.join(', ')}`));

    if (currentUser && project.viewer_can_manage) {
        if (project.status !== 'completed') {
            const createChallenge = element('button', 'project-join project-challenge-create', 'Criar desafio para este projecto');
            createChallenge.type = 'button';
            createChallenge.addEventListener('click', () => {
                const projectField = challengeCreateForm?.elements.namedItem('projectId');
                if (projectField instanceof HTMLInputElement) projectField.value = project.id;
                const status = challengeCreateForm?.querySelector('[data-resource-status]');
                if (status) status.textContent = '';
                challengeCreateForm?.reset();
                if (projectField instanceof HTMLInputElement) projectField.value = project.id;
                challengeDialog?.showModal();
            });
            card.append(createChallenge);
        }
        const reviewButton = element('button', 'project-join project-review-open', 'Rever participações dos desafios');
        reviewButton.type = 'button';
        reviewButton.setAttribute('aria-expanded', 'false');
        const reviewPanel = element('section', 'project-review-panel');
        reviewPanel.id = `project-review-${String(project.id)}`;
        reviewPanel.hidden = true;
        reviewPanel.setAttribute('aria-live', 'polite');
        reviewButton.setAttribute('aria-controls', reviewPanel.id);
        reviewButton.addEventListener('click', async () => {
            const opening = reviewPanel.hidden;
            reviewPanel.hidden = !opening;
            reviewButton.setAttribute('aria-expanded', String(opening));
            if (opening) await loadProjectChallengeParticipations(project.id, reviewPanel);
        });
        card.append(reviewButton, reviewPanel);
    }

    if (project.viewer_participates) {
        card.append(element('p', 'participation-done', 'Já participas neste projecto.'));
    } else if (project.status === 'completed') {
        // Completed projects remain visible for public progress and result updates, without new joins.
    } else if (!currentUser) {
        const login = element('a', 'project-join', 'Entrar para participar neste projecto');
        login.href = 'index.html#login';
        card.append(login);
    } else {
        const join = element('button', 'project-join', project.is_upcoming ? 'Inscrever-me neste projecto' : 'Quero participar neste projecto');
        const joinFeedback = element('small', 'project-join-feedback');
        joinFeedback.setAttribute('role', 'status');
        joinFeedback.setAttribute('aria-live', 'polite');
        join.type = 'button';
        join.addEventListener('click', async () => {
            join.disabled = true;
            joinFeedback.textContent = '';
            try {
                const response = await window.ImpactaAPI.post(`/projects/${project.id}/members`, {});
                project.viewer_participates = true;
                project.viewer_can_chat = true;
                ensureProjectPostOption(project);
                if (response.status === 'joined') project.participant_count = Number(project.participant_count) + 1;
                detailsNode.textContent = [project.impact_area, `${project.participant_count} ${project.participant_count === 1 ? 'pessoa inscrita' : 'pessoas inscritas'}`].filter(Boolean).join(' · ');
                appendProjectChatControl(card, project);
                void refreshEntityNotificationBadges();
                join.replaceWith(element('p', 'participation-done', 'A tua inscrição neste projecto foi confirmada.'));
            } catch (error) {
                join.disabled = false;
                const reference = error?.requestId ? ` Referência: ${error.requestId}.` : '';
                joinFeedback.textContent = error?.code === 'internal_server_error'
                    ? `A API não conseguiu concluir a inscrição. A falha foi registada para diagnóstico.${reference}`
                    : friendlyError(error, 'Não foi possível registar a tua inscrição neste projecto. Actualiza a lista e tenta novamente.');
            }
        });
        card.append(join, joinFeedback);
    }
    if (currentUser && project.viewer_can_chat) appendProjectChatControl(card, project);
    if (requestedProjectId && requestedProjectId === String(project.id) && project.viewer_can_chat) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('project');
        window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash);
        window.setTimeout(() => openProjectChat(project), 0);
    }
    return card;
}

async function loadProjectChallengeParticipations(projectId, panel, before = null) {
    const moreButton = before ? panel.querySelector('.project-review-more') : null;
    if (!before) panel.replaceChildren(element('p', 'project-review-status', 'A carregar participações…'));
    else if (moreButton) { moreButton.disabled = true; moreButton.textContent = 'A carregar…'; }
    try {
        const suffix = before ? `?before=${encodeURIComponent(before)}` : '';
        const result = await window.ImpactaAPI.request(
            `/projects/${encodeURIComponent(projectId)}/challenge-participations${suffix}`
        );
        if (before) moreButton?.remove();
        else panel.replaceChildren();
        const items = Array.isArray(result.items) ? result.items : [];
        if (!items.length && !before) {
            panel.append(element('p', 'project-review-status', 'Ainda não há participações nos desafios deste projecto.'));
            return;
        }
        items.forEach((participation) => panel.append(createProjectParticipationEntry(participation, projectId)));
        if (result.hasMore && result.nextBefore) {
            const older = element('button', 'project-review-more', 'Carregar participações anteriores');
            older.type = 'button';
            older.addEventListener('click', () => void loadProjectChallengeParticipations(projectId, panel, result.nextBefore));
            panel.append(older);
        }
    } catch (error) {
        if (moreButton) {
            moreButton.disabled = false;
            moreButton.textContent = 'Tentar carregar participações anteriores';
        } else {
            panel.replaceChildren(element('p', 'project-review-status is-error', friendlyError(error, 'Não foi possível carregar as participações.')));
        }
    }
}

function createProjectReviewButton(projectId, participation, decision, label, needsReason) {
    const actions = element('div', 'project-review-actions');
    const button = element('button', `button button-small${needsReason ? ' button-quiet' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', () => {
        if (needsReason) {
            const form = element('form', 'project-review-reason-form');
            const reason = element('textarea', 'action-input');
            reason.maxLength = 500;
            reason.minLength = 5;
            reason.rows = 2;
            reason.required = true;
            reason.placeholder = decision === 'reject'
                ? 'Explica brevemente por que a proposta não foi aceite.'
                : 'Indica o que precisa de ser ajustado na entrega.';
            const submit = element('button', 'button button-small button-quiet', decision === 'reject' ? 'Confirmar recusa' : 'Enviar pedido de ajustes');
            submit.type = 'submit';
            const status = element('small', 'project-review-status');
            form.append(reason, submit, status);
            button.replaceWith(form);
            reason.focus();
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                void sendProjectParticipationDecision(projectId, participation, decision, reason.value, actions, status);
            });
            return;
        }
        void sendProjectParticipationDecision(projectId, participation, decision, '', actions, null);
    });
    actions.append(button);
    return actions;
}

async function sendProjectParticipationDecision(projectId, participation, decision, reason, actions, statusNode) {
    actions.querySelectorAll('button, textarea').forEach((item) => { item.disabled = true; });
    try {
        const response = await window.ImpactaAPI.post(
            `/projects/${encodeURIComponent(projectId)}/challenge-participations/${encodeURIComponent(participation.id)}`,
            { decision, reason: reason || undefined }
        );
        participation.status = response.status;
        participation.review_reason = reason || null;
        const entry = actions.closest('.project-review-item');
        entry?.replaceWith(createProjectParticipationEntry(participation, projectId));
        const notices = {
            approve: 'A pessoa foi aceite como participante e já pode colaborar na conversa privada do projecto.',
            reject: 'A recusa e o motivo foram registados; a pessoa poderá ajustar a proposta e tentar novamente.',
            complete: 'A conclusão foi registada. O resultado só será público se alguém o partilhar no feed.',
            request_changes: 'A pessoa recebeu o pedido de ajustes e poderá enviar uma nova versão.'
        };
        showFeedNotice('Etapa actualizada', notices[decision] || 'A actividade do projecto foi actualizada.', { durationMs: 2700 });
    } catch (error) {
        actions.querySelectorAll('button, textarea').forEach((item) => { item.disabled = false; });
        if (statusNode) statusNode.textContent = friendlyError(error, 'Actualiza a lista e tenta novamente.');
        else showFeedNotice('Não foi possível analisar', friendlyError(error, 'Actualiza a lista e tenta novamente.'), { danger: true, durationMs: 3000 });
    }
}

function createProjectParticipationEntry(participation, projectId) {
    const entry = element('article', 'project-review-item');
    entry.append(element('strong', '', `${participation.display_name} · ${participation.challenge_title}`));
    entry.append(element('p', '', participation.submission));
    const submittedAt = participation.submitted_at ? new Date(participation.submitted_at).toLocaleString('pt-AO') : '';
    entry.append(element('small', '', submittedAt));
    const labels = {
        submitted: 'Proposta aguarda análise', approved: 'Aceite · trabalho em curso', delivery_submitted: 'Entrega aguarda revisão',
        changes_requested: 'Ajustes solicitados', completed: 'Desafio concluído', rejected: 'Proposta recusada', withdrawn: 'Participação retirada'
    };
    entry.append(element('small', 'project-review-decision', labels[participation.status] || 'Estado actualizado'));
    if (participation.review_reason) entry.append(element('p', 'challenge-review-reason', `Nota enviada à pessoa: ${participation.review_reason}`));
    if (participation.delivery_submission) {
        entry.append(element('strong', 'project-review-delivery-title', 'Resultado apresentado'));
        entry.append(element('p', '', participation.delivery_submission));
    }
    const evidence = createChallengeEvidenceGallery(participation.evidence);
    if (evidence.childElementCount) entry.append(evidence);
    if (String(participation.user_id) !== String(currentUser?.id)) {
        if (participation.status === 'submitted') {
            if (participation.project_accepting_work) {
                entry.append(createProjectReviewButton(projectId, participation, 'approve', 'Aceitar e integrar no projecto', false));
            } else {
                entry.append(element('small', 'project-review-status', 'O período do projecto terminou; já não é possível aceitar novas pessoas.'));
            }
            entry.append(createProjectReviewButton(projectId, participation, 'reject', 'Recusar com motivo', true));
        } else if (participation.status === 'delivery_submitted') {
            entry.append(createProjectReviewButton(projectId, participation, 'complete', 'Confirmar conclusão', false));
            entry.append(createProjectReviewButton(projectId, participation, 'request_changes', 'Pedir ajustes', true));
        }
    }
    return entry;
}

function appendProjectChatControl(card, project) {
    if (!card || card.querySelector('.project-chat-entry')) return;
    const entry = element('div', 'project-chat-entry');
    const open = element('button', 'project-chat-open', 'Conversa do projecto');
    open.type = 'button';
    open.setAttribute('aria-label', `Abrir conversa privada do projecto ${project.title}`);
    const count = element('span', 'project-chat-unread-count', '0');
    count.hidden = true;
    open.append(count);
    open.addEventListener('click', () => openProjectChat(project));
    entry.append(open);
    card.append(entry);
}

const communityReportReasons = [
    ['adult_sexual_content', 'Pornografia ou conteúdo sexual explícito'],
    ['sexual_exploitation', 'Exploração sexual ou risco para menores'],
    ['harassment', 'Assédio'],
    ['hate', 'Discurso de ódio'],
    ['threats_violence', 'Ameaças ou violência'],
    ['spam_scam', 'Spam ou fraude'],
    ['illegal_activity', 'Actividade ilegal'],
    ['privacy', 'Exposição de dados pessoais'],
    ['other', 'Outro problema']
];

function addProjectMessageReportControl(container, projectId, messageId) {
    if (!currentUser || !container) return;
    const button = element('button', 'community-chat-message-action community-report-trigger', 'Denunciar');
    button.type = 'button';
    button.setAttribute('aria-label', 'Denunciar esta mensagem do projecto');
    button.addEventListener('click', () => {
        const existing = container.querySelector('.community-report-form');
        if (existing) { existing.remove(); return; }
        const form = element('form', 'community-report-form');
        const reasonLabel = element('label', '', 'Motivo da denúncia');
        const reason = element('select', 'community-report-field');
        reason.required = true;
        reason.add(new Option('Escolhe um motivo', '', true, true));
        communityReportReasons.forEach(([code, label]) => reason.add(new Option(label, code)));
        reason.value = '';
        reasonLabel.append(reason);
        const detailsLabel = element('label', '', 'Detalhes (opcional)');
        const details = element('textarea', 'community-report-field');
        details.maxLength = 1000;
        details.rows = 2;
        details.placeholder = 'Ajuda a equipa a perceber o que aconteceu.';
        detailsLabel.append(details);
        const status = element('p', 'community-report-status');
        status.setAttribute('role', 'status');
        const actions = element('div', 'community-report-actions');
        const submit = element('button', 'community-chat-message-action is-primary', 'Enviar denúncia');
        const cancel = element('button', 'community-chat-message-action', 'Cancelar');
        submit.type = 'submit';
        cancel.type = 'button';
        cancel.addEventListener('click', () => form.remove());
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            status.textContent = 'A enviar para revisão…';
            try {
                await window.ImpactaAPI.post(
                    `/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(messageId)}/reports`,
                    { reasonCode: reason.value, details: details.value.trim() }
                );
                status.textContent = 'Denúncia enviada. A equipa IMPACTA vai analisar este caso.';
                button.textContent = 'Denúncia enviada';
                button.disabled = true;
                submit.remove();
                cancel.textContent = 'Fechar';
                showFeedNotice('Denúncia recebida', 'A equipa IMPACTA vai analisar a mensagem.', { durationMs: 2100 });
            } catch (error) {
                submit.disabled = false;
                status.classList.add('is-error');
                status.textContent = friendlyError(error, 'Não foi possível enviar a denúncia. Tenta novamente.');
            }
        });
        actions.append(submit, cancel);
        form.append(reasonLabel, detailsLabel, actions, status);
        container.append(form);
        window.setTimeout(() => reason.focus(), 0);
    });
    container.append(button);
}

function addCommunityReportControl(container, communityId, messageId = null) {
    if (!currentUser || !container) return;
    const button = element('button', 'community-chat-message-action community-report-trigger', 'Denunciar');
    button.type = 'button';
    button.setAttribute('aria-label', messageId ? 'Denunciar esta mensagem' : 'Denunciar esta comunidade');
    button.setAttribute('aria-controls', 'community-report-' + communityId + '-' + (messageId || 'community'));
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
        const existing = container.querySelector('.community-report-form');
        if (existing) {
            existing.remove();
            button.setAttribute('aria-expanded', 'false');
            return;
        }
        const form = element('form', 'community-report-form');
        form.id = 'community-report-' + communityId + '-' + (messageId || 'community');
        const reasonLabel = element('label', '', 'Motivo da denúncia');
        const reason = element('select', 'community-report-field');
        reason.required = true;
        reason.add(new Option('Escolhe um motivo', '', true, true));
        communityReportReasons.forEach(([code, label]) => reason.add(new Option(label, code)));
        reason.value = '';
        reasonLabel.append(reason);
        const detailsLabel = element('label', '', 'Detalhes (opcional)');
        const details = element('textarea', 'community-report-field');
        details.maxLength = 1000;
        details.rows = 2;
        details.placeholder = 'Ajuda a equipa a perceber o que aconteceu.';
        detailsLabel.append(details);
        const status = element('p', 'community-report-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const actions = element('div', 'community-report-actions');
        const submit = element('button', 'community-chat-message-action is-primary', 'Enviar denúncia');
        const cancel = element('button', 'community-chat-message-action', 'Cancelar');
        submit.type = 'submit';
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
            form.remove();
            button.setAttribute('aria-expanded', 'false');
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            status.textContent = 'A enviar para revisão…';
            try {
                await window.ImpactaAPI.post(`/communities/${encodeURIComponent(communityId)}/reports`, {
                    messageId: messageId || undefined,
                    reasonCode: reason.value,
                    details: details.value.trim()
                });
                status.textContent = '';
                form.reset();
                submit.remove();
                cancel.textContent = 'Fechar';
                status.textContent = 'Denúncia enviada. A equipa IMPACTA vai analisar este caso.';
                button.textContent = 'Denúncia enviada';
                button.disabled = true;
                showFeedNotice('Denúncia recebida', 'A equipa IMPACTA vai analisar a mensagem.', { durationMs: 2100 });
            } catch (error) {
                status.textContent = '';
                showFeedNotice('Não foi possível denunciar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
                status.classList.add('is-error');
                status.textContent = friendlyError(error, 'Não foi possível enviar a denÃºncia. Tenta novamente.');
                submit.disabled = false;
            }
        });
        actions.append(submit, cancel);
        form.append(reasonLabel, detailsLabel, actions, status);
        container.append(form);
        button.setAttribute('aria-expanded', 'true');
        window.setTimeout(() => reason.focus(), 0);
    });
    container.append(button);
}

function renderCommunityChatMessage(message) {
    const item = element('article', `community-chat-message${message.is_author ? ' is-own-message' : ''}`);
    item.dataset.messageId = String(message.id);
    item.dataset.messageSignature = JSON.stringify([
        message.body || '', message.media_url || '', Boolean(message.edited), Boolean(message.is_deleted),
        Boolean(message.can_edit), Boolean(message.can_delete), Boolean(message.is_pending_review)
    ]);
    const heading = element('div', 'community-chat-message-heading');
    heading.append(element('strong', '', message.author || 'Membro'));
    const time = element('time', '', new Date(message.created_at).toLocaleString('pt-AO', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }));
    time.dateTime = message.created_at;
    heading.append(time);
    if (message.edited && !message.is_deleted) heading.append(element('span', 'community-chat-message-edited', 'Editada'));
    item.append(heading);
    if (message.is_deleted) {
        item.append(element('p', 'community-chat-message-copy is-removed', 'Mensagem eliminada.'));
        return item;
    }
    if (message.body) item.append(element('p', 'community-chat-message-copy', message.body));
    if (message.is_pending_review) {
        item.append(element('p', 'community-chat-review-notice', 'Este anexo está em revisão. Só tu e a equipa IMPACTA o podem ver por enquanto.'));
    }
    if (message.media_url) {
        const mediaUrl = window.ImpactaAPI.assetUrl(message.media_url);
        if (message.media_type === 'video') {
            const video = element('video', 'community-chat-message-media');
            video.src = mediaUrl;
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('aria-label', 'Vídeo partilhado na comunidade');
            item.append(video);
        } else {
            const image = element('img', 'community-chat-message-media');
            image.src = mediaUrl;
            image.alt = 'Imagem partilhada na comunidade';
            image.loading = 'lazy';
            item.append(image);
        }
    }
    if (message.can_edit || message.can_delete || !message.is_author) {
        const actions = element('div', 'community-chat-message-actions');
        if (!message.is_author && activeCommunityChat) {
            addCommunityReportControl(actions, activeCommunityChat.id, message.id);
        }
        if (message.can_edit && message.body) {
            const edit = element('button', 'community-chat-message-action', 'Editar');
            edit.type = 'button';
            edit.addEventListener('click', () => {
                item.dataset.editing = 'true';
                const copy = item.querySelector('.community-chat-message-copy');
                const editor = element('textarea', 'community-chat-message-editor');
                editor.maxLength = 2000;
                editor.value = message.body;
                editor.setAttribute('aria-label', 'Editar mensagem');
                const editorActions = element('div', 'community-chat-message-editor-actions');
                const save = element('button', 'community-chat-message-action is-primary', 'Guardar');
                const cancel = element('button', 'community-chat-message-action', 'Cancelar');
                save.type = cancel.type = 'button';
                save.addEventListener('click', async () => {
                    const body = editor.value.trim();
                    if (!body) {
                        if (communityChatFormStatus) communityChatFormStatus.textContent = 'A mensagem não pode ficar vazia.';
                        return;
                    }
                    save.disabled = true;
                    try {
                        const response = await window.ImpactaAPI.put(
                            `/communities/${encodeURIComponent(activeCommunityChat.id)}/messages/${encodeURIComponent(message.id)}`,
                            { body }
                        );
                        const updated = { ...message, ...response.item };
                        item.replaceWith(renderCommunityChatMessage(updated));
                        if (communityChatFormStatus) communityChatFormStatus.textContent = '';
                        showFeedNotice('Mensagem editada', 'As alterações foram guardadas.', { durationMs: 1800 });
                    } catch (error) {
                        save.disabled = false;
                        if (communityChatFormStatus) communityChatFormStatus.textContent = '';
                        showFeedNotice('Não foi possível guardar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
                    }
                });
                cancel.addEventListener('click', () => item.replaceWith(renderCommunityChatMessage(message)));
                editorActions.append(save, cancel);
                if (copy) copy.replaceWith(editor, editorActions);
                editor.focus();
            });
            actions.append(edit);
        }
        if (message.can_delete) {
            const remove = element('button', 'community-chat-message-action is-danger', message.is_author ? 'Eliminar' : 'Moderar');
            remove.type = 'button';
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                const confirmed = await window.ImpactaModal.confirm({
                    title: message.is_author ? 'Eliminar mensagem?' : 'Remover mensagem?',
                    message: message.is_author
                        ? 'A mensagem deixará de aparecer na conversa.'
                        : 'A mensagem será removida da conversa para todos os membros.',
                    confirmLabel: message.is_author ? 'Eliminar mensagem' : 'Remover mensagem',
                    danger: true
                });
                if (!confirmed) { remove.disabled = false; return; }
                try {
                    const response = await window.ImpactaAPI.delete(
                        `/communities/${encodeURIComponent(activeCommunityChat.id)}/messages/${encodeURIComponent(message.id)}`
                    );
                    item.replaceWith(renderCommunityChatMessage({
                        ...message, ...response.item, body: null, media_url: null, media_type: null,
                        is_deleted: true, can_edit: false, can_delete: false
                    }));
                    if (communityChatFormStatus) communityChatFormStatus.textContent = '';
                    showFeedNotice('Mensagem removida', 'A mensagem foi removida da conversa.', { durationMs: 1700 });
                } catch (error) {
                    remove.disabled = false;
                    if (communityChatFormStatus) communityChatFormStatus.textContent = '';
                    showFeedNotice('Não foi possível remover', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
                }
            });
            actions.append(remove);
        }
        item.append(actions);
    }
    return item;
}

function appendCommunityChatMessage(message, { prepend = false } = {}) {
    if (!communityChatMessages) return;
    try {
        if (BigInt(message.id) > BigInt(lastCommunityMessageId)) lastCommunityMessageId = String(message.id);
    } catch { /* Ignore malformed IDs in an unexpected API response. */ }
    const existing = communityChatMessages.querySelector(`[data-message-id="${String(message.id)}"]`);
    if (existing) {
        if (existing.dataset.editing === 'true') return;
        const signature = JSON.stringify([
            message.body || '', message.media_url || '', Boolean(message.edited), Boolean(message.is_deleted),
            Boolean(message.can_edit), Boolean(message.can_delete)
        ]);
        if (existing.dataset.messageSignature !== signature) existing.replaceWith(renderCommunityChatMessage(message));
        return;
    }
    communityChatMessageIds.add(String(message.id));
    const shouldStayAtBottom = communityChatMessages.scrollHeight - communityChatMessages.scrollTop
        - communityChatMessages.clientHeight < 80;
    const item = renderCommunityChatMessage(message);
    if (prepend) communityChatMessages.prepend(item);
    else communityChatMessages.append(item);
    if (shouldStayAtBottom) communityChatMessages.scrollTop = communityChatMessages.scrollHeight;
}

async function updateCommunityChat({ initial = false, older = false, refresh = false } = {}) {
    if (!activeCommunityChat || communityChatPolling) {
        if (older && communityChatOlderButton) communityChatOlderButton.disabled = false;
        return;
    }
    communityChatPolling = true;
    try {
        const suffix = initial ? '' : refresh
            ? '?recent=1'
            : older
            ? `?before=${encodeURIComponent(firstCommunityMessageId)}`
            : `?after=${encodeURIComponent(lastCommunityMessageId)}`;
        const data = await window.ImpactaAPI.request(
            `/communities/${encodeURIComponent(activeCommunityChat.id)}/messages${suffix}`
        );
        if (initial) {
            communityChatMessages?.replaceChildren();
            communityChatMessageIds = new Set();
            lastCommunityMessageId = '0';
        }
        const previousHeight = communityChatMessages?.scrollHeight || 0;
        const previousTop = communityChatMessages?.scrollTop || 0;
        const newMessages = data.items || [];
        (older ? [...newMessages].reverse() : newMessages)
            .forEach((message) => appendCommunityChatMessage(message, { prepend: older }));
        if (data.items?.length && (initial || older)) firstCommunityMessageId = String(data.items[0].id);
        if (communityChatOlderButton && (initial || older)) {
            communityChatOlderButton.hidden = data.has_more !== true;
            communityChatOlderButton.disabled = false;
        }
        if (communityChatForm) communityChatForm.hidden = data.can_send !== true;
        if (communityChatLockControls) communityChatLockControls.hidden = data.is_owner !== true;
        if (communityChatLockButton) communityChatLockButton.hidden = data.chat_is_locked === true;
        if (communityChatUnlockButton) communityChatUnlockButton.hidden = data.chat_is_locked !== true;
        if (communityChatStatus) {
            communityChatStatus.textContent = data.can_send
            ? 'Apenas membros ativos podem escrever. O responsável é quem criou a comunidade. A conversa atualiza automaticamente.'
                : 'Acompanhamento administrativo · apenas leitura.';
        }
        if (data.chat_is_locked && communityChatStatus) {
            const until = data.chat_locked_until
                ? new Date(data.chat_locked_until).toLocaleString('pt-AO', { dateStyle: 'short', timeStyle: 'short' })
                : '';
            communityChatStatus.textContent = data.is_owner
                ? `Pausaste o envio para os membros. Como responsável, podes publicar avisos${until ? ` até ${until}` : ''}.`
                : `O responsável pausou temporariamente o envio de mensagens${until ? ` até ${until}` : ''}.`;
        }
        if (initial && communityChatMessages) communityChatMessages.scrollTop = communityChatMessages.scrollHeight;
        else if (older && communityChatMessages) communityChatMessages.scrollTop = previousTop + communityChatMessages.scrollHeight - previousHeight;
        if (communityChatStatus) communityChatStatus.classList.remove('is-error');
        const receivedNewMessage = newMessages.some((message) => !message.is_author && !message.is_pending_review);
        if (!older && (initial || receivedNewMessage) && (data.is_member || data.is_owner)) {
            try {
                await window.ImpactaAPI.put(
                    `/communities/${encodeURIComponent(activeCommunityChat.id)}/read-messages`, {}
                );
            } catch {
                // A falha ao actualizar a leitura não significa que a conversa falhou; o polling tenta novamente.
            }
            await refreshEntityNotificationBadges();
        }
    } catch (error) {
        if (older && communityChatOlderButton) communityChatOlderButton.disabled = false;
        if (communityChatStatus && (initial || older || !communityChatMessages?.childElementCount)) {
            communityChatStatus.textContent = friendlyError(error, 'Não foi possível carregar a conversa.');
            communityChatStatus.classList.add('is-error');
        }
    } finally {
        communityChatPolling = false;
    }
}

function clearCommunityChatAttachment() {
    if (communityChatFile) communityChatFile.value = '';
    if (communityChatAttachment) {
        communityChatAttachment.replaceChildren();
        communityChatAttachment.hidden = true;
    }
}

function openCommunityChat(community) {
    if (!currentUser) {
        window.location.assign('index.html#login');
        return;
    }
    activeCommunityChat = community;
    lastCommunityMessageId = '0';
    firstCommunityMessageId = '';
    communityChatMessageIds = new Set();
    communityChatTitle.textContent = community.name;
    communityChatMessages?.replaceChildren();
    if (communityChatOlderButton) {
        communityChatOlderButton.hidden = true;
        communityChatOlderButton.disabled = false;
    }
    if (communityChatStatus) {
        communityChatStatus.textContent = 'A carregar mensagens…';
        communityChatStatus.classList.remove('is-error');
    }
    if (communityChatForm) communityChatForm.hidden = community.viewer_member !== true;
    if (communityChatLockControls) communityChatLockControls.hidden = community.viewer_is_owner !== true;
    if (communityChatLockButton) communityChatLockButton.hidden = false;
    if (communityChatUnlockButton) communityChatUnlockButton.hidden = true;
    if (communityChatFormStatus) communityChatFormStatus.textContent = '';
    if (communityChatInput) communityChatInput.value = '';
    clearCommunityChatAttachment();
    communityChatDialog?.showModal();
    void updateCommunityChat({ initial: true });
    if (communityChatPollingTimer) window.clearInterval(communityChatPollingTimer);
    communityChatPollingTimer = window.setInterval(() => {
        if (communityChatDialog?.open && document.visibilityState === 'visible') void updateCommunityChat({ refresh: true });
    }, 8000);
}

function renderProjectChatMessage(message) {
    const item = element('article', `community-chat-message${message.is_author ? ' is-own-message' : ''}`);
    item.dataset.messageId = String(message.id);
    item.dataset.messageSignature = JSON.stringify([message.body || '', Boolean(message.edited), Boolean(message.is_deleted)]);
    const heading = element('div', 'community-chat-message-heading');
    heading.append(element('strong', '', message.author || 'Membro'));
    const time = element('time', '', new Date(message.created_at).toLocaleString('pt-AO', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }));
    time.dateTime = message.created_at;
    heading.append(time);
    if (message.edited && !message.is_deleted) heading.append(element('span', 'community-chat-message-edited', 'Editada'));
    item.append(heading);
    if (message.is_deleted) {
        item.append(element('p', 'community-chat-message-copy is-removed', 'Mensagem eliminada.'));
        return item;
    }
    item.append(element('p', 'community-chat-message-copy', message.body || ''));
    if (message.can_edit || message.can_delete || !message.is_author) {
        const actions = element('div', 'community-chat-message-actions');
        if (!message.is_author && activeProjectChat) {
            addProjectMessageReportControl(actions, activeProjectChat.id, message.id);
        }
        if (message.can_edit) {
            const edit = element('button', 'community-chat-message-action', 'Editar');
            edit.type = 'button';
            edit.addEventListener('click', () => {
                item.dataset.editing = 'true';
                const copy = item.querySelector('.community-chat-message-copy');
                const editor = element('textarea', 'community-chat-message-editor');
                editor.maxLength = 1200;
                editor.value = message.body || '';
                editor.setAttribute('aria-label', 'Editar mensagem');
                const editorActions = element('div', 'community-chat-message-editor-actions');
                const save = element('button', 'community-chat-message-action is-primary', 'Guardar');
                const cancel = element('button', 'community-chat-message-action', 'Cancelar');
                save.type = cancel.type = 'button';
                save.addEventListener('click', async () => {
                    const body = editor.value.trim();
                    if (!body) { if (projectChatFormStatus) projectChatFormStatus.textContent = 'A mensagem não pode ficar vazia.'; return; }
                    save.disabled = true;
                    try {
                        const response = await window.ImpactaAPI.put(
                            `/projects/${encodeURIComponent(activeProjectChat.id)}/messages/${encodeURIComponent(message.id)}`,
                            { body }
                        );
                        item.replaceWith(renderProjectChatMessage({ ...message, ...response.item }));
                        if (projectChatFormStatus) projectChatFormStatus.textContent = '';
                    } catch (error) {
                        save.disabled = false;
                        if (projectChatFormStatus) projectChatFormStatus.textContent = friendlyError(error, 'Não foi possível guardar a mensagem.');
                    }
                });
                cancel.addEventListener('click', () => item.replaceWith(renderProjectChatMessage(message)));
                editorActions.append(save, cancel);
                if (copy) copy.replaceWith(editor, editorActions);
                editor.focus();
            });
            actions.append(edit);
        }
        if (message.can_delete) {
            const remove = element('button', 'community-chat-message-action is-danger', message.is_author ? 'Eliminar' : 'Remover');
            remove.type = 'button';
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                const confirmed = await window.ImpactaModal.confirm({
                    title: message.is_author ? 'Eliminar mensagem?' : 'Remover mensagem?',
                    message: 'A mensagem deixará de aparecer na conversa para todos os participantes.',
                    confirmLabel: message.is_author ? 'Eliminar mensagem' : 'Remover mensagem', danger: true
                });
                if (!confirmed) { remove.disabled = false; return; }
                try {
                    const response = await window.ImpactaAPI.delete(
                        `/projects/${encodeURIComponent(activeProjectChat.id)}/messages/${encodeURIComponent(message.id)}`
                    );
                    item.replaceWith(renderProjectChatMessage({
                        ...message, ...response.item, body: null, is_deleted: true, can_edit: false, can_delete: false
                    }));
                    if (projectChatFormStatus) projectChatFormStatus.textContent = '';
                } catch (error) {
                    remove.disabled = false;
                    if (projectChatFormStatus) projectChatFormStatus.textContent = friendlyError(error, 'Não foi possível remover a mensagem.');
                }
            });
            actions.append(remove);
        }
        item.append(actions);
    }
    return item;
}

function appendProjectChatMessage(message, { prepend = false } = {}) {
    if (!projectChatMessages) return;
    try {
        if (BigInt(message.id) > BigInt(lastProjectMessageId)) lastProjectMessageId = String(message.id);
    } catch { /* Ignore an unexpected malformed message ID. */ }
    const existing = projectChatMessages.querySelector(`[data-message-id="${String(message.id)}"]`);
    const signature = JSON.stringify([message.body || '', Boolean(message.edited), Boolean(message.is_deleted)]);
    if (existing) {
        if (existing.dataset.editing === 'true') return;
        if (existing.dataset.messageSignature !== signature) existing.replaceWith(renderProjectChatMessage(message));
        return;
    }
    const shouldStayAtBottom = projectChatMessages.scrollHeight - projectChatMessages.scrollTop
        - projectChatMessages.clientHeight < 80;
    const item = renderProjectChatMessage(message);
    if (prepend) projectChatMessages.prepend(item);
    else projectChatMessages.append(item);
    if (shouldStayAtBottom) projectChatMessages.scrollTop = projectChatMessages.scrollHeight;
}

async function updateProjectChat({ initial = false, older = false, refresh = false } = {}) {
    if (!activeProjectChat || projectChatPolling) {
        if (older && projectChatOlderButton) projectChatOlderButton.disabled = false;
        return;
    }
    projectChatPolling = true;
    const projectId = activeProjectChat.id;
    try {
        const wasAtBottom = initial || (projectChatMessages
            && projectChatMessages.scrollHeight - projectChatMessages.scrollTop - projectChatMessages.clientHeight < 80);
        const suffix = initial ? '' : refresh ? '?recent=1'
            : older ? `?before=${encodeURIComponent(firstProjectMessageId)}`
                : `?after=${encodeURIComponent(lastProjectMessageId)}`;
        const data = await window.ImpactaAPI.request(`/projects/${encodeURIComponent(projectId)}/messages${suffix}`);
        if (activeProjectChat?.id !== projectId) return;
        if (initial) {
            projectChatMessages?.replaceChildren();
            lastProjectMessageId = '0';
        }
        const previousHeight = projectChatMessages?.scrollHeight || 0;
        const previousTop = projectChatMessages?.scrollTop || 0;
        const newMessages = data.items || [];
        (older ? [...newMessages].reverse() : newMessages).forEach((message) => appendProjectChatMessage(message, { prepend: older }));
        if (data.items?.length && (initial || older)) firstProjectMessageId = String(data.items[0].id);
        if (projectChatOlderButton && (initial || older)) {
            projectChatOlderButton.hidden = data.has_more !== true;
            projectChatOlderButton.disabled = false;
        }
        if (projectChatForm) projectChatForm.hidden = data.can_send !== true;
        if (projectChatMute) {
            activeProjectChat.muted = data.muted === true;
            projectChatMute.hidden = false;
            projectChatMute.textContent = activeProjectChat.muted ? 'Mostrar contagem' : 'Silenciar contagem';
            projectChatMute.setAttribute('aria-pressed', String(activeProjectChat.muted));
        }
        if (projectChatTitle && data.project_title) projectChatTitle.textContent = data.project_title;
        if (projectChatStatus) {
            projectChatStatus.textContent = data.can_send
                ? 'Conversa privada do projecto. Apenas participantes e responsáveis podem ler ou escrever.'
                : 'O projecto terminou ou foi encerrado. A conversa está disponível apenas para consulta.';
            projectChatStatus.classList.remove('is-error');
        }
        if (initial && projectChatMessages) projectChatMessages.scrollTop = projectChatMessages.scrollHeight;
        else if (older && projectChatMessages) projectChatMessages.scrollTop = previousTop + projectChatMessages.scrollHeight - previousHeight;
        const gotMessages = newMessages.some((message) => !message.is_author && !message.is_deleted);
        if (!older && (initial || (gotMessages && wasAtBottom))) {
            await window.ImpactaAPI.put(`/projects/${encodeURIComponent(projectId)}/read-messages`, {}).catch(() => undefined);
            await refreshEntityNotificationBadges();
        }
    } catch (error) {
        if (older && projectChatOlderButton) projectChatOlderButton.disabled = false;
        if (activeProjectChat?.id === projectId && projectChatStatus
            && (initial || older || !projectChatMessages?.childElementCount)) {
            projectChatStatus.textContent = friendlyError(error, 'Não foi possível carregar a conversa.');
            projectChatStatus.classList.add('is-error');
        }
    } finally {
        projectChatPolling = false;
    }
}

function openProjectChat(project) {
    if (!currentUser) { window.location.assign('index.html#login'); return; }
    activeProjectChat = project;
    lastProjectMessageId = '0';
    firstProjectMessageId = '';
    projectChatMessages?.replaceChildren();
    if (projectChatOlderButton) { projectChatOlderButton.hidden = true; projectChatOlderButton.disabled = false; }
    if (projectChatForm) projectChatForm.hidden = true;
    if (projectChatMute) projectChatMute.hidden = true;
    if (projectChatStatus) { projectChatStatus.textContent = 'A carregar mensagens…'; projectChatStatus.classList.remove('is-error'); }
    if (projectChatFormStatus) projectChatFormStatus.textContent = '';
    if (projectChatInput) projectChatInput.value = '';
    projectChatDialog?.showModal();
    void updateProjectChat({ initial: true });
    if (projectChatPollingTimer) window.clearInterval(projectChatPollingTimer);
    projectChatPollingTimer = window.setInterval(() => {
        if (projectChatDialog?.open && document.visibilityState === 'visible') void updateProjectChat({ refresh: true });
    }, 12_000);
}

function communityChatControls(community) {
    const controls = element('div', 'community-entry-actions');
    const open = element('button', 'community-chat-open', community.viewer_member ? 'Abrir conversa da comunidade' : 'Ver mensagens da comunidade');
    open.type = 'button';
    open.addEventListener('click', () => openCommunityChat(community));
    controls.append(open);
    if (community.viewer_is_moderator) {
        controls.append(element('span', 'participation-done', community.viewer_is_owner ? 'Responsável da comunidade' : 'Moderador da comunidade'));
    }
    if (community.viewer_member) controls.append(element('span', 'participation-done', 'Já és membro.'));
    return controls;
}

function communityMembershipRequestTools(community, detailsNode) {
    const tools = element('section', 'community-request-tools');
    const button = element('button', 'community-chat-open', `Analisar pedidos de adesão (${Number(community.pending_request_count) || 0})`);
    button.type = 'button';
    const panel = element('div', 'community-request-list');
    panel.hidden = true;
    button.addEventListener('click', async () => {
        panel.hidden = !panel.hidden;
        if (panel.hidden) return;
        button.disabled = true;
        panel.replaceChildren(element('p', 'community-request-note', 'A carregar pedidos…'));
        try {
            const result = await window.ImpactaAPI.request(
                `/communities/${encodeURIComponent(community.id)}/membership-requests`
            );
            panel.replaceChildren();
            if (!result.items?.length) {
                panel.append(element('p', 'community-request-note', 'Não há pedidos pendentes.'));
                return;
            }
            result.items.forEach((request) => {
                const row = element('article', 'community-request-item');
                row.append(element('strong', '', request.display_name));
                const actions = element('div', 'community-entry-actions');
                const decide = (decision, label) => {
                    const action = element('button', 'community-chat-open', label);
                    action.type = 'button';
                    action.addEventListener('click', async () => {
                        actions.querySelectorAll('button').forEach((entry) => { entry.disabled = true; });
                        try {
                            await window.ImpactaAPI.post(
                                `/communities/${encodeURIComponent(community.id)}/membership-requests/${encodeURIComponent(request.user_id)}`,
                                { decision }
                            );
                            if (decision === 'approve') community.member_count = Number(community.member_count) + 1;
                            community.pending_request_count = Math.max(0, Number(community.pending_request_count) - 1);
                            detailsNode.textContent = [community.impact_area, `${community.member_count} membros`].filter(Boolean).join(' · ');
                            button.textContent = `Analisar pedidos de adesão (${community.pending_request_count})`;
                            row.replaceWith(element('p', 'community-request-note', decision === 'approve' ? 'Entrada aprovada.' : 'Pedido recusado.'));
                        } catch (error) {
                            actions.querySelectorAll('button').forEach((entry) => { entry.disabled = false; });
                            panel.append(element('p', 'community-request-note is-error', friendlyError(error, 'Não foi possível atualizar o pedido.')));
                        }
                    });
                    return action;
                };
                actions.append(decide('approve', 'Aprovar entrada'), decide('reject', 'Recusar'));
                row.append(actions);
                panel.append(row);
            });
        } catch (error) {
            panel.replaceChildren(element('p', 'community-request-note is-error', friendlyError(error, 'Não foi possível carregar os pedidos.')));
        } finally {
            button.disabled = false;
        }
    });
    tools.append(button, panel);
    return tools;
}

function createCommunity(community) {
    const card = element('article', 'community-entry');
    card.dataset.searchable = '';
    card.dataset.communityId = String(community.id);
    const top = element('div', 'community-entry-top');
    const titleRow = element('div', 'community-entry-title-row');
    titleRow.append(element('strong', '', community.name));
    const unreadBadge = element('span', 'entity-notification-count community-unread-count', '0');
    unreadBadge.hidden = true;
    unreadBadge.setAttribute('aria-label', '0 mensagens por ler');
    titleRow.append(unreadBadge);
    top.append(titleRow);
    const details = [community.impact_area, `${Number(community.member_count) || 0} membros`].filter(Boolean).join(' · ');
    top.append(element('small', '', details));
    card.append(top);
    const communityLocation = [community.location_neighborhood, community.location_commune,
        community.location_municipality, community.location_city, community.location_province]
        .filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
    if (communityLocation.length) card.append(element('small', 'project-location', `Zona abrangida: ${communityLocation.join(', ')}`));
    if (community.description) card.append(expandableDescription(community.description, 'community-description'));
    if (community.moderator_name) {
        card.append(element('small', 'community-moderator', `Responsável: ${community.moderator_name}${community.viewer_is_owner ? ' · és tu' : ''}`));
    }

    if (community.viewer_member || community.viewer_is_platform_admin || community.viewer_is_moderator) {
        card.append(communityChatControls(community));
    } else if (community.viewer_request_pending) {
        card.append(element('p', 'community-request-note', 'Pedido enviado; aguarda aprovação do responsável.'));
    } else if (!currentUser) {
        const login = element('a', 'community-join', 'Entrar para pedir adesão');
        login.href = 'index.html#login';
        card.append(login);
    } else {
        const join = element('button', 'community-join', 'Pedir adesão à comunidade');
        join.type = 'button';
        join.addEventListener('click', async () => {
            join.disabled = true;
            try {
                const response = await window.ImpactaAPI.post(`/communities/${community.id}/members`, {});
                if (response.status === 'already_member') {
                    community.viewer_member = true;
                    join.replaceWith(communityChatControls(community));
                } else {
                    community.viewer_request_pending = true;
                    join.replaceWith(element('p', 'community-request-note', 'Pedido enviado; aguarda aprovação do responsável.'));
                }
            } catch (error) {
                join.disabled = false;
                join.textContent = friendlyError(error, 'Não foi possível enviar o pedido de adesão à comunidade. Tenta novamente.');
            }
        });
        card.append(join);
    }
    if (community.viewer_is_owner) {
        card.append(communityMembershipRequestTools(community, top.querySelector('small')));
    }
    if (currentUser && !community.viewer_is_owner) addCommunityReportControl(card, community.id);
    if (requestedCommunityId && requestedCommunityId === String(community.id)
        && (community.viewer_member || community.viewer_is_platform_admin)) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
        window.setTimeout(() => openCommunityChat(community), 0);
    }
    return card;
}

async function loadList(container, path, emptyMessage, createCard, errorMessage, areaFilter = null, locationFilter = null, offset = 0, append = false) {
    const generation = (resourceListGenerations.get(container) || 0) + 1;
    resourceListGenerations.set(container, generation);
    const hasLoadedItems = Boolean(container.querySelector('[data-searchable]'));
    const moreButton = append ? container.querySelector('.resource-more-button') : null;
    if (hasLoadedItems) container.classList.add('is-refreshing');
    container.setAttribute('aria-busy', 'true');
    if (moreButton) { moreButton.disabled = true; moreButton.textContent = 'A carregar mais…'; }
    try {
        const parameters = new URLSearchParams();
        if (areaFilter?.value) parameters.set('impactAreaId', areaFilter.value);
        if (locationFilter?.value.trim()) parameters.set('location', locationFilter.value.trim());
        if (path === '/communities' && requestedCommunityId) parameters.set('communityId', requestedCommunityId);
        if (path === '/projects' && requestedProjectId) parameters.set('projectId', requestedProjectId);
        parameters.set('offset', String(offset));
        const query = parameters.toString();
        const requestPath = query ? path + '?' + query : path;
        const result = await window.ImpactaAPI.request(requestPath);
        const items = Array.isArray(result.items) ? result.items : [];
        if (generation !== resourceListGenerations.get(container)) return;
        if (append) moreButton?.remove();
        else container.replaceChildren();
        if (items.length === 0 && offset === 0) {
            const filteredEmpty = areaFilter?.value || locationFilter?.value.trim()
                ? 'N\u00e3o h\u00e1 resultados com estes filtros.'
                : emptyMessage;
            container.append(element('p', 'empty-state', filteredEmpty));
        } else {
            items.forEach((item) => container.append(createCard(item)));
        }
        if (result.hasMore && items.length) {
            const more = element('button', 'button button-quiet button-small resource-more-button', 'Carregar mais');
            more.type = 'button';
            more.addEventListener('click', () => void loadList(
                container, path, emptyMessage, createCard, errorMessage, areaFilter, locationFilter,
                offset + items.length, true
            ));
            container.append(more);
        }
    } catch {
        if (generation !== resourceListGenerations.get(container)) return;
        if (moreButton) {
            moreButton.disabled = false;
            moreButton.textContent = 'Tentar carregar mais';
            moreButton.setAttribute('aria-label', errorMessage + ' Tentar novamente.');
            return;
        }
        const retry = element('button', 'button button-small retry-button', 'Tentar novamente');
        retry.type = 'button';
        retry.addEventListener('click', () => loadList(container, path, emptyMessage, createCard, errorMessage, areaFilter, locationFilter, offset, append));
        if (hasLoadedItems) {
            container.querySelector('.resource-load-error')?.remove();
            const message = element('p', 'resource-load-error', errorMessage);
            container.append(message, retry);
        } else {
            container.replaceChildren();
            const message = element('p', 'empty-state', errorMessage);
            container.append(message, retry);
        }
    } finally {
        if (generation === resourceListGenerations.get(container)) {
            container.removeAttribute('aria-busy');
            container.classList.remove('is-refreshing');
        }
    }
}
function loadResourceLists() {
    return Promise.all(resourceListingConfigs.map((listing) => loadResourceListing(listing)));
}

function loadResourceListing(listing) {
    return loadList(listing.container, listing.path, listing.emptyMessage, listing.createCard, listing.errorMessage,
        listing.filter, listing.locationFilter);
}

async function refreshFeedContent() {
    await Promise.all([
        loadPosts(),
        loadResourceLists()
    ]);
}

async function loadResourceCatalogs() {
    const areaSelects = [...document.querySelectorAll('[data-impact-area-select]')];
    const filterSelects = [...document.querySelectorAll('[data-resource-area-filter]')];
    try {
        const areas = await window.ImpactaAPI.get('/impact-areas');
        for (const select of areaSelects) {
            select.replaceChildren(new Option('Sem área específica', ''));
            areas.forEach((area) => select.add(new Option(area.name, area.id)));
        }
        for (const select of filterSelects) {
            select.replaceChildren(new Option('Todas as áreas', ''));
            areas.forEach((area) => select.add(new Option(area.name, area.id)));
        }
    } catch {
        // Area is optional; the creation form remains usable if the catalog is offline.
    }
    const communitySelect = document.querySelector('#project-community-select');
    if (communitySelect) {
        try {
            const communities = await window.ImpactaAPI.get('/communities');
            communitySelect.replaceChildren(new Option('Projeto independente', ''));
            communities.filter((community) => community.viewer_member)
                .forEach((community) => communitySelect.add(new Option(community.name, community.id)));
        } catch {
            // A project can still be submitted without a community.
        }
    }
    if (postProjectField) {
        try {
            const projects = [];
            let offset = 0;
            let hasMore = true;
            while (hasMore) {
                const result = await window.ImpactaAPI.request(`/projects?mine=true&offset=${offset}`);
                const page = Array.isArray(result.items) ? result.items : [];
                projects.push(...page);
                hasMore = result.hasMore === true && page.length > 0;
                offset += page.length;
            }
            const eligible = projects.filter((project) => project.viewer_participates || project.viewer_can_manage);
            const selected = postProjectField.value;
            postProjectField.replaceChildren(new Option('Publicação geral', ''));
            eligible.forEach((project) => postProjectField.add(new Option(project.title, project.id)));
            if (eligible.some((project) => String(project.id) === selected)) postProjectField.value = selected;
        } catch {
            // Publicações gerais continuam disponíveis se a lista de projectos não carregar.
        }
    }
}

function ensureProjectPostOption(project) {
    if (!postProjectField || !project?.id || !project?.title) return;
    const id = String(project.id);
    if (![...postProjectField.options].some((option) => option.value === id)) {
        postProjectField.add(new Option(project.title, id));
    }
}

function resourceStatus(form, message, isError = false) {
    const status = form.querySelector('[data-resource-status]');
    if (status) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
        status.classList.toggle('is-success', !isError && Boolean(message));
    }
}

async function submitResourceForm(form, pathForData, successMessage, refresh = false) {
    const submit = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    if (submit) submit.disabled = true;
    resourceStatus(form, 'A enviar…');
    try {
        await window.ImpactaAPI.post(pathForData(values), values);
        form.reset();
        resourceStatus(form, '');
        showFeedNotice('Pedido enviado', successMessage, { durationMs: 2300 });
        if (refresh) await refreshFeedContent();
    } catch (error) {
        const message = friendlyError(error, 'Não foi possível enviar. Confirma a ligação e tenta novamente.');
        resourceStatus(form, '');
        showFeedNotice('Não foi possível enviar', message, { danger: true, durationMs: 3000 });
    } finally {
        if (submit) submit.disabled = false;
    }
}

openProjectDialogButton?.addEventListener('click', () => {
    resourceStatus(projectCreateForm, '');
    projectDialog?.showModal();
});
openCommunityDialogButton?.addEventListener('click', () => {
    resourceStatus(communityCreateForm, '');
    communityDialog?.showModal();
});
document.querySelectorAll('[data-close-resource-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
});
document.querySelectorAll('.resource-dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
});
document.querySelector('#project-chat-close')?.addEventListener('click', () => projectChatDialog?.close());
projectChatOlderButton?.addEventListener('click', () => {
    if (!firstProjectMessageId) return;
    projectChatOlderButton.disabled = true;
    void updateProjectChat({ older: true });
});
projectChatDialog?.addEventListener('click', (event) => {
    if (event.target === projectChatDialog) projectChatDialog.close();
});
projectChatDialog?.addEventListener('close', () => {
    if (projectChatPollingTimer) window.clearInterval(projectChatPollingTimer);
    projectChatPollingTimer = null;
    activeProjectChat = null;
});
projectChatMute?.addEventListener('click', async () => {
    if (!activeProjectChat || !currentUser) return;
    const projectId = activeProjectChat.id;
    const muted = activeProjectChat.muted !== true;
    projectChatMute.disabled = true;
    try {
        const result = await window.ImpactaAPI.put(
            `/projects/${encodeURIComponent(projectId)}/message-preferences`, { muted }
        );
        if (activeProjectChat?.id !== projectId) return;
        activeProjectChat.muted = result.muted === true;
        projectChatMute.textContent = activeProjectChat.muted ? 'Mostrar contagem' : 'Silenciar contagem';
        projectChatMute.setAttribute('aria-pressed', String(activeProjectChat.muted));
        await refreshEntityNotificationBadges();
    } catch (error) {
        if (projectChatFormStatus) projectChatFormStatus.textContent = friendlyError(error, 'Não foi possível actualizar as preferências.');
    } finally {
        projectChatMute.disabled = false;
    }
});
projectChatForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeProjectChat || !currentUser || !projectChatInput || !projectChatSend) return;
    const body = projectChatInput.value.trim();
    if (!body) { if (projectChatFormStatus) projectChatFormStatus.textContent = 'Escreve uma mensagem antes de enviar.'; return; }
    const projectId = activeProjectChat.id;
    projectChatSend.disabled = true;
    if (projectChatFormStatus) projectChatFormStatus.textContent = 'A enviar a mensagem…';
    try {
        const result = await window.ImpactaAPI.post(`/projects/${encodeURIComponent(projectId)}/messages`, { body });
        if (activeProjectChat?.id !== projectId) return;
        appendProjectChatMessage(result.item);
        if (projectChatMessages) projectChatMessages.scrollTop = projectChatMessages.scrollHeight;
        projectChatInput.value = '';
        if (projectChatFormStatus) projectChatFormStatus.textContent = '';
        await window.ImpactaAPI.put(`/projects/${encodeURIComponent(projectId)}/read-messages`, {}).catch(() => undefined);
        await refreshEntityNotificationBadges();
    } catch (error) {
        if (projectChatFormStatus) projectChatFormStatus.textContent = friendlyError(error, 'Não foi possível enviar a mensagem. Tenta novamente.');
    } finally {
        projectChatSend.disabled = false;
    }
});
document.querySelector('#community-chat-close')?.addEventListener('click', () => communityChatDialog?.close());
communityChatOlderButton?.addEventListener('click', () => {
    if (!firstCommunityMessageId) return;
    communityChatOlderButton.disabled = true;
    void updateCommunityChat({ older: true });
});
communityChatDialog?.addEventListener('click', (event) => {
    if (event.target === communityChatDialog) communityChatDialog.close();
});
communityChatDialog?.addEventListener('close', () => {
    if (communityChatPollingTimer) window.clearInterval(communityChatPollingTimer);
    communityChatPollingTimer = null;
    activeCommunityChat = null;
    clearCommunityChatAttachment();
});
async function setCommunityChatLock(durationMinutes) {
    if (!activeCommunityChat || !currentUser) return;
    if (communityChatLockButton) communityChatLockButton.disabled = true;
    if (communityChatUnlockButton) communityChatUnlockButton.disabled = true;
    if (communityChatFormStatus) communityChatFormStatus.textContent = 'A atualizar as permissões da conversa…';
    try {
        await window.ImpactaAPI.post(
            `/communities/${encodeURIComponent(activeCommunityChat.id)}/chat-lock`,
            { durationMinutes }
        );
        await updateCommunityChat({ refresh: true });
        if (communityChatFormStatus) {
            communityChatFormStatus.textContent = durationMinutes === 0
                ? 'O envio de mensagens foi reaberto.'
                : 'O envio dos membros foi pausado temporariamente.';
        }
    } catch (error) {
        if (communityChatFormStatus) communityChatFormStatus.textContent = friendlyError(error, 'Não foi possível atualizar a conversa.');
    } finally {
        if (communityChatLockButton) communityChatLockButton.disabled = false;
        if (communityChatUnlockButton) communityChatUnlockButton.disabled = false;
    }
}
communityChatLockButton?.addEventListener('click', () => {
    setCommunityChatLock(Number(communityChatLockDuration?.value) || 60);
});
communityChatUnlockButton?.addEventListener('click', () => setCommunityChatLock(0));
communityChatFile?.addEventListener('change', () => {
    const file = communityChatFile.files?.[0];
    if (!communityChatAttachment) return;
    communityChatAttachment.replaceChildren();
    communityChatAttachment.hidden = !file;
    if (!file) return;
    const detail = element('span', '', `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB antes da otimização`);
    const remove = element('button', 'community-chat-attachment-remove', 'Remover anexo');
    remove.type = 'button';
    remove.addEventListener('click', clearCommunityChatAttachment);
    communityChatAttachment.append(detail, remove);
});
communityChatForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeCommunityChat || !currentUser) return;
    const body = communityChatInput?.value.trim() || '';
    const file = communityChatFile?.files?.[0] || null;
    if (!body && !file) {
        if (communityChatFormStatus) communityChatFormStatus.textContent = 'Escreve uma mensagem ou escolhe uma imagem/vídeo.';
        return;
    }
    communityChatSend.disabled = true;
    if (communityChatFormStatus) communityChatFormStatus.textContent = file ? 'A otimizar e enviar o anexo…' : 'A enviar a mensagem…';
    let uploadedMedia = null;
    const communityId = activeCommunityChat.id;
    try {
        if (file) {
            uploadedMedia = await window.ImpactaAPI.upload(
                `/communities/${encodeURIComponent(communityId)}/media`, file
            );
        }
        const result = await window.ImpactaAPI.post(
            `/communities/${encodeURIComponent(communityId)}/messages`,
            { body, mediaId: uploadedMedia?.id }
        );
        appendCommunityChatMessage(result.item);
        if (communityChatMessages) communityChatMessages.scrollTop = communityChatMessages.scrollHeight;
        if (communityChatInput) communityChatInput.value = '';
        clearCommunityChatAttachment();
        if (communityChatFormStatus) communityChatFormStatus.textContent = '';
        showFeedNotice(
            result.item?.is_pending_review ? 'Anexo em revisão' : 'Mensagem enviada',
            result.item?.is_pending_review
                ? 'A mensagem foi enviada. O anexo ficará visível ao grupo depois da revisão da equipa.'
                : 'A comunidade já pode ver a tua mensagem.',
            { durationMs: result.item?.is_pending_review ? 2600 : 1800 }
        );
    } catch (error) {
        if (uploadedMedia?.id) {
            await window.ImpactaAPI.delete(
                `/communities/${encodeURIComponent(communityId)}/media/${encodeURIComponent(uploadedMedia.id)}`
            ).catch(() => undefined);
        }
        if (communityChatFormStatus) communityChatFormStatus.textContent = '';
        showFeedNotice('Não foi possível enviar', friendlyError(error, 'Tenta novamente.'), { danger: true, durationMs: 3000 });
    } finally {
        communityChatSend.disabled = false;
    }
});
communityCreateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitResourceForm(communityCreateForm, () => '/communities', 'Proposta recebida. A equipa irá revê-la antes de a comunidade ficar pública.');
});
projectCreateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitResourceForm(projectCreateForm, () => '/projects', 'Projeto enviado para revisão. Vais receber uma notificação quando houver uma decisão.');
});
challengeCreateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitResourceForm(
        challengeCreateForm,
        (values) => `/projects/${encodeURIComponent(values.projectId)}/challenges`,
        'Desafio publicado. Já pode receber participações.',
        true
    );
});

document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const brand = event.target.closest('a.brand');
    if (!brand) return;
    event.preventDefault();
    window.location.reload();
});

searchField?.addEventListener('input', () => applyFilterAndSort({ resetVisible: true }));
sortField?.addEventListener('change', () => applyFilterAndSort());
categoryFilter?.addEventListener('change', () => { updateFeedSearchScope(); void loadPosts(categoryFilter.value); });
resourceListingConfigs.forEach((listing) => {
    listing.filter?.addEventListener('change', () => { void loadResourceListing(listing); });
    let locationTimer = null;
    listing.locationFilter?.addEventListener('input', () => {
        if (locationTimer !== null) window.clearTimeout(locationTimer);
        locationTimer = window.setTimeout(() => {
            locationTimer = null;
            void loadResourceListing(listing);
        }, 300);
    });
});
shareIdeaLinks.forEach((link) => {
    link.addEventListener('click', () => {
        window.setTimeout(() => {
            const focusTarget = composerInput && !composerInput.disabled
                ? composerInput
                : composer?.querySelector('.composer-login');
            focusTarget?.focus({ preventScroll: true });
        }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
    });
});
postsMoreButton?.addEventListener('click', () => { void loadMorePosts(); });
composer?.addEventListener('submit', submitPost);
const getComposerMentionIds = attachMentionPicker(composerInput);
composerInput?.addEventListener('input', updateCharacterCount);
updateCharacterCount();

async function startFeed() {
    await Promise.all([
        loadCurrentAccount(),
        loadPostCategories(),
        loadResourceCatalogs()
    ]);
    await Promise.all([
        loadPosts(),
        loadResourceLists()
    ]);
    if (currentUser) {
        await refreshEntityNotificationBadges();
        window.setInterval(() => {
            if (document.visibilityState === 'visible') void refreshEntityNotificationBadges();
        }, 30_000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void refreshEntityNotificationBadges();
        });
    }
    if (['#projetos', '#comunidades'].includes(window.location.hash)) {
        window.setTimeout(() => focusResourceProposal(window.location.hash), 80);
    }
    if (currentUser) {
        await loadNotifications();
        if (window.location.hash === '#notifications' && notificationPanel && notificationsToggle) {
            notificationPanel.hidden = false;
            notificationsToggle.setAttribute('aria-expanded', 'true');
            void loadNotifications();
        }
        window.setInterval(() => {
            if (document.visibilityState === 'visible') void loadNotifications();
        }, 60_000);
    }
    if (new URLSearchParams(window.location.search).get('filters') === '1') {
        setFeedSearchFiltersOpen(true);
    }
}

function focusResourceProposal(sectionHash) {
    const targets = {
        '#projetos': currentUser ? openProjectDialogButton : projectLoginLink,
        '#comunidades': currentUser ? openCommunityDialogButton : communityLoginLink
    };
    const target = targets[sectionHash];
    if (!target || target.hidden) return;
    const section = document.querySelector(sectionHash);
    if (!section) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
    target.classList.add('is-primary-action-focus');
    window.clearTimeout(target._actionFocusTimer);
    target._actionFocusTimer = window.setTimeout(() => {
        target.classList.remove('is-primary-action-focus');
    }, 2800);
}

void startFeed();

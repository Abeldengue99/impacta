const statusBox = document.querySelector('#profile-status');
const editor = document.querySelector('#profile-editor');
const publicCard = document.querySelector('#public-profile');
const profileForm = document.querySelector('#profile-form');
const profileFeedback = document.querySelector('#profile-feedback');
const accountVerificationForm = document.querySelector('#account-verification-form');
const accountVerificationStatus = document.querySelector('#account-verification-status');
const accountVerificationProof = document.querySelector('#account-verification-proof');
const accountVerificationCode = document.querySelector('#account-verification-code');
const accountVerificationExpiry = document.querySelector('#account-verification-expiry');
const accountVerificationCopy = document.querySelector('#account-verification-copy');
const accountVerificationEmailLink = document.querySelector('#account-verification-email-link');
const accountVerificationRenew = document.querySelector('#account-verification-renew');
const profileMfaStatus = document.querySelector('#profile-mfa-status');
const profileMfaStartForm = document.querySelector('#profile-mfa-start-form');
const profileMfaConfirmForm = document.querySelector('#profile-mfa-confirm-form');
const profileMfaRecoveryPanel = document.querySelector('#profile-mfa-recovery');
let pendingMfaSetupChallenge = '';
const postsSection = document.querySelector('#profile-posts-section');
const projectsSection = document.querySelector('#profile-projects-section');
const projectsStatus = document.querySelector('#profile-projects-status');
const projectsList = document.querySelector('#profile-projects-list');
const connectionsSection = document.querySelector('#profile-connections-section');
const communitiesSection = document.querySelector('#profile-communities-section');
const communitiesStatus = document.querySelector('#profile-communities-status');
const communitiesList = document.querySelector('#profile-communities-list');
const projectEditDialog = document.querySelector('#profile-project-edit-dialog');
const projectEditForm = document.querySelector('#profile-project-edit-form');
const projectEditFeedback = document.querySelector('#profile-project-edit-feedback');
const projectEditSave = document.querySelector('#profile-project-edit-save');
const postsStatus = document.querySelector('#profile-posts-status');
const postsList = document.querySelector('#profile-posts-list');
const postsMore = document.querySelector('#profile-posts-more');
const profileTabs = document.querySelector('#profile-tabs');
const profileContentGrid = document.querySelector('.profile-content-grid');
const profileSideColumn = document.querySelector('.profile-side-column');
const connectionsCount = document.querySelector('#profile-connections-count');
const mediaDialog = document.querySelector('#profile-media-dialog');
const mediaStage = document.querySelector('#profile-media-stage');
const mediaCounter = document.querySelector('#profile-media-counter');
const mediaPrevious = document.querySelector('#profile-media-previous');
const mediaNext = document.querySelector('#profile-media-next');
const mediaClose = document.querySelector('#profile-media-close');

function showProfileNotice(title, message, { danger = false, durationMs = 2200 } = {}) {
    if (window.ImpactaModal?.notice) {
        void window.ImpactaModal.notice({ title, message, danger, durationMs });
        return;
    }
    if (profileFeedback) profileFeedback.textContent = message;
}
const avatarBox = document.querySelector('#profile-avatar');
const publicAvatar = document.querySelector('#public-avatar');
const profileCover = document.querySelector('#profile-cover');
const profileCoverImage = document.querySelector('#profile-cover-image');
const profileCoverEmpty = document.querySelector('#profile-cover-empty');
const profileCoverIdentity = document.querySelector('#profile-cover-identity');
const profileCoverAvatar = document.querySelector('#profile-cover-avatar');
const profileCoverName = document.querySelector('#profile-cover-name');
const profileCoverHeadline = document.querySelector('#profile-cover-headline');
const profileCoverLocation = document.querySelector('#profile-cover-location');
const profileCoverControls = document.querySelector('#profile-cover-controls');
const coverFile = document.querySelector('#cover-file');
const coverFeedback = document.querySelector('#cover-feedback');
const chooseCover = document.querySelector('#choose-cover');
const removeCover = document.querySelector('#remove-cover');
const impactationPanel = document.querySelector('#profile-impactation');
const impactationActions = document.querySelector('#profile-impactation-actions');
const impactationStatus = document.querySelector('#profile-impactation-status');
const publicImpactationCount = document.querySelector('#public-impactation-count');
const myImpactationsStatus = document.querySelector('#my-impactations-status');
const myImpactationsItems = document.querySelector('#my-impactations-items');
const avatarFile = document.querySelector('#avatar-file');
const avatarFeedback = document.querySelector('#avatar-feedback');
const chooseAvatar = document.querySelector('#choose-avatar');
const removeAvatar = document.querySelector('#remove-avatar');
const customImpactAreaWrap = document.querySelector('#custom-impact-area');
const customImpactAreaInput = document.querySelector('#custom-impact-area-input');
const profileId = new URLSearchParams(window.location.search).get('id');
const profileDocumentSlots = [...document.querySelectorAll('[data-profile-document]')];
let currentAvatarUrl = null;
let currentCoverUrl = null;
let currentProfileData = null;
let postsCursor = null;
let postsLoading = false;
let postsLoaded = false;
let projectsLoading = false;
let projectsLoaded = false;
let communitiesLoading = false;
let communitiesLoaded = false;
let connectionsLoading = false;
let profilePostTextSequence = 0;
let connectionsLoaded = false;
let activeProfileMedia = [];
let activeProfileMediaIndex = 0;
let projectImpactAreas = null;

function setProfileTabs(items) {
    if (!profileTabs) return;
    profileTabs.replaceChildren(...items.map(([label, target], index) => {
        const link = document.createElement('a');
        link.href = target;
        link.id = `profile-tab-${target.slice(1)}`;
        link.setAttribute('role', 'tab');
        link.setAttribute('aria-controls', target.slice(1));
        link.setAttribute('aria-selected', 'false');
        link.tabIndex = index === 0 ? 0 : -1;
        const panel = document.getElementById(target.slice(1));
        if (panel) {
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', link.id);
            panel.tabIndex = -1;
        }
        link.textContent = label;
        link.addEventListener('click', (event) => {
            event.preventDefault();
            activateProfileView(target.slice(1), true);
        });
        link.addEventListener('keydown', (event) => {
            const tabs = [...profileTabs.querySelectorAll('[role="tab"]')];
            const currentIndex = tabs.indexOf(link);
            const nextIndex = event.key === 'ArrowRight'
                ? (currentIndex + 1) % tabs.length
                : event.key === 'ArrowLeft'
                    ? (currentIndex - 1 + tabs.length) % tabs.length
                    : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                            ? tabs.length - 1
                            : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            tabs[nextIndex].focus();
            tabs[nextIndex].click();
        });
        return link;
    }));
    profileTabs.hidden = false;
    const hashTarget = window.location.hash.slice(1);
    const initialTarget = items.some(([, target]) => target.slice(1) === hashTarget)
        ? hashTarget
        : items[0]?.[1].slice(1);
    if (initialTarget) activateProfileView(initialTarget, false);
}

function activateProfileView(targetId, scrollToView = false) {
    const sections = [editor, projectsSection, publicCard, postsSection, connectionsSection, communitiesSection]
        .filter(Boolean);
    const target = sections.find((section) => section.id === targetId);
    if (!target) return;
    sections.forEach((section) => { section.hidden = section !== target; });
    const usesContentGrid = target === publicCard || target === postsSection;
    if (profileContentGrid) profileContentGrid.hidden = !usesContentGrid;
    if (profileSideColumn) profileSideColumn.hidden = target !== publicCard;
    for (const tab of profileTabs?.querySelectorAll('[role="tab"]') || []) {
        const selected = tab.getAttribute('aria-controls') === targetId;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    if (targetId === projectsSection?.id && !projectsLoaded && !projectsLoading) void loadProfileProjects();
    if (targetId === postsSection?.id && !postsLoaded) void loadProfilePosts();
    if (targetId === connectionsSection?.id && !connectionsLoaded && !connectionsLoading) void loadProfileImpactations();
    if (targetId === communitiesSection?.id && !communitiesLoaded && !communitiesLoading) void loadProfileCommunities();
    if (scrollToView) {
        const nextUrl = new URL(window.location.href);
        nextUrl.hash = targetId;
        window.history.replaceState(null, '', nextUrl);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => part[0]).join('').toLocaleUpperCase('pt') || 'I';
}

function officialAccountBadge() {
    const badge = document.createElement('span');
    badge.className = 'official-account-badge';
    badge.textContent = '✓';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'Conta oficial da plataforma IMPACTA');
    badge.title = 'Conta oficial da plataforma IMPACTA';
    return badge;
}

function identityVerifiedBadge() {
    const badge = document.createElement('span');
    badge.className = 'identity-verified-badge';
    badge.textContent = '✓';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', 'Canal oficial confirmado pelo IMPACTA');
    badge.title = 'Canal oficial confirmado pelo IMPACTA';
    return badge;
}

function setAvatar(node, url, name) {
    if (!node) return;
    node.replaceChildren();
    node.textContent = initials(name);
    if (!url) return;
    const image = document.createElement('img');
    image.crossOrigin = 'use-credentials';
    image.src = window.ImpactaAPI.assetUrl(url);
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.remove(); node.textContent = initials(name); }, { once: true });
    node.replaceChildren(image);
}

function setProfileCover(url, canEdit = false) {
    if (!profileCover || !profileCoverImage) return;
    currentCoverUrl = url || null;
    profileCover.hidden = false;
    profileCover.classList.toggle('has-image', Boolean(currentCoverUrl));
    profileCover.classList.toggle('is-empty-public', !canEdit && !currentCoverUrl);
    profileCover.classList.toggle('is-owner', canEdit);
    profileCoverImage.hidden = !currentCoverUrl;
    profileCoverImage.crossOrigin = 'use-credentials';
    profileCoverEmpty.hidden = Boolean(currentCoverUrl) || !canEdit;
    profileCoverControls.hidden = !canEdit;
    if (currentCoverUrl) profileCoverImage.src = currentCoverUrl.startsWith('blob:')
        ? currentCoverUrl
        : window.ImpactaAPI.assetUrl(currentCoverUrl);
    else profileCoverImage.removeAttribute('src');
    removeCover.hidden = !currentCoverUrl;
}

function setProfileCoverIdentity(profile) {
    if (!profileCoverIdentity || !profile) return;
    profileCoverIdentity.hidden = false;
    profileCoverName.textContent = profile.displayName || 'Perfil IMPACTA';
    profileCoverHeadline.textContent = profile.headline || profile.impactArea || '';
    profileCoverHeadline.hidden = !profileCoverHeadline.textContent;
    profileCoverLocation.textContent = profile.location || '';
    profileCoverLocation.hidden = !profile.location;
    setAvatar(profileCoverAvatar, profile.avatarUrl, profile.displayName);
}

function setCoverFeedback(message, isError = false) {
    if (!coverFeedback) return;
    coverFeedback.textContent = message;
    coverFeedback.classList.toggle('is-error', isError);
}

function renderMentionText(node, text, mentions = []) {
    const source = String(text || '');
    const lower = source.toLocaleLowerCase('pt');
    const found = [];
    for (const mention of (Array.isArray(mentions) ? mentions : [])
        .filter((item) => item?.display_name && item?.user_id)
        .sort((left, right) => String(right.display_name).length - String(left.display_name).length)) {
        const token = `@${mention.display_name}`;
        const search = token.toLocaleLowerCase('pt');
        let from = 0;
        while (from < lower.length) {
            const start = lower.indexOf(search, from);
            if (start < 0) break;
            const end = start + token.length;
            const previous = start ? source[start - 1] : '';
            const next = source[end] || '';
            if ((!previous || !/[\p{L}\p{N}_]/u.test(previous))
                && (!next || !/[\p{L}\p{N}_]/u.test(next))
                && !found.some((item) => start < item.end && end > item.start)) {
                found.push({ start, end, mention });
            }
            from = start + search.length;
        }
    }
    found.sort((left, right) => left.start - right.start);
    node.replaceChildren();
    let cursor = 0;
    for (const item of found) {
        if (item.start < cursor) continue;
        node.append(document.createTextNode(source.slice(cursor, item.start)));
        const link = document.createElement('a');
        link.className = 'mention-token';
        link.href = `profile.html?id=${encodeURIComponent(item.mention.user_id)}`;
        link.textContent = source.slice(item.start, item.end);
        node.append(link);
        cursor = item.end;
    }
    node.append(document.createTextNode(source.slice(cursor)));
}

function showProfileMedia(index) {
    if (!mediaDialog || !mediaStage || !activeProfileMedia.length) return;
    activeProfileMediaIndex = (index + activeProfileMedia.length) % activeProfileMedia.length;
    const media = activeProfileMedia[activeProfileMediaIndex];
    mediaStage.replaceChildren();
    const viewer = document.createElement(media.type === 'video' ? 'video' : 'img');
    viewer.className = 'profile-media-viewer';
    viewer.crossOrigin = 'use-credentials';
    viewer.src = media.url;
    if (viewer instanceof HTMLVideoElement) {
        viewer.controls = true;
        viewer.playsInline = true;
        viewer.preload = 'metadata';
        viewer.setAttribute('aria-label', 'Vídeo da publicação');
    } else {
        viewer.alt = `Fotografia ${activeProfileMediaIndex + 1} da publicação`;
        viewer.decoding = 'async';
    }
    mediaStage.append(viewer);
    mediaCounter.textContent = `${activeProfileMediaIndex + 1} / ${activeProfileMedia.length}`;
    mediaPrevious.disabled = activeProfileMedia.length < 2;
    mediaNext.disabled = activeProfileMedia.length < 2;
}

function openProfileMedia(items, index) {
    activeProfileMedia = items;
    showProfileMedia(index);
    mediaDialog.showModal();
}

mediaPrevious?.addEventListener('click', () => showProfileMedia(activeProfileMediaIndex - 1));
mediaNext?.addEventListener('click', () => showProfileMedia(activeProfileMediaIndex + 1));
mediaClose?.addEventListener('click', () => mediaDialog?.close());
mediaDialog?.addEventListener('click', (event) => {
    if (event.target === mediaDialog) mediaDialog.close();
});
mediaDialog?.addEventListener('close', () => {
    mediaStage?.replaceChildren();
    activeProfileMedia = [];
    activeProfileMediaIndex = 0;
});
document.addEventListener('keydown', (event) => {
    if (!mediaDialog?.open || activeProfileMedia.length < 2) return;
    if (event.key === 'ArrowRight') showProfileMedia(activeProfileMediaIndex + 1);
    if (event.key === 'ArrowLeft') showProfileMedia(activeProfileMediaIndex - 1);
});

function showError(error) {
    const messages = {
        invalid_verification_request: 'Confirma o tipo de perfil, a ligação HTTPS e o contexto do pedido.',
        public_profile_required: 'Torna o teu perfil público e guarda as alterações antes de pedires a verificação.',
        account_already_verified: 'Este perfil já tem o canal oficial confirmado.',
        mfa_password_invalid: 'A palavra-passe não está correta. Confirma-a e tenta novamente.',
        mfa_already_enabled: 'A verificação em dois passos já está ativa nesta conta. Atualiza o perfil.',
        mfa_configuration_unavailable: 'A segurança em dois passos ainda não está preparada no servidor. Contacta a equipa IMPACTA.',
        mfa_challenge_invalid: 'Esta configuração expirou. Recomeça para gerar uma nova chave.',
        mfa_invalid_code: 'O código não é válido. Confirma o relógio do telefone e tenta novamente.',
        too_many_requests: 'Foram feitas muitas tentativas. Aguarda alguns minutos e tenta novamente.',
        verification_request_pending: 'Já existe um pedido de verificação em análise.',
        verification_challenge_not_renewable: 'O código ainda está válido ou o pedido já foi analisado.',
        verification_proof_confirmation_required: 'Confirma que recebeste o código em privado a partir de um contacto associado ao canal oficial antes de aprovar.',
        verification_proof_not_active: 'O código expirou ou já foi utilizado. Pede à pessoa que gere um novo código.',
        verification_request_limit: 'Atingiste o limite de pedidos de verificação nos últimos 30 dias.',
        authentication_required: 'A tua sessão terminou. Entra novamente para editar o perfil.',
        csrf_validation_failed: 'A sessão de segurança expirou. Atualiza a página e tenta novamente.',
        profile_not_found: 'Este perfil não está disponível ou foi definido como privado.',
        cannot_impact_self: 'Não podes enviar um pedido ao teu próprio perfil.',
        impactation_request_not_found: 'Este pedido de impactação já não está disponível.',
        impactation_request_already_handled: 'Este pedido já recebeu uma resposta.',
        impactation_rate_limit: 'Atingiste o limite de pedidos de impactação por hora. Tenta mais tarde.',
        invalid_profile: 'Confirma o nome e os limites dos campos do perfil.',
        invalid_website_url: 'Indica um endereço de site válido que comece por https://.',
        invalid_impact_area: 'A área escolhida já não está disponível. Seleciona outra.',
        invalid_project: 'Confirma o título, a descrição, as datas e os dados de localização.',
        project_not_found: 'Este projecto já não está disponível para edição.',
        project_edit_rate_limit: 'Atingiste o limite de alterações a projectos por hora. Tenta mais tarde.',
        invalid_skills: 'Usa até 12 competências, cada uma com no máximo 40 caracteres.',
        unsupported_avatar_type: 'Escolhe uma imagem PNG ou JPEG.',
        avatar_too_large: 'A fotografia tem de ter menos de 2 MB.',
        invalid_avatar_image: 'O ficheiro não é uma imagem válida ou excede 4096 × 4096 px.',
        unsupported_cover_type: 'Escolhe uma imagem PNG ou JPEG.',
        cover_image_too_large: 'A imagem de capa não pode exceder 10 MB.',
        invalid_cover_image: 'Escolhe uma imagem válida dentro dos limites de dimensão.',
        unsupported_profile_document_type: 'Escolhe um ficheiro PDF.',
        invalid_profile_document_type: 'Este tipo de documento não é válido.',
        invalid_profile_document: 'O ficheiro não é um PDF válido.',
        profile_document_too_large: 'O PDF tem de ter até 10 MB.',
        profile_documents_not_ready: 'O armazenamento de CV e portef\u00f3lio ainda n\u00e3o est\u00e1 preparado na plataforma.',
        profile_document_storage_unavailable: 'N\u00e3o foi poss\u00edvel guardar o ficheiro. O armazenamento da plataforma n\u00e3o est\u00e1 dispon\u00edvel.',
        api_timeout: 'A plataforma demorou demasiado tempo a responder. Tenta novamente.',
        api_unavailable: 'Não foi possível ligar à plataforma. Tenta novamente.'
    };
    if (messages[error?.code]) return messages[error.code];
    if (error?.requestId) return `A plataforma n\u00e3o conseguiu concluir o pedido. Refer\u00eancia: ${error.requestId}.`;
    return messages[error?.code] || 'Não foi possível concluir o pedido. Tenta novamente.';
}

function setStatus(message, isError = false) {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.classList.toggle('is-error', isError);
    statusBox.hidden = !message;
}

function setAvatarFeedback(message, isError = false) {
    if (!avatarFeedback) return;
    avatarFeedback.textContent = message;
    avatarFeedback.classList.toggle('is-error', isError);
}

function setProfileDocumentStatus(slot, message, isError = false) {
    const status = slot.querySelector('[data-document-status]');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
}

function renderProfileDocumentSlots(documents = {}) {
    for (const slot of profileDocumentSlots) {
        const type = slot.dataset.profileDocument;
        const documentData = documents?.[type];
        const open = slot.querySelector('[data-document-open]');
        const upload = slot.querySelector('[data-document-upload]');
        const remove = slot.querySelector('[data-document-remove]');
        if (open) {
            open.href = documentData?.url ? window.ImpactaAPI.assetUrl(documentData.url) : '#';
            open.hidden = !documentData?.url;
        }
        if (upload) upload.textContent = documentData
            ? `Substituir o meu ${type === 'cv' ? 'CV' : 'portef\u00f3lio'}`
            : `Anexar o meu ${type === 'cv' ? 'CV' : 'portef\u00f3lio'}`;
        if (remove) remove.textContent = `Remover ${type === 'cv' ? 'CV' : 'portef\u00f3lio'}`;
        if (remove) remove.hidden = !documentData;
        setProfileDocumentStatus(slot, documentData ? 'PDF anexado ao teu perfil.' : 'Nenhum ficheiro anexado.');
    }
}

function renderPublicProfileDocuments(documents = {}) {
    const container = document.querySelector('#public-profile-documents');
    if (!container) return;
    const entries = [
        ['cv', 'Descarregar CV'],
        ['portfolio', 'Descarregar portefólio']
    ].filter(([type]) => documents?.[type]?.url);
    container.replaceChildren(...entries.map(([type, label]) => {
        const link = document.createElement('a');
        link.className = 'public-profile-document-link';
        link.href = window.ImpactaAPI.assetUrl(documents[type].url);
        link.textContent = label;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
    }));
    container.hidden = entries.length === 0;
}

function appendDetail(list, label, value) {
    if (!value) return;
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    wrapper.append(term, description);
    list.append(wrapper);
}

function renderProfilePost(post) {
    const card = document.createElement('article');
    card.className = 'profile-post panel';
    card.id = 'profile-post-' + encodeURIComponent(post.id);
    const header = document.createElement('header');
    header.className = 'profile-post-header';
    const postAvatar = document.createElement('div');
    postAvatar.className = 'profile-post-avatar avatar';
    const publicName = document.querySelector('#public-name');
    const postOwner = profileId ? publicName?.firstChild?.textContent?.trim()
        : profileForm.elements.namedItem('displayName').value;
    const sourceAvatar = profileId ? publicAvatar : avatarBox;
    setAvatar(postAvatar, null, postOwner);
    const sourceImage = sourceAvatar.querySelector('img');
    if (sourceImage) {
        const avatarImage = sourceImage.cloneNode(false);
        avatarImage.alt = '';
        postAvatar.replaceChildren(avatarImage);
    }
    const author = document.createElement('div');
    author.className = 'profile-post-author';
    const authorName = document.createElement('strong');
    authorName.textContent = postOwner || 'Membro da comunidade';
    if (profileId && publicName?.querySelector('.official-account-badge')) authorName.append(officialAccountBadge());
    if (profileId && publicName?.querySelector('.identity-verified-badge')) authorName.append(identityVerifiedBadge());
    const dateLabel = document.createElement('span');
    dateLabel.className = 'profile-post-meta';
    const date = new Date(post.created_at);
    dateLabel.textContent = [post.community || '', post.project ? 'Actualização de ' + post.project : '',
        post.edited ? 'Editado' : '', Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-AO')].filter(Boolean).join(' · ');
    author.append(authorName, dateLabel);
    header.append(postAvatar, author);

    const body = document.createElement('p');
    body.className = 'profile-post-body';
    renderMentionText(body, post.body, post.mentions);
    const postTextLength = Array.from(String(post.body || '')).length;
    let toggleBody = null;
    if (postTextLength > 150) {
        body.id = 'profile-post-body-' + (++profilePostTextSequence);
        body.classList.add('is-collapsed');
        toggleBody = document.createElement('button');
        toggleBody.type = 'button';
        toggleBody.className = 'profile-post-body-toggle';
        toggleBody.setAttribute('aria-controls', body.id);
        toggleBody.setAttribute('aria-expanded', 'false');
        toggleBody.textContent = 'Ver mais';
        toggleBody.addEventListener('click', () => {
            const expanded = toggleBody.getAttribute('aria-expanded') !== 'true';
            body.classList.toggle('is-collapsed', !expanded);
            toggleBody.setAttribute('aria-expanded', String(expanded));
            toggleBody.textContent = expanded ? 'Ver menos' : 'Ver mais';
        });
    }
    card.append(header);
    const categoryName = post.custom_category || post.category;
    if (categoryName) {
        const category = document.createElement('span');
        category.className = 'profile-post-category';
        category.textContent = categoryName;
        card.append(category);
    }
    card.append(body);
    if (toggleBody) card.append(toggleBody);

    const mediaList = Array.isArray(post.media) ? post.media : [];
    const usableMedia = mediaList.filter((media) => media?.url && ['image', 'video'].includes(media.media_type));
    if (usableMedia.length) {
        const gallery = document.createElement('div');
        gallery.className = 'profile-post-media';
        gallery.setAttribute('role', 'group');
        gallery.setAttribute('aria-label', usableMedia.length + ' itens de multimédia na publicação');
        const modalItems = usableMedia.map((media) => ({
            type: media.media_type,
            url: window.ImpactaAPI.assetUrl(media.url)
        }));
        usableMedia.slice(0, 4).forEach((media, index) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'profile-media-tile';
            tile.setAttribute('aria-label', 'Abrir ' + (media.media_type === 'video' ? 'vídeo' : 'fotografia')
                + ' ' + (index + 1) + ' de ' + usableMedia.length);
            if (media.media_type === 'video') {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.playsInline = true;
                video.muted = true;
                video.crossOrigin = 'use-credentials';
                video.src = modalItems[index].url;
                video.setAttribute('aria-hidden', 'true');
                const playMark = document.createElement('span');
                playMark.className = 'profile-video-mark';
                playMark.setAttribute('aria-hidden', 'true');
                playMark.textContent = '▶';
                tile.append(video, playMark);
            } else {
                const image = document.createElement('img');
                image.crossOrigin = 'use-credentials';
                image.src = modalItems[index].url;
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                tile.append(image);
            }
            if (index === 3 && usableMedia.length > 4) {
                const more = document.createElement('span');
                more.className = 'profile-media-more';
                more.setAttribute('aria-hidden', 'true');
                more.textContent = '+' + (usableMedia.length - 4);
                tile.append(more);
                tile.setAttribute('aria-label', 'Abrir galeria com ' + usableMedia.length + ' elementos');
            }
            tile.addEventListener('click', () => openProfileMedia(modalItems, index));
            gallery.append(tile);
        });
        gallery.classList.add('media-count-' + Math.min(usableMedia.length, 4));
        card.append(gallery);
    }

    const actionStatus = document.createElement('p');
    actionStatus.className = 'profile-post-action-status';
    actionStatus.setAttribute('role', 'status');
    actionStatus.setAttribute('aria-live', 'polite');
    const showActionError = (error, fallback) => {
        actionStatus.replaceChildren();
        const message = document.createElement('span');
        message.textContent = showError(error) || fallback;
        actionStatus.append(message);
        if (error?.code === 'authentication_required') {
            const login = document.createElement('a');
            login.href = 'index.html#login';
            login.textContent = ' Entrar';
            actionStatus.append(login);
        }
    };
    const actions = document.createElement('div');
    actions.className = 'profile-post-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Acções da publicação');

    const supportButton = document.createElement('button');
    supportButton.type = 'button';
    supportButton.className = 'profile-post-action';
    supportButton.setAttribute('aria-pressed', String(post.supported_by_viewer === true));
    let supportCount = Math.max(0, Number(post.support_count) || 0);
    const updateSupport = () => {
        const supported = supportButton.getAttribute('aria-pressed') === 'true';
        supportButton.textContent = (supported ? 'Apoiado' : 'Apoiar') + ' · ' + supportCount.toLocaleString('pt-AO');
        supportButton.setAttribute('aria-label', (supported ? 'Retirar apoio' : 'Apoiar publicação')
            + ', ' + supportCount.toLocaleString('pt-AO') + ' apoios');
        supportButton.classList.toggle('is-active', supported);
    };
    updateSupport();
    supportButton.addEventListener('click', async () => {
        supportButton.disabled = true;
        actionStatus.textContent = '';
        try {
            const result = await window.ImpactaAPI.post('/feed/posts/' + encodeURIComponent(post.id) + '/support', {});
            post.supported_by_viewer = result.supported === true;
            supportCount = Math.max(0, Number(result.supportCount) || 0);
            supportButton.setAttribute('aria-pressed', String(post.supported_by_viewer));
            updateSupport();
        } catch (error) {
            showActionError(error, 'Não foi possível actualizar o apoio.');
        } finally {
            supportButton.disabled = false;
        }
    });

    const commentsButton = document.createElement('button');
    commentsButton.type = 'button';
    commentsButton.className = 'profile-post-action';
    let commentCount = Math.max(0, Number(post.comment_count) || 0);
    commentsButton.textContent = 'Comentar · ' + commentCount.toLocaleString('pt-AO');
    commentsButton.setAttribute('aria-expanded', 'false');
    const commentsArea = document.createElement('section');
    commentsArea.className = 'profile-post-comments';
    commentsArea.hidden = true;
    commentsArea.setAttribute('aria-label', 'Comentários da publicação');
    const commentsList = document.createElement('div');
    commentsList.className = 'profile-post-comments-list';
    const commentsStatus = document.createElement('p');
    commentsStatus.className = 'profile-post-action-status';
    commentsStatus.setAttribute('role', 'status');
    commentsStatus.setAttribute('aria-live', 'polite');
    const commentForm = document.createElement('form');
    commentForm.className = 'profile-post-comment-form';
    const commentInput = document.createElement('textarea');
    commentInput.maxLength = 1000;
    commentInput.rows = 2;
    commentInput.required = true;
    commentInput.setAttribute('aria-label', 'Escreve um comentário');
    commentInput.placeholder = 'Partilha uma resposta respeitosa…';
    const commentSubmit = document.createElement('button');
    commentSubmit.className = 'button button-small';
    commentSubmit.type = 'submit';
    commentSubmit.textContent = 'Comentar';
    commentForm.append(commentInput, commentSubmit);
    commentsArea.append(commentsList, commentsStatus, commentForm);
    let commentsLoaded = false;
    const renderComment = (comment) => {
        const row = document.createElement('article');
        row.className = 'profile-post-comment';
        const heading = document.createElement('div');
        heading.className = 'profile-post-comment-heading';
        const name = document.createElement('strong');
        name.textContent = comment.author || 'Membro da comunidade';
        const date = new Date(comment.created_at);
        const time = document.createElement('time');
        if (!Number.isNaN(date.getTime())) {
            time.dateTime = date.toISOString();
            time.textContent = date.toLocaleString('pt-AO');
        }
        heading.append(name, time);
        const copy = document.createElement('p');
        renderMentionText(copy, comment.body, comment.mentions);
        row.append(heading, copy);
        return row;
    };
    const loadComments = async () => {
        commentsStatus.textContent = 'A carregar comentários…';
        try {
            const items = await window.ImpactaAPI.get('/feed/posts/' + encodeURIComponent(post.id) + '/comments');
            commentsList.replaceChildren(...items.map(renderComment));
            commentsStatus.textContent = items.length ? '' : 'Ainda não há comentários. Sê a primeira pessoa a participar.';
            commentsLoaded = true;
        } catch (error) {
            commentsStatus.replaceChildren();
            const message = document.createElement('span');
            message.textContent = showError(error) || 'Não foi possível carregar os comentários.';
            commentsStatus.append(message);
            if (error?.code === 'authentication_required') {
                const login = document.createElement('a');
                login.href = 'index.html#login';
                login.textContent = ' Entrar';
                commentsStatus.append(login);
            }
        }
    };
    commentsButton.addEventListener('click', () => {
        const opening = commentsArea.hidden;
        commentsArea.hidden = !opening;
        commentsButton.setAttribute('aria-expanded', String(opening));
        if (opening && !commentsLoaded) void loadComments();
    });
    commentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = commentInput.value.trim();
        if (!text) return;
        commentSubmit.disabled = true;
        commentsStatus.textContent = '';
        try {
            const result = await window.ImpactaAPI.post('/feed/posts/' + encodeURIComponent(post.id) + '/comments', { body: text });
            commentsList.append(renderComment(result));
            commentInput.value = '';
            commentCount += 1;
            commentsButton.textContent = 'Comentar · ' + commentCount.toLocaleString('pt-AO');
            commentsStatus.textContent = 'Comentário publicado.';
            commentsLoaded = true;
        } catch (error) {
            commentsStatus.replaceChildren();
            const message = document.createElement('span');
            message.textContent = showError(error) || 'Não foi possível publicar o comentário.';
            commentsStatus.append(message);
            if (error?.code === 'authentication_required') {
                const login = document.createElement('a');
                login.href = 'index.html#login';
                login.textContent = ' Entrar';
                commentsStatus.append(login);
            }
        } finally {
            commentSubmit.disabled = false;
        }
    });

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'profile-post-action';
    shareButton.textContent = 'Partilhar';
    shareButton.addEventListener('click', async () => {
        const postUrl = new URL(window.location.href);
        postUrl.hash = card.id;
        shareButton.disabled = true;
        actionStatus.textContent = '';
        try {
            if (navigator.share) {
                await navigator.share({ title: 'IMPACTA · publicação da comunidade',
                    text: String(post.body || '').slice(0, 240), url: postUrl.href });
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(postUrl.href);
            } else if (window.ImpactaModal?.copy) {
                const copied = await window.ImpactaModal.copy({ title: 'Partilhar publicação',
                    message: 'Copia esta ligação para a enviares a outras pessoas.', text: postUrl.href });
                if (!copied) return;
            } else {
                actionStatus.textContent = postUrl.href;
                return;
            }
            const result = await window.ImpactaAPI.post('/feed/posts/' + encodeURIComponent(post.id) + '/share', {});
            shareButton.textContent = result.shared ? 'Ligação partilhada' : 'Já partilhaste';
            window.setTimeout(() => { shareButton.textContent = 'Partilhar'; }, 1800);
        } catch (error) {
            if (error?.name !== 'AbortError') showActionError(error, 'Não foi possível partilhar.');
        } finally {
            shareButton.disabled = false;
        }
    });
    actions.append(supportButton, commentsButton, shareButton);
    card.append(actions, actionStatus, commentsArea);
    return card;
}

async function loadProfilePosts(append = false) {
    if (postsLoading) return;
    postsLoading = true;
    postsMore.disabled = true;
    postsStatus.hidden = false;
    postsStatus.textContent = append ? 'A carregar mais publicações…' : 'A carregar publicações…';
    const path = profileId ? `/profiles/${encodeURIComponent(profileId)}/posts` : '/profile/posts';
    const query = append && postsCursor ? `?before=${encodeURIComponent(postsCursor)}` : '';
    try {
        const result = await window.ImpactaAPI.request(`${path}${query}`);
        const items = Array.isArray(result.items) ? result.items : [];
        if (!append) postsList.replaceChildren();
        items.forEach((post) => postsList.append(renderProfilePost(post)));
        postsCursor = result.nextBefore || null;
        postsStatus.textContent = postsList.childElementCount
            ? ''
            : 'Ainda não há publicações para mostrar.';
        postsStatus.hidden = postsList.childElementCount > 0;
        postsMore.hidden = !postsCursor;
        postsMore.textContent = 'Ver mais publicações deste perfil';
        postsLoaded = true;
    } catch (error) {
        postsStatus.textContent = showError(error);
        postsStatus.hidden = false;
        postsMore.hidden = false;
        postsMore.textContent = 'Tentar novamente';
        postsCursor = null;
        postsLoaded = false;
    } finally {
        postsLoading = false;
        postsMore.disabled = false;
    }
}

async function openProjectEdit(project) {
    if (!projectEditDialog || !projectEditForm) return;
    const fields = projectEditForm.elements;
    const areaSelect = fields.namedItem('impactAreaId');
    if (!Array.isArray(projectImpactAreas)) {
        try {
            projectImpactAreas = await window.ImpactaAPI.get('/impact-areas');
        } catch {
            projectImpactAreas = [];
        }
    }
    areaSelect.replaceChildren(new Option('Sem área específica', ''));
    projectImpactAreas.forEach((area) => areaSelect.add(new Option(area.name, area.id)));
    if (project.impact_area_id && !projectImpactAreas.some((area) => area.id === project.impact_area_id)) {
        areaSelect.add(new Option(project.impact_area || 'Área atual', project.impact_area_id));
    }
    const source = {
        projectId: project.id,
        title: project.title,
        description: project.description,
        locationProvince: project.location_province,
        locationMunicipality: project.location_municipality,
        locationCommune: project.location_commune,
        locationNeighborhood: project.location_neighborhood,
        locationCity: project.location_city,
        startsAt: project.starts_at,
        endsAt: project.ends_at
    };
    for (const name of Object.keys(source)) {
        fields.namedItem(name).value = source[name] || '';
    }
    areaSelect.value = project.impact_area_id || '';
    projectEditFeedback.textContent = '';
    projectEditFeedback.classList.remove('is-error');
    projectEditDialog.showModal();
}

function renderProfileProject(project) {
    const card = document.createElement('article');
    card.className = 'profile-project-card panel';
    const heading = document.createElement('div');
    heading.className = 'profile-project-heading';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'profile-project-title-group';
    const kicker = document.createElement('span');
    kicker.className = 'profile-project-kicker';
    const isProjectOwner = project.is_owner === true;
    kicker.textContent = isProjectOwner
        ? (project.community_name ? 'RESPONSÁVEL · PROJETO DA COMUNIDADE' : 'RESPONSÁVEL · PROJETO INDEPENDENTE')
        : (project.community_name ? 'PARTICIPANTE · PROJETO DA COMUNIDADE' : 'PARTICIPANTE · PROJETO INDEPENDENTE');
    const title = document.createElement('h3');
    title.textContent = project.title;
    const actions = document.createElement('div');
    actions.className = 'profile-project-actions';
    const statusLabels = { review: 'Em análise', active: 'Aprovado', rejected: 'Rejeitado' };
    const badge = document.createElement('span');
    badge.className = `profile-project-status is-${project.status}`;
    badge.textContent = statusLabels[project.status] || project.status;
    const controls = [badge];
    if (!profileId && isProjectOwner) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'profile-project-edit-button';
        edit.textContent = 'Editar';
        edit.setAttribute('aria-label', `Editar ${project.title}`);
        edit.addEventListener('click', () => void openProjectEdit(project));
        controls.push(edit);
    }
    titleGroup.append(kicker, title);
    actions.append(...controls);
    heading.append(titleGroup, actions);
    card.append(heading);

    if (project.description) {
        const description = project.description.trim();
        if (description.length > 105) {
            const preview = document.createElement('p');
            preview.className = 'profile-project-description is-preview';
            preview.textContent = `${description.slice(0, 100).trimEnd()}…`;
            const disclosure = document.createElement('details');
            disclosure.className = 'profile-project-description-more';
            const summary = document.createElement('summary');
            summary.textContent = 'Ler descrição completa';
            const fullDescription = document.createElement('p');
            fullDescription.className = 'profile-project-description';
            fullDescription.textContent = description;
            disclosure.append(summary, fullDescription);
            card.append(preview, disclosure);
        } else {
            const descriptionText = document.createElement('p');
            descriptionText.className = 'profile-project-description';
            descriptionText.textContent = description;
            card.append(descriptionText);
        }
    }

    const locality = [project.location_neighborhood, project.location_commune, project.location_municipality,
        project.location_city, project.location_province].filter((value) => typeof value === 'string' && value.trim());
    const place = locality.length ? locality.join(' · ') : 'Por indicar';
    const applicantCount = Number(project.applicant_count) || 0;
    const facts = [
        ['Área', project.impact_area || 'Por definir'],
        ['Localização', place],
        ['Candidaturas', String(applicantCount)]
    ];
    const details = document.createElement('dl');
    details.className = 'profile-project-facts';
    for (const [label, value] of facts) {
        const item = document.createElement('div');
        item.className = `profile-project-fact${label === 'Candidaturas' ? ' is-applicants' : ''}`;
        const term = document.createElement('dt');
        term.textContent = label;
        const definition = document.createElement('dd');
        definition.textContent = label === 'Candidaturas'
            ? `${value} ${Number(value) === 1 ? 'inscrição' : 'inscrições'}`
            : value;
        item.append(term, definition);
        details.append(item);
    }
    card.append(details);

    if (project.status === 'review') {
        const note = document.createElement('p');
        note.className = 'profile-project-note';
        note.textContent = 'A aguardar decisão da equipa.';
        card.append(note);
    } else if (project.status === 'active') {
        const note = document.createElement('p');
        note.className = 'profile-project-note is-approved';
        note.textContent = 'Aprovado e visível à comunidade.';
        card.append(note);
    } else if (project.status === 'rejected' && project.review_reason) {
        const reason = document.createElement('details');
        reason.className = 'profile-project-reason';
        const summary = document.createElement('summary');
        summary.textContent = 'Ver motivo da decisão';
        const message = document.createElement('p');
        message.textContent = project.review_reason;
        reason.append(summary, message);
        card.append(reason);
    }
    const footer = document.createElement('div');
    footer.className = 'profile-resource-actions';
    if (project.id && ['active', 'completed'].includes(project.status)) {
        const open = document.createElement('a');
        open.className = 'button button-small';
        open.href = 'feed.html?project=' + encodeURIComponent(project.id) + '#projetos';
        open.textContent = 'Ver projecto';
        footer.append(open);
    }
    if (footer.childElementCount) card.append(footer);
    return card;
}

document.querySelector('#profile-project-edit-close')?.addEventListener('click', () => projectEditDialog?.close());
document.querySelector('#profile-project-edit-cancel')?.addEventListener('click', () => projectEditDialog?.close());
projectEditDialog?.addEventListener('click', (event) => {
    if (event.target === projectEditDialog) projectEditDialog.close();
});
projectEditForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!projectEditForm.reportValidity()) return;
    const fields = projectEditForm.elements;
    const projectId = fields.namedItem('projectId').value;
    const values = Object.fromEntries(new FormData(projectEditForm).entries());
    delete values.projectId;
    projectEditSave.disabled = true;
    projectEditFeedback.classList.remove('is-error');
    projectEditFeedback.textContent = 'A guardar alterações e a enviar para análise…';
    try {
        await window.ImpactaAPI.put(`/projects/${encodeURIComponent(projectId)}`, values);
        projectEditDialog.close();
        await loadProfileProjects();
        projectEditFeedback.textContent = '';
        showProfileNotice('Alterações enviadas', 'O projecto foi enviado para análise.', { durationMs: 2300 });
    } catch (error) {
        projectEditFeedback.textContent = '';
        showProfileNotice('Não foi possível guardar', showError(error), { danger: true, durationMs: 3000 });
    } finally {
        projectEditSave.disabled = false;
    }
});

async function loadProfileProjects() {
    if (!projectsSection || !projectsList || !projectsStatus) return;
    if (projectsLoading) return;
    projectsLoading = true;
    projectsStatus.hidden = false;
    projectsStatus.classList.remove('is-error');
    projectsStatus.textContent = 'A carregar projectos…';
    projectsList.replaceChildren();
    try {
        const path = profileId
            ? `/profiles/${encodeURIComponent(profileId)}/projects`
            : '/profile/projects';
        const result = await window.ImpactaAPI.request(path);
        const items = Array.isArray(result.items) ? result.items : [];
        projectsList.replaceChildren(...items.map(renderProfileProject));
        projectsStatus.hidden = items.length > 0;
        projectsStatus.textContent = items.length ? '' : profileId
            ? 'Este perfil ainda não participa em projectos públicos.'
            : 'Ainda não tens propostas nem participações em projectos.';
        projectsLoaded = true;
    } catch (error) {
        projectsStatus.hidden = false;
        projectsStatus.textContent = showError(error);
        projectsStatus.classList.add('is-error');
        projectsLoaded = false;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'button button-small';
        retry.textContent = 'Tentar novamente';
        retry.addEventListener('click', () => void loadProfileProjects());
        projectsList.replaceChildren(retry);
    } finally {
        projectsLoading = false;
    }
}

function renderProfileCommunity(community) {
    const card = document.createElement('article');
    card.className = 'profile-community-card panel';
    const heading = document.createElement('div');
    heading.className = 'profile-community-heading';
    const titleGroup = document.createElement('div');
    const role = document.createElement('span');
    role.className = 'profile-project-kicker';
    role.textContent = community.is_moderator ? 'MODERADOR' : 'MEMBRO';
    const title = document.createElement('h3');
    title.textContent = community.name || 'Comunidade IMPACTA';
    titleGroup.append(role, title);
    const count = document.createElement('span');
    count.className = 'profile-community-count';
    const memberCount = Number(community.member_count) || 0;
    count.textContent = `${memberCount} ${memberCount === 1 ? 'membro' : 'membros'}`;
    heading.append(titleGroup, count);
    card.append(heading);
    if (community.description) {
        const descriptionText = community.description.trim();
        if (descriptionText.length > 220) {
            const preview = document.createElement('p');
            preview.className = 'profile-community-description is-preview';
            preview.textContent = descriptionText.slice(0, 205).trimEnd() + '…';
            const disclosure = document.createElement('details');
            disclosure.className = 'profile-community-description-more';
            const summary = document.createElement('summary');
            summary.textContent = 'Ler descrição completa';
            const full = document.createElement('p');
            full.className = 'profile-community-description';
            full.textContent = descriptionText;
            disclosure.append(summary, full);
            card.append(preview, disclosure);
        } else {
            const description = document.createElement('p');
            description.className = 'profile-community-description';
            description.textContent = descriptionText;
            card.append(description);
        }
    }
    const details = [community.impact_area, community.moderator_name ? `Responsável: ${community.moderator_name}` : '']
        .filter(Boolean);
    if (details.length) {
        const meta = document.createElement('p');
        meta.className = 'profile-community-meta';
        meta.textContent = details.join(' · ');
        card.append(meta);
    }
    const footer = document.createElement('div');
    footer.className = 'profile-resource-actions';
    const open = document.createElement('a');
    open.className = 'button button-small button-quiet';
    open.href = 'feed.html?community=' + encodeURIComponent(community.id) + '#comunidades';
    open.textContent = 'Abrir comunidade';
    footer.append(open);
    card.append(footer);
    return card;
}

async function loadProfileCommunities() {
    if (!communitiesList || !communitiesStatus) return;
    if (communitiesLoading) return;
    communitiesLoading = true;
    communitiesLoaded = false;
    communitiesStatus.hidden = false;
    communitiesStatus.classList.remove('is-error');
    communitiesStatus.textContent = 'A carregar comunidades…';
    communitiesList.replaceChildren();
    try {
        const path = profileId
            ? `/profiles/${encodeURIComponent(profileId)}/communities`
            : '/profile/communities';
        const result = await window.ImpactaAPI.request(path);
        const items = Array.isArray(result.items) ? result.items : [];
        communitiesList.replaceChildren(...items.map(renderProfileCommunity));
        communitiesStatus.hidden = items.length > 0;
        communitiesStatus.textContent = items.length
            ? ''
            : profileId
                ? 'Este perfil ainda não participa em comunidades públicas.'
                : 'Ainda não és membro de nenhuma comunidade ativa.';
        communitiesLoaded = true;
    } catch (error) {
        communitiesStatus.hidden = false;
        communitiesStatus.textContent = showError(error);
        communitiesStatus.classList.add('is-error');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'button button-small';
        retry.textContent = 'Tentar novamente';
        retry.addEventListener('click', () => void loadProfileCommunities());
        communitiesList.replaceChildren(retry);
    } finally {
        communitiesLoading = false;
    }
}

async function revealAdminShortcut() {
    const shortcut = document.querySelector('#profile-admin-shortcut');
    if (!shortcut) return;
    try {
        const access = await window.ImpactaAPI.request('/admin/access');
        shortcut.hidden = ![
            access?.canManageReports,
            access?.canModerate,
            access?.canManageCommunities,
            access?.canReviewProjects,
            access?.canVerifyAccounts
        ].some((allowed) => allowed === true);
    } catch {
        shortcut.hidden = true;
    }
}

function renderPublicProfile(profile) {
    currentProfileData = profile;
    setProfileCover(profile.coverUrl, false);
    setProfileCoverIdentity(profile);
    renderPublicProfileDocuments(profile.documents || {});
    document.querySelector('#profile-heading').textContent = profile.displayName;
    document.querySelector('#profile-intro').textContent = 'Partilha um pouco sobre ti e sobre a forma como queres contribuir.';
    if (document.querySelector('#profile-connections-summary')) {
        document.querySelector('#profile-connections-summary').textContent = 'Aqui aparecem as ligações cujo perfil também é público.';
    }
    const publicName = document.querySelector('#public-name');
    publicName.replaceChildren(document.createTextNode(profile.displayName));
    if (profile.isPlatformAdmin) {
        document.querySelector('#profile-heading').append(officialAccountBadge());
        publicName.append(officialAccountBadge());
    }
    if (profile.isIdentityVerified === true) {
        document.querySelector('#profile-heading').append(identityVerifiedBadge());
        publicName.append(identityVerifiedBadge());
    }
    document.querySelector('#public-headline').textContent = profile.headline || profile.impactArea || '';
    updatePublicImpactationCount(profile.impactationCount);
    const bio = document.querySelector('#public-bio');
    bio.textContent = profile.bio || '';
    bio.hidden = !profile.bio;
    setAvatar(publicAvatar, profile.avatarUrl, profile.displayName);
    const details = document.querySelector('#public-details');
    appendDetail(details, 'Localização', profile.location);
    appendDetail(details, 'Função', profile.occupation);
    appendDetail(details, 'Organização', profile.organization);
    appendDetail(details, 'Área de impacto', profile.impactArea);
    const skills = document.querySelector('#public-skills');
    for (const skill of profile.skills || []) {
        const tag = document.createElement('span');
        tag.className = 'profile-skill';
        tag.textContent = skill;
        skills.append(tag);
    }
    if (profile.websiteUrl) {
        const website = document.querySelector('#public-website');
        website.href = profile.websiteUrl;
        website.hidden = false;
    }
    editor.hidden = true;
    publicCard.hidden = false;
    setProfileTabs([
        ['Sobre', '#public-profile'],
        ['Projectos', '#profile-projects-section'],
        ['Publicações', '#profile-posts-section'],
        ['Impactantes', '#profile-connections-section'],
        ['Comunidades', '#profile-communities-section']
    ]);
    setStatus('');
    void loadImpactation(profile.id);
}

function updateOwnerImpactationCount(value) {
    if (!connectionsCount) return;
    const count = Math.max(0, Number(value) || 0);
    connectionsCount.textContent = `${count.toLocaleString('pt-AO')} ${count === 1 ? 'pessoa ligada' : 'pessoas ligadas'}`;
}

function updatePublicImpactationCount(value) {
    if (!publicImpactationCount) return;
    const count = Math.max(0, Number(value) || 0);
    publicImpactationCount.textContent = `${count.toLocaleString('pt-AO')} ${count === 1 ? 'pessoa ligada a este perfil' : 'pessoas ligadas a este perfil'}`;
}

function renderImpactationPerson(person) {
    const row = document.createElement('article');
    row.className = 'profile-connection-row';
    const avatar = document.createElement('div');
    avatar.className = 'profile-connection-avatar avatar';
    setAvatar(avatar, person.avatar_url, person.display_name);
    const copy = document.createElement('div');
    copy.className = 'profile-connection-copy';
    const name = document.createElement(person.is_public ? 'a' : 'strong');
    if (person.is_public) {
        name.href = `profile.html?id=${encodeURIComponent(person.id)}`;
        name.className = 'profile-connection-name';
    }
    name.textContent = person.display_name || 'Conta IMPACTA';
    const meta = document.createElement('small');
    meta.textContent = person.is_public && person.headline ? person.headline : 'Ligação de impactação aceite';
    copy.append(name, meta);
    row.append(avatar, copy);
    if (person.is_public) {
        const open = document.createElement('a');
        open.className = 'profile-connection-open';
        open.href = 'profile.html?id=' + encodeURIComponent(person.id);
        open.textContent = 'Ver perfil';
        row.append(open);
    }
    return row;
}

async function loadProfileImpactations() {
    if (!myImpactationsStatus || !myImpactationsItems) return;
    if (connectionsLoading) return;
    connectionsLoading = true;
    myImpactationsStatus.hidden = false;
    myImpactationsStatus.textContent = 'A carregar pessoas ligadas…';
    myImpactationsItems.replaceChildren();
    try {
        const path = profileId
            ? `/profiles/${encodeURIComponent(profileId)}/impactations`
            : '/profile/impactations';
        const result = await window.ImpactaAPI.request(path);
        const people = Array.isArray(result.items) ? result.items : [];
        myImpactationsItems.replaceChildren(...people.map(renderImpactationPerson));
        myImpactationsStatus.hidden = people.length > 0;
        myImpactationsStatus.textContent = people.length
            ? ''
            : profileId
                ? 'Este perfil ainda não tem ligações públicas.'
                : 'Ainda não tens ligações aceites. Quando alguém aceitar um pedido, aparecerá aqui.';
        if (connectionsCount) {
            const suffix = profileId ? 'perfis públicos' : 'pessoas ligadas';
            connectionsCount.textContent = `${people.length} ${suffix}`;
        }
        connectionsLoaded = true;
    } catch (error) {
        myImpactationsStatus.hidden = false;
        myImpactationsStatus.textContent = showError(error);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'button button-small';
        retry.textContent = 'Tentar novamente';
        retry.addEventListener('click', () => void loadProfileImpactations());
        myImpactationsItems.replaceChildren(retry);
    } finally {
        connectionsLoading = false;
    }
}

function setImpactationMessage(message, isError = false) {
    if (!impactationStatus) return;
    impactationStatus.textContent = message;
    impactationStatus.classList.toggle('is-error', isError);
}

function impactationButton(label, action, quiet = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = quiet ? 'button button-small button-quiet' : 'button button-small';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
}

async function loadImpactation(userId = profileId) {
    if (!impactationPanel || !impactationActions || !userId) return;
    impactationPanel.hidden = false;
    impactationActions.replaceChildren();
    setImpactationMessage('A verificar a tua ligação com este perfil...');
    try {
        const result = await window.ImpactaAPI.request(`/impactations/status/${encodeURIComponent(userId)}`);
        if (result.impactationCount !== undefined) updatePublicImpactationCount(result.impactationCount);
        impactationActions.replaceChildren();
        setImpactationMessage('');
        if (result.status === 'self') {
            impactationPanel.hidden = true;
            return;
        }
        if (result.status === 'connected') {
            const connected = impactationButton('Já estão impactados', () => {}, true);
            connected.disabled = true;
            impactationActions.append(connected);
            setImpactationMessage('Esta ligação foi aceite pelos dois perfis.');
        } else if (result.status === 'outgoing_pending') {
            const pending = impactationButton('Pedido enviado', () => {}, true);
            pending.disabled = true;
            impactationActions.append(pending);
            impactationActions.append(impactationButton('Cancelar pedido', async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    await window.ImpactaAPI.post(`/impactations/requests/${encodeURIComponent(result.requestId)}/cancel`, {});
                    await loadImpactation(userId);
                } catch (error) {
                    button.disabled = false;
                    setImpactationMessage(showError(error), true);
                }
            }, true));
            setImpactationMessage('O pedido fica pendente até a outra pessoa responder.');
        } else if (result.status === 'incoming_pending') {
            impactationActions.append(impactationButton('Aceitar pedido', async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    await window.ImpactaAPI.post(`/impactations/requests/${encodeURIComponent(result.requestId)}/respond`, { decision: 'accept' });
                    await loadImpactation(userId);
                } catch (error) {
                    button.disabled = false;
                    setImpactationMessage(showError(error), true);
                }
            }));
            impactationActions.append(impactationButton('Recusar', async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    await window.ImpactaAPI.post(`/impactations/requests/${encodeURIComponent(result.requestId)}/respond`, { decision: 'decline' });
                    await loadImpactation(userId);
                } catch (error) {
                    button.disabled = false;
                    setImpactationMessage(showError(error), true);
                }
            }, true));
            setImpactationMessage('Esta pessoa enviou-te um pedido de impactação.');
        } else {
            impactationActions.append(impactationButton('Impactar', async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    await window.ImpactaAPI.post(`/impactations/${encodeURIComponent(userId)}`, {});
                    await loadImpactation(userId);
                } catch (error) {
                    button.disabled = false;
                    setImpactationMessage(showError(error), true);
                }
            }));
            setImpactationMessage('Envia um pedido para criar uma ligação com este perfil.');
        }
    } catch (error) {
        impactationActions.replaceChildren();
        if (error?.code === 'authentication_required') {
            const login = document.createElement('a');
            login.className = 'button button-small';
            login.href = 'index.html#login';
            login.textContent = 'Entrar para criar uma ligação';
            impactationActions.append(login);
            setImpactationMessage('Entra na tua conta para enviar um pedido de impactação.');
        } else {
            setImpactationMessage(showError(error), true);
        }
    }
}

function populateEditor(profile, impactAreas) {
    currentProfileData = profile;
    setProfileCover(profile.coverUrl, true);
    setProfileCoverIdentity(profile);
    renderProfileDocumentSlots(profile.documents || {});
    document.querySelector('.profile-content-grid')?.classList.add('is-owner');
    const fields = profileForm.elements;
    fields.namedItem('displayName').value = profile.displayName || '';
    fields.namedItem('headline').value = profile.headline || '';
    fields.namedItem('bio').value = profile.bio || '';
    fields.namedItem('location').value = profile.location || '';
    fields.namedItem('occupation').value = profile.occupation || '';
    fields.namedItem('organization').value = profile.organization || '';
    fields.namedItem('websiteUrl').value = profile.websiteUrl || '';
    fields.namedItem('skills').value = (profile.skills || []).join(', ');
    fields.namedItem('isPublic').checked = Boolean(profile.isPublic);
    updateOwnerImpactationCount(profile.impactationCount);
    const impactArea = fields.namedItem('impactAreaId');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Escolhe uma área';
    impactArea.replaceChildren(placeholder);
    for (const item of impactAreas) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        impactArea.append(option);
    }
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = 'Outra — adicionar a minha área';
    impactArea.append(customOption);
    customImpactAreaInput.value = profile.customImpactArea || '';
    impactArea.value = profile.customImpactArea ? '__custom__' : (profile.impactAreaId || '');
    updateCustomImpactArea();
    document.querySelector('#profile-email').textContent = `E-mail da conta: ${profile.email}`;
    document.querySelector('#bio-count').textContent = String(Array.from(profile.bio || '').length);
    setAvatar(avatarBox, profile.avatarUrl, profile.displayName);
    currentAvatarUrl = profile.avatarUrl;
    removeAvatar.hidden = !currentAvatarUrl;
    editor.hidden = false;
    void loadAccountVerification(profile.isPublic === true);
    void loadProfileMfaStatus();
    if (document.querySelector('#profile-connections-summary')) {
        document.querySelector('#profile-connections-summary').textContent = 'Estas ligações foram aceites por ti e pelas outras pessoas.';
    }
    setProfileTabs([
        ['Sobre', '#profile-editor'],
        ['Projectos', '#profile-projects-section'],
        ['Publicações', '#profile-posts-section'],
        ['Impactantes', '#profile-connections-section'],
        ['Comunidades', '#profile-communities-section']
    ]);
    setStatus('');
}

function renderAccountVerification(result, profileIsPublic) {
    if (!accountVerificationStatus || !accountVerificationForm) return;
    const latest = result?.latestRequest;
    accountVerificationForm.hidden = true;
    if (accountVerificationProof) accountVerificationProof.hidden = true;
    accountVerificationStatus.classList.remove('is-error');
    if (result?.verified === true) {
        accountVerificationStatus.textContent = 'Canal oficial confirmado pelo IMPACTA. O distintivo aparece no teu perfil público.';
        return;
    }
    if (latest?.status === 'pending') {
        accountVerificationForm.dataset.requestId = latest.id;
        accountVerificationStatus.textContent = latest.challengeCode
            ? 'Pedido recebido. Envia o código em privado a partir de um contacto associado ao canal oficial. Não o publiques.'
            : 'Pedido recebido. O código expirou; gera outro para continuar.';
        if (accountVerificationProof) accountVerificationProof.hidden = false;
        if (accountVerificationCode) accountVerificationCode.textContent = latest.challengeCode || 'Código indisponível';
        if (accountVerificationEmailLink) {
            const subject = encodeURIComponent('Confirmação privada de canal oficial IMPACTA');
            const body = encodeURIComponent([
                'Pedido de verificação de conta IMPACTA.',
                `Canal oficial indicado: ${latest.evidenceUrl || ''}`,
                `Código temporário: ${latest.challengeCode || ''}`,
                'Envio esta confirmação a partir de um contacto associado ao canal indicado.'
            ].join('\n'));
            accountVerificationEmailLink.href = `mailto:impactaa2025@gmail.com?subject=${subject}&body=${body}`;
            accountVerificationEmailLink.hidden = !latest.challengeCode;
        }
        if (accountVerificationExpiry) {
            const expiry = latest.challengeExpiresAt ? new Date(latest.challengeExpiresAt) : null;
            accountVerificationExpiry.textContent = expiry && !Number.isNaN(expiry.getTime())
                ? `Válido até ${expiry.toLocaleDateString('pt-AO')}.`
                : 'O código expirou.';
        }
        if (accountVerificationCopy) accountVerificationCopy.hidden = !latest.challengeCode;
        if (accountVerificationRenew) accountVerificationRenew.hidden = latest.canRenewChallenge !== true;
        return;
    }
    delete accountVerificationForm.dataset.requestId;
    if (latest?.status === 'approved') {
        accountVerificationStatus.textContent = 'O pedido anterior foi aprovado antes da confirmação do canal. Faz uma confirmação rápida para manter o distintivo.';
    } else if (latest?.status === 'rejected') {
        accountVerificationStatus.textContent = latest.reviewReason
            ? `O pedido anterior não foi aprovado: ${latest.reviewReason}`
            : 'O pedido anterior não foi aprovado. Revê a ligação e envia um novo pedido.';
    } else if (latest?.status === 'revoked') {
        accountVerificationStatus.textContent = 'A verificação anterior foi retirada. Podes pedir uma nova análise.';
    } else {
        accountVerificationStatus.textContent = 'A verificação é manual e não exige documentos de identificação.';
    }
    if (!profileIsPublic) {
        accountVerificationStatus.textContent += ' Torna o perfil público e guarda as alterações primeiro.';
        return;
    }
    accountVerificationForm.hidden = false;
}

async function loadAccountVerification(profileIsPublic) {
    if (!accountVerificationStatus || !accountVerificationForm) return;
    try {
        const result = await window.ImpactaAPI.request('/profile/account-verification');
        renderAccountVerification(result, profileIsPublic);
    } catch (error) {
        accountVerificationStatus.textContent = showError(error);
        accountVerificationStatus.classList.add('is-error');
    }
}

async function loadProfileMfaStatus() {
    if (!profileMfaStatus || !profileMfaStartForm) return;
    try {
        const result = await window.ImpactaAPI.request('/auth/mfa/status');
        profileMfaStartForm.hidden = result?.enabled === true;
        profileMfaConfirmForm.hidden = true;
        profileMfaStatus.classList.remove('is-error');
        profileMfaStatus.textContent = result?.enabled === true
            ? (result.required === true
                ? 'Verificação em dois passos ligada e obrigatória para esta conta.'
                : 'Verificação em dois passos ligada. A app será pedida em cada novo início de sessão.')
            : 'A proteção extra está desligada. Podes ativá-la com uma app autenticadora e a tua palavra-passe. Depois de ativada, será pedida em cada novo início de sessão.';
    } catch (error) {
        profileMfaStatus.textContent = showError(error);
        profileMfaStatus.classList.add('is-error');
    }
}

profileMfaStartForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!profileMfaStartForm.reportValidity()) return;
    const submit = profileMfaStartForm.querySelector('button[type="submit"]');
    const password = profileMfaStartForm.elements.namedItem('password');
    submit.disabled = true;
    profileMfaStatus.textContent = 'A confirmar a palavra-passe e a preparar a chave…';
    profileMfaStatus.classList.remove('is-error');
    try {
        const result = await window.ImpactaAPI.post('/auth/mfa/setup/start', { password: password.value });
        pendingMfaSetupChallenge = result.challengeToken;
        document.querySelector('#profile-mfa-secret').value = result.secret;
        password.value = '';
        profileMfaStartForm.hidden = true;
        profileMfaConfirmForm.hidden = false;
        profileMfaStatus.textContent = 'Adiciona a chave na app autenticadora e confirma com o código de 6 dígitos.';
        profileMfaConfirmForm.elements.namedItem('code').focus();
    } catch (error) {
        profileMfaStatus.textContent = showError(error);
        profileMfaStatus.classList.add('is-error');
    } finally {
        submit.disabled = false;
    }
});

profileMfaConfirmForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingMfaSetupChallenge || !profileMfaConfirmForm.reportValidity()) return;
    const submit = profileMfaConfirmForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    profileMfaStatus.textContent = 'A confirmar o código da app…';
    profileMfaStatus.classList.remove('is-error');
    try {
        const code = profileMfaConfirmForm.elements.namedItem('code').value.trim();
        const result = await window.ImpactaAPI.post('/auth/mfa/setup/confirm', {
            challengeToken: pendingMfaSetupChallenge,
            code
        });
        pendingMfaSetupChallenge = '';
        profileMfaConfirmForm.hidden = true;
        profileMfaStartForm.hidden = true;
        document.querySelector('#profile-mfa-secret').value = '';
        document.querySelector('#profile-mfa-recovery-codes').textContent =
            Array.isArray(result.recoveryCodes) ? result.recoveryCodes.join('\n') : '';
        profileMfaRecoveryPanel.hidden = false;
        profileMfaStatus.textContent = 'Verificação em dois passos activada. Guarda agora os códigos de recuperação.';
    } catch (error) {
        profileMfaStatus.textContent = showError(error);
        profileMfaStatus.classList.add('is-error');
    } finally {
        submit.disabled = false;
    }
});

document.querySelector('#profile-mfa-recovery-saved')?.addEventListener('click', () => {
    profileMfaRecoveryPanel.hidden = true;
    document.querySelector('#profile-mfa-recovery-codes').textContent = '';
    profileMfaStatus.textContent = 'Verificação em dois passos activa. Usa a app ou um código de recuperação para entrar.';
});

accountVerificationForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!accountVerificationForm.reportValidity()) return;
    const submit = accountVerificationForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    accountVerificationStatus.textContent = 'A enviar o pedido para a equipa IMPACTA…';
    accountVerificationStatus.classList.remove('is-error');
    try {
        const form = accountVerificationForm.elements;
        const note = form.namedItem('note').value.trim();
        await window.ImpactaAPI.post('/profile/account-verification', {
            category: form.namedItem('category').value,
            evidenceUrl: form.namedItem('evidenceUrl').value.trim(),
            ...(note ? { note } : {})
        });
        await loadAccountVerification(true);
    } catch (error) {
        accountVerificationStatus.textContent = showError(error);
        accountVerificationStatus.classList.add('is-error');
    } finally {
        submit.disabled = false;
    }
});

accountVerificationCopy?.addEventListener('click', async () => {
    const code = accountVerificationCode?.textContent?.trim();
    if (!code || code === 'Código indisponível') return;
    try {
        await navigator.clipboard.writeText(code);
        accountVerificationStatus.textContent = 'Código copiado. Publica-o no canal oficial indicado.';
        accountVerificationStatus.classList.remove('is-error');
    } catch {
        accountVerificationStatus.textContent = 'Não foi possível copiar automaticamente. Seleciona o código e copia-o.';
        accountVerificationStatus.classList.add('is-error');
    }
});

accountVerificationRenew?.addEventListener('click', async () => {
    const requestId = accountVerificationForm?.dataset.requestId;
    if (!requestId) return;
    accountVerificationRenew.disabled = true;
    try {
        await window.ImpactaAPI.post(`/profile/account-verification/${encodeURIComponent(requestId)}/challenge`, {});
        await loadAccountVerification(true);
    } catch (error) {
        accountVerificationStatus.textContent = showError(error);
        accountVerificationStatus.classList.add('is-error');
    } finally {
        accountVerificationRenew.disabled = false;
    }
});

function updateCustomImpactArea(clearWhenHidden = false) {
    const isCustom = profileForm.elements.namedItem('impactAreaId').value === '__custom__';
    customImpactAreaWrap.hidden = !isCustom;
    customImpactAreaInput.required = isCustom;
    if (!isCustom && clearWhenHidden) customImpactAreaInput.value = '';
}

async function loadProfile() {
    setStatus('A carregar perfil…');
    try {
        if (profileId) {
            const result = await window.ImpactaAPI.request(`/profiles/${encodeURIComponent(profileId)}`);
            renderPublicProfile(result.profile);
            return;
        }
        const result = await window.ImpactaAPI.request('/profile');
        populateEditor(result.profile, result.impactAreas || []);
        void revealAdminShortcut();
    } catch (error) {
        setStatus(showError(error), true);
        if (error?.code === 'authentication_required') {
            const login = document.createElement('a');
            login.className = 'button profile-login-button';
            login.href = 'login.html';
            login.textContent = 'Entrar para ver este perfil';
            statusBox.append(login);
        }
    }
}

postsMore.addEventListener('click', () => {
    if (postsCursor) void loadProfilePosts(true);
    else void loadProfilePosts(false);
});

for (const slot of profileDocumentSlots) {
    const type = slot.dataset.profileDocument;
    const upload = slot.querySelector('[data-document-upload]');
    const remove = slot.querySelector('[data-document-remove]');
    const fileInput = slot.querySelector('[data-document-file]');
    upload?.addEventListener('click', () => {
        if (!upload.disabled) fileInput?.click();
    });
    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const hasPdfExtension = file.name.toLocaleLowerCase().endsWith('.pdf');
        if (!hasPdfExtension || (file.type && file.type !== 'application/pdf')) {
            setProfileDocumentStatus(slot, showError({ code: 'unsupported_profile_document_type' }), true);
            fileInput.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            setProfileDocumentStatus(slot, showError({ code: 'profile_document_too_large' }), true);
            fileInput.value = '';
            return;
        }
        const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (signature.length < 5 || String.fromCharCode(...signature) !== '%PDF-') {
            setProfileDocumentStatus(slot, showError({ code: 'invalid_profile_document' }), true);
            fileInput.value = '';
            return;
        }

        upload.disabled = true;
        if (remove) remove.disabled = true;
        setProfileDocumentStatus(slot, 'A carregar documento...');
        try {
            const pdf = new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
            const result = await window.ImpactaAPI.upload(`/profile/documents/${encodeURIComponent(type)}`, pdf);
            currentProfileData.documents = { ...(currentProfileData.documents || {}), [type]: result.document };
            renderProfileDocumentSlots(currentProfileData.documents);
            setProfileDocumentStatus(slot, 'Documento anexado e disponível no perfil público.');
        } catch (error) {
            setProfileDocumentStatus(slot, showError(error), true);
        } finally {
            upload.disabled = false;
            if (remove) remove.disabled = false;
            fileInput.value = '';
        }
    });
    remove?.addEventListener('click', async () => {
        if (remove.disabled) return;
        upload.disabled = true;
        remove.disabled = true;
        setProfileDocumentStatus(slot, 'A remover documento...');
        try {
            await window.ImpactaAPI.delete(`/profile/documents/${encodeURIComponent(type)}`);
            const documents = { ...(currentProfileData.documents || {}) };
            delete documents[type];
            currentProfileData.documents = documents;
            renderProfileDocumentSlots(documents);
            setProfileDocumentStatus(slot, 'Documento removido.');
        } catch (error) {
            setProfileDocumentStatus(slot, showError(error), true);
        } finally {
            upload.disabled = false;
            remove.disabled = false;
        }
    });
}

chooseAvatar.addEventListener('click', () => {
    if (!chooseAvatar.disabled) avatarFile.click();
});
avatarFile.addEventListener('change', async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        setAvatarFeedback(file.size > 2 * 1024 * 1024
            ? 'A fotografia tem de ter menos de 2 MB.'
            : 'Escolhe uma imagem PNG ou JPEG.', true);
        avatarFile.value = '';
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    const preview = document.createElement('img');
    preview.alt = '';
    preview.decoding = 'async';
    preview.src = previewUrl;
    avatarBox.replaceChildren(preview);
    chooseAvatar.disabled = true;
    removeAvatar.disabled = true;
    setAvatarFeedback('A carregar fotografia...');
    try {
        const result = await window.ImpactaAPI.upload('/profile/avatar', file);
        currentAvatarUrl = result.avatarUrl;
        setAvatar(avatarBox, currentAvatarUrl, profileForm.elements.namedItem('displayName').value);
        removeAvatar.hidden = false;
        setAvatarFeedback('Fotografia atualizada.');
    } catch (error) {
        setAvatar(avatarBox, currentAvatarUrl, profileForm.elements.namedItem('displayName').value);
        setAvatarFeedback(showError(error), true);
    } finally {
        URL.revokeObjectURL(previewUrl);
        chooseAvatar.disabled = false;
        removeAvatar.disabled = false;
        avatarFile.value = '';
    }
});
removeAvatar.addEventListener('click', async () => {
    removeAvatar.disabled = true;
    chooseAvatar.disabled = true;
    setAvatarFeedback('A remover fotografia...');
    try {
        await window.ImpactaAPI.delete('/profile/avatar');
        setAvatar(avatarBox, null, profileForm.elements.namedItem('displayName').value);
        currentAvatarUrl = null;
        removeAvatar.hidden = true;
        setAvatarFeedback('Fotografia removida.');
    } catch (error) {
        setAvatarFeedback(showError(error), true);
    } finally {
        removeAvatar.disabled = false;
        chooseAvatar.disabled = false;
    }
});
chooseCover?.addEventListener('click', () => {
    if (!chooseCover.disabled) coverFile?.click();
});
coverFile?.addEventListener('change', async () => {
    const file = coverFile.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        setCoverFeedback(file.size > 10 * 1024 * 1024
            ? 'A imagem de capa tem de ter até 10 MB.'
            : 'Escolhe uma imagem PNG ou JPEG.', true);
        coverFile.value = '';
        return;
    }
    const previousUrl = currentCoverUrl;
    const previewUrl = URL.createObjectURL(file);
    setProfileCover(previewUrl, true);
    chooseCover.disabled = true;
    removeCover.disabled = true;
    setCoverFeedback('A optimizar e guardar a imagem…');
    try {
        const result = await window.ImpactaAPI.upload('/profile/cover', file);
        currentProfileData.coverUrl = result.coverUrl;
        setProfileCover(result.coverUrl, true);
        setCoverFeedback('Imagem de capa atualizada.');
    } catch (error) {
        setProfileCover(previousUrl, true);
        setCoverFeedback(showError(error), true);
    } finally {
        URL.revokeObjectURL(previewUrl);
        chooseCover.disabled = false;
        removeCover.disabled = false;
        coverFile.value = '';
    }
});
removeCover?.addEventListener('click', async () => {
    chooseCover.disabled = true;
    removeCover.disabled = true;
    setCoverFeedback('A remover imagem de capa...');
    try {
        await window.ImpactaAPI.delete('/profile/cover');
        currentProfileData.coverUrl = null;
        setProfileCover(null, true);
        setCoverFeedback('Imagem de capa removida.');
    } catch (error) {
        setCoverFeedback(showError(error), true);
    } finally {
        chooseCover.disabled = false;
        removeCover.disabled = false;
    }
});
profileForm.elements.namedItem('bio').addEventListener('input', (event) => {
    document.querySelector('#bio-count').textContent = String(Array.from(event.currentTarget.value).length);
});

profileForm.elements.namedItem('impactAreaId').addEventListener('change', () => updateCustomImpactArea(true));

profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.querySelector('#save-profile');
    const fields = profileForm.elements;
    const skills = fields.namedItem('skills').value.split(',').map((value) => value.trim()).filter(Boolean);
    submit.disabled = true;
    profileFeedback.textContent = 'A guardar perfil…';
    try {
        await window.ImpactaAPI.put('/profile', {
            displayName: fields.namedItem('displayName').value,
            headline: fields.namedItem('headline').value,
            bio: fields.namedItem('bio').value,
            location: fields.namedItem('location').value,
            occupation: fields.namedItem('occupation').value,
            organization: fields.namedItem('organization').value,
            websiteUrl: fields.namedItem('websiteUrl').value,
            skills,
            impactAreaId: fields.namedItem('impactAreaId').value === '__custom__'
                ? null
                : (fields.namedItem('impactAreaId').value || null),
            customImpactArea: fields.namedItem('impactAreaId').value === '__custom__'
                ? customImpactAreaInput.value.trim()
                : '',
            isPublic: fields.namedItem('isPublic').checked
        });
        await loadProfile();
        profileFeedback.textContent = '';
        showProfileNotice('Perfil guardado', 'As informações do teu perfil foram actualizadas.', { durationMs: 1800 });
    } catch (error) {
        profileFeedback.textContent = '';
        showProfileNotice('Não foi possível guardar', showError(error), { danger: true, durationMs: 3000 });
    } finally {
        submit.disabled = false;
    }
});

if (profileId) {
    document.querySelector('#profile-editor').hidden = true;
} else {
    document.querySelector('#public-profile').hidden = true;
}
loadProfile();

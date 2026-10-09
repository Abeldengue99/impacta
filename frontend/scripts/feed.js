const postList = document.querySelector('#post-list');
const searchField = document.querySelector('#feed-search');
const sortField = document.querySelector('#feed-sort');
const emptyState = document.querySelector('#empty-state');
const feedStatus = document.querySelector('#feed-status');
const challengeList = document.querySelector('#challenge-list');
const projectList = document.querySelector('#projects-list');

const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('pt');
}

async function loadCurrentAccount() {
    try {
        const session = await window.ImpactaAPI.currentSession();
        const displayName = session?.authenticated ? session.user?.displayName?.trim() : '';
        if (!displayName) return;

        const accountActions = document.querySelector('.feed-header-actions');
        const loginLink = accountActions?.querySelector('.user-chip');
        if (accountActions && loginLink) {
            const avatar = element('span', 'user-chip', initials(displayName));
            avatar.title = `Sessão iniciada como ${displayName}`;
            avatar.setAttribute('aria-label', `Sessão iniciada como ${displayName}`);

            const logoutButton = element('button', 'logout-button', 'Sair');
            logoutButton.type = 'button';
            logoutButton.addEventListener('click', async () => {
                logoutButton.disabled = true;
                try {
                    await window.ImpactaAPI.delete('/auth/session');
                    window.location.assign('login.html');
                } catch {
                    logoutButton.disabled = false;
                    const composerHint = document.querySelector('.composer-hint');
                    if (composerHint) composerHint.textContent = 'Não foi possível terminar a sessão. Tenta novamente.';
                }
            });
            accountActions.replaceChildren(avatar, logoutButton);
        }

        const profile = document.querySelector('.mini-profile');
        if (profile) {
            profile.removeAttribute('href');
            profile.setAttribute('aria-label', `Conta autenticada: ${displayName}`);
            const avatar = profile.querySelector('.avatar');
            const strong = profile.querySelector('strong');
            const small = profile.querySelector('small');
            if (avatar) avatar.textContent = initials(displayName);
            if (strong) strong.textContent = displayName;
            if (small) small.textContent = 'Sessão autenticada';
        }

        const composerHint = document.querySelector('.composer-hint');
        if (composerHint) composerHint.textContent = `Sessão iniciada como ${displayName}.`;
        document.querySelector('.composer > a')?.remove();
    } catch {
        // Keep the public feed available when there is no valid session.
    }
}

function updateEmptyState() {
    if (!emptyState || !postList) return;
    const visiblePosts = [...postList.querySelectorAll('[data-post]')].filter((post) => !post.hidden);
    emptyState.hidden = visiblePosts.length > 0;
}

function createPost(postData) {
    const post = element('article', 'post-card panel');
    post.dataset.post = '';
    post.dataset.supports = String(postData.support_count);
    post.dataset.order = String(new Date(postData.created_at).getTime());

    const heading = element('div', 'post-heading');
    heading.append(element('span', 'avatar avatar-user', initials(postData.author) || 'I'));
    const author = element('div', 'post-author');
    author.append(element('strong', '', postData.author));
    const detail = [postData.community, new Date(postData.created_at).toLocaleString('pt-AO')].filter(Boolean).join(' · ');
    author.append(element('span', '', detail));
    heading.append(author);

    const tag = element('span', 'post-tag tag-green', 'Publicação da comunidade');
    const copy = element('p', 'post-copy', postData.body);
    const actions = element('div', 'post-actions');
    const support = element('button', 'support-button', `Apoiar ${postData.support_count}`);
    support.type = 'button';
    support.disabled = true;
    support.title = 'Apoios ficam disponíveis quando a autenticação estiver ligada.';
    const comments = element('button', 'comment-button', `Comentários ${postData.comment_count}`);
    comments.type = 'button';
    comments.disabled = true;
    comments.title = 'Comentários ficam disponíveis quando a autenticação estiver ligada.';
    const share = element('button', 'share-button', 'Partilhar');
    share.type = 'button';
    share.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#publicacao-${postData.id}`);
            share.textContent = 'Ligação copiada';
        } catch {
            share.textContent = 'Copia o endereço da página';
        }
        window.setTimeout(() => { share.textContent = 'Partilhar'; }, 1800);
    });
    actions.append(support, comments, share);
    post.id = `publicacao-${postData.id}`;
    post.append(heading, tag, copy, actions);
    return post;
}

function createChallenge(challenge) {
    const card = element('article', 'challenge-entry');
    card.append(element('span', 'tag tag-green', challenge.impact_area || 'Desafio comunitário'));
    card.append(element('h3', '', challenge.title));
    if (challenge.description) card.append(element('p', '', challenge.description));
    const participants = Number(challenge.participant_count);
    card.append(element('small', '', `${participants} ${participants === 1 ? 'participante' : 'participantes'}`));
    const button = element('button', 'button button-full challenge-button', 'Participar');
    button.type = 'button';
    button.disabled = true;
    button.title = 'A participação fica disponível quando a autenticação estiver ligada.';
    card.append(button);
    return card;
}

function createProject(project) {
    const link = element('div', 'project-row');
    link.append(element('span', 'project-icon project-icon-green', '↗'));
    const copy = element('span');
    copy.append(element('strong', '', project.title));
    const detail = [project.impact_area, `${project.participant_count} participantes`].filter(Boolean).join(' · ');
    copy.append(element('small', '', detail));
    link.append(copy);
    return link;
}

function applyFilterAndSort() {
    const query = searchField?.value.trim().toLocaleLowerCase('pt') || '';
    const posts = [...(postList?.querySelectorAll('[data-post]') || [])];
    posts.forEach((post) => {
        post.hidden = !post.textContent.toLocaleLowerCase('pt').includes(query);
    });
    posts.sort((a, b) => sortField?.value === 'supported'
        ? Number(b.dataset.supports) - Number(a.dataset.supports)
        : Number(b.dataset.order) - Number(a.dataset.order));
    posts.forEach((post) => postList.append(post));
    updateEmptyState();
}

async function loadCommunity() {
    try {
        const [posts, challenges, projects] = await Promise.all([
            window.ImpactaAPI.get('/feed/posts'),
            window.ImpactaAPI.get('/challenges'),
            window.ImpactaAPI.get('/projects')
        ]);

        posts.forEach((post) => postList.append(createPost(post)));
        challenges.forEach((challenge) => challengeList.append(createChallenge(challenge)));
        projects.forEach((project) => projectList.append(createProject(project)));
        if (posts.length === 0) emptyState.hidden = false;
        if (challenges.length === 0) challengeList.append(element('p', 'empty-state', 'Não há desafios abertos neste momento.'));
        if (projects.length === 0) projectList.append(element('p', 'empty-state', 'Ainda não há projetos ativos para mostrar.'));
        feedStatus.hidden = true;
        applyFilterAndSort();
    } catch {
        feedStatus.textContent = 'Não foi possível carregar dados da comunidade. A API ou a ligação à base de dados não está disponível.';
        emptyState.hidden = true;
        challengeList.replaceChildren(element('p', 'empty-state', 'Não foi possível carregar os desafios.'));
        projectList.replaceChildren(element('p', 'empty-state', 'Não foi possível carregar os projetos.'));
    }
}

searchField?.addEventListener('input', applyFilterAndSort);
sortField?.addEventListener('change', applyFilterAndSort);
loadCurrentAccount();
loadCommunity();

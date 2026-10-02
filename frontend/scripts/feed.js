const postList = document.querySelector('#post-list');
const searchField = document.querySelector('#feed-search');
const sortField = document.querySelector('#feed-sort');
const composer = document.querySelector('#composer');
const postText = document.querySelector('#post-text');
const composerStatus = document.querySelector('#composer-status');
const emptyState = document.querySelector('#empty-state');

function updateEmptyState() {
    if (!emptyState || !postList) return;
    const visiblePosts = [...postList.querySelectorAll('[data-post]')].filter((post) => !post.hidden);
    emptyState.hidden = visiblePosts.length > 0;
}

function bindPostActions(post) {
    const supportButton = post.querySelector('[data-support]');
    if (supportButton) {
        supportButton.addEventListener('click', () => {
            const isSupported = supportButton.getAttribute('aria-pressed') === 'true';
            const count = supportButton.querySelector('.support-count');
            const nextCount = Number(count.textContent) + (isSupported ? -1 : 1);
            count.textContent = String(Math.max(0, nextCount));
            post.dataset.supports = count.textContent;
            supportButton.setAttribute('aria-pressed', String(!isSupported));
        });
    }

    const shareButton = post.querySelector('[data-share]');
    if (shareButton) {
        shareButton.addEventListener('click', async () => {
            const copy = post.querySelector('.post-copy')?.textContent?.trim() || window.location.href;
            try {
                await navigator.clipboard.writeText(copy);
                shareButton.innerHTML = '<span aria-hidden="true">✓</span> Copiado';
                window.setTimeout(() => {
                    shareButton.innerHTML = '<span aria-hidden="true">↗</span> Partilhar';
                }, 1700);
            } catch {
                shareButton.setAttribute('aria-label', 'Copia manualmente o texto desta publicação');
            }
        });
    }

    const commentButton = post.querySelector('[data-comment]');
    if (commentButton) {
        commentButton.addEventListener('click', () => {
            const existing = post.querySelector('.comment-entry');
            if (existing) {
                existing.remove();
                commentButton.setAttribute('aria-expanded', 'false');
                return;
            }

            const entry = document.createElement('form');
            entry.className = 'comment-entry';
            const field = document.createElement('input');
            field.type = 'text';
            field.name = 'comment';
            field.maxLength = 240;
            field.placeholder = 'Escreve um comentário…';
            field.setAttribute('aria-label', 'Escreve um comentário');
            field.required = true;
            const submit = document.createElement('button');
            submit.type = 'submit';
            submit.textContent = 'Enviar';
            entry.append(field, submit);
            entry.addEventListener('submit', (event) => {
                event.preventDefault();
                const comment = document.createElement('p');
                comment.className = 'inline-comment';
                comment.textContent = `IS: ${field.value.trim()}`;
                entry.replaceWith(comment);
                commentButton.setAttribute('aria-expanded', 'false');
            });
            post.querySelector('.post-actions').before(entry);
            commentButton.setAttribute('aria-expanded', 'true');
            field.focus();
        });
    }
}

function createPost(content) {
    const post = document.createElement('article');
    post.className = 'post-card panel';
    post.dataset.post = '';
    post.dataset.supports = '0';

    const heading = document.createElement('div');
    heading.className = 'post-heading';
    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar-user';
    avatar.textContent = 'IS';
    const author = document.createElement('div');
    author.className = 'post-author';
    const name = document.createElement('strong');
    name.textContent = 'Participante IMPACTA';
    const detail = document.createElement('span');
    detail.textContent = 'Comunidade IMPACTA · agora';
    author.append(name, detail);
    heading.append(avatar, author);

    const tag = document.createElement('span');
    tag.className = 'post-tag tag-green';
    tag.textContent = 'Ideia partilhada';
    const copy = document.createElement('p');
    copy.className = 'post-copy';
    copy.textContent = content;

    const actions = document.createElement('div');
    actions.className = 'post-actions';
    actions.innerHTML = '<button class="support-button" type="button" data-support aria-pressed="false"><span aria-hidden="true">♡</span> Apoiar <span class="support-count">0</span></button><button type="button" class="comment-button" data-comment aria-expanded="false"><span aria-hidden="true">◌</span> Comentar <span>0</span></button><button type="button" class="share-button" data-share><span aria-hidden="true">↗</span> Partilhar</button>';
    post.append(heading, tag, copy, actions);
    bindPostActions(post);
    return post;
}

if (postList) {
    postList.querySelectorAll('[data-post]').forEach((post, index) => {
        post.dataset.order = String(Date.now() - index);
        bindPostActions(post);
    });
}

if (composer && postText && postList) {
    composer.addEventListener('submit', (event) => {
        event.preventDefault();
        const content = postText.value.trim();
        if (!content) return;
        const post = createPost(content);
        post.dataset.order = String(Date.now());
        postList.prepend(post);
        postText.value = '';
        composerStatus.textContent = 'A tua ideia foi publicada.';
        window.setTimeout(() => { composerStatus.textContent = ''; }, 2800);
        if (searchField) searchField.value = '';
        postList.querySelectorAll('[data-post]').forEach((item) => { item.hidden = false; });
        updateEmptyState();
    });
}

if (searchField && postList) {
    searchField.addEventListener('input', () => {
        const query = searchField.value.trim().toLocaleLowerCase('pt');
        postList.querySelectorAll('[data-post]').forEach((post) => {
            post.hidden = !post.textContent.toLocaleLowerCase('pt').includes(query);
        });
        updateEmptyState();
    });
}

if (sortField && postList) {
    sortField.addEventListener('change', () => {
        const posts = [...postList.querySelectorAll('[data-post]')];
        if (sortField.value === 'supported') {
            posts.sort((a, b) => Number(b.dataset.supports) - Number(a.dataset.supports));
        } else {
            posts.sort((a, b) => Number(b.dataset.order) - Number(a.dataset.order));
        }
        posts.forEach((post) => postList.append(post));
    });
}

const challengeButton = document.querySelector('[data-challenge]');
const challengeStatus = document.querySelector('#challenge-status');

if (challengeButton && challengeStatus) {
    challengeButton.addEventListener('click', () => {
        const joined = challengeButton.getAttribute('aria-pressed') === 'true';
        challengeButton.setAttribute('aria-pressed', String(!joined));
        challengeButton.innerHTML = joined
            ? 'Quero participar <span aria-hidden="true">→</span>'
            : 'Inscrição registada <span aria-hidden="true">✓</span>';
        challengeStatus.textContent = joined ? '' : 'Já estás na lista de participantes.';
    });
}

updateEmptyState();

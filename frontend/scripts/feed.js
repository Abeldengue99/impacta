const postList = document.querySelector('#post-list');
const searchField = document.querySelector('#feed-search');
const sortField = document.querySelector('#feed-sort');
const emptyState = document.querySelector('#empty-state');
const feedStatus = document.querySelector('#feed-status');
const challengeList = document.querySelector('#challenge-list');
const projectList = document.querySelector('#projects-list');
const communityList = document.querySelector('#community-list');
const composer = document.querySelector('#composer');
const composerInput = document.querySelector('#post-body');
const composerButton = document.querySelector('#publish-post');
const composerHint = document.querySelector('#composer-hint');
const composerStatus = document.querySelector('#composer-status');
const characterCount = document.querySelector('#post-character-count');

let currentUser = null;

const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => part[0]).join('').toLocaleUpperCase('pt');
}

function friendlyError(error, fallback) {
    const messages = {
        api_unavailable: 'A ligação à plataforma não está disponível. Tenta novamente.',
        authentication_required: 'A tua sessão terminou. Entra novamente para continuar.',
        csrf_validation_failed: 'A sessão de segurança expirou. Atualiza a página e tenta novamente.',
        post_rate_limit: 'Atingiste o limite de publicações por hora. Tenta mais tarde.',
        comment_rate_limit: 'Atingiste o limite de comentários por hora. Tenta mais tarde.',
        challenge_rate_limit: 'Atingiste o limite de participações por hora. Tenta mais tarde.',
        report_rate_limit: 'Atingiste o limite de denúncias por hora. Tenta mais tarde.',
        already_participating: 'Já enviaste uma participação neste desafio.',
        invalid_post_body: 'Escreve uma publicação com até 2000 caracteres.',
        invalid_comment_body: 'Escreve um comentário com até 1000 caracteres.',
        invalid_submission: 'Escreve a tua proposta para participar.',
        invalid_report_reason: 'Seleciona um motivo para a denúncia.'
    };
    return messages[error?.code] || fallback;
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-AO');
}

function updateEmptyState() {
    if (!emptyState || !postList) return;
    const visiblePosts = [...postList.querySelectorAll('[data-post]')].filter((post) => !post.hidden);
    emptyState.hidden = visiblePosts.length > 0;
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
    composerButton.disabled = !canPost;
    const login = document.querySelector('.composer-login');
    if (login) login.hidden = canPost;
    if (composerHint) {
        composerHint.textContent = canPost
            ? `A publicar como ${currentUser.displayName}. Partilha com respeito.`
            : 'Entra na tua conta para partilhar com a comunidade.';
    }
    const avatar = document.querySelector('.composer-avatar');
    if (avatar && canPost) avatar.textContent = initials(currentUser.displayName);
}

async function loadCurrentAccount() {
    try {
        const session = await window.ImpactaAPI.currentSession();
        currentUser = session?.authenticated ? session.user : null;
    } catch {
        currentUser = null;
        if (composerHint) composerHint.textContent = 'Não foi possível confirmar a sessão. Atualiza a página ou entra novamente.';
    }

    setComposerAccess();
    if (!currentUser) return;

    const accountActions = document.querySelector('.feed-header-actions');
    const loginLink = accountActions?.querySelector('.user-chip');
    if (accountActions && loginLink) {
        const avatar = element('span', 'user-chip', initials(currentUser.displayName));
        avatar.title = `Sessão iniciada como ${currentUser.displayName}`;
        avatar.setAttribute('aria-label', `Sessão iniciada como ${currentUser.displayName}`);
        const logoutButton = element('button', 'logout-button', 'Sair');
        logoutButton.type = 'button';
        logoutButton.addEventListener('click', async () => {
            logoutButton.disabled = true;
            try {
                await window.ImpactaAPI.delete('/auth/session');
                window.location.assign('login.html');
            } catch (error) {
                logoutButton.disabled = false;
                if (composerHint) composerHint.textContent = friendlyError(error, 'Não foi possível terminar a sessão. Tenta novamente.');
            }
        });
        accountActions.replaceChildren(avatar, logoutButton);
    }

    const profile = document.querySelector('.mini-profile');
    if (profile) {
        profile.removeAttribute('href');
        profile.setAttribute('aria-label', `Conta autenticada: ${currentUser.displayName}`);
        const avatar = profile.querySelector('.avatar');
        const strong = profile.querySelector('strong');
        const small = profile.querySelector('small');
        if (avatar) avatar.textContent = initials(currentUser.displayName);
        if (strong) strong.textContent = currentUser.displayName;
        if (small) small.textContent = 'Sessão autenticada';
    }
}

function addCommentRow(list, comment) {
    const row = element('article', 'inline-comment');
    const author = element('strong', 'inline-comment-author', comment.author || 'Membro');
    const body = element('span', '', comment.body);
    const time = element('small', '', formatDate(comment.created_at));
    row.append(author, body, time);
    list.append(row);
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
            await window.ImpactaAPI.post(`/feed/posts/${post.id}/reports`, {
                reasonCode: reason.value,
                details: details.value
            });
            status.textContent = 'Denúncia enviada à equipa de moderação.';
            form.reset();
            window.setTimeout(() => { form.hidden = true; }, 1600);
        } catch (error) {
            status.textContent = friendlyError(error, 'Não foi possível enviar a denúncia.');
        } finally {
            submit.disabled = false;
        }
    });
    return form;
}

function createPost(postData) {
    const post = element('article', 'post-card panel');
    post.dataset.post = '';
    post.dataset.supports = String(Number(postData.support_count) || 0);
    post.dataset.order = String(new Date(postData.created_at).getTime() || 0);
    post.id = `publicacao-${postData.id}`;

    const heading = element('div', 'post-heading');
    heading.append(element('span', 'avatar avatar-user', initials(postData.author) || 'I'));
    const author = element('div', 'post-author');
    author.append(element('strong', '', postData.author || 'Membro'));
    const detail = [postData.community, formatDate(postData.created_at)].filter(Boolean).join(' · ');
    author.append(element('span', '', detail));
    heading.append(author);

    const tag = element('span', 'post-tag tag-green', postData.community || 'Publicação da comunidade');
    const copy = element('p', 'post-copy', postData.body);
    const commentsArea = element('section', 'post-comments');
    commentsArea.hidden = true;
    commentsArea.setAttribute('aria-label', 'Comentários da publicação');
    const commentsList = element('div', 'comments-list');
    const commentStatus = element('p', 'form-status comment-status');
    commentStatus.setAttribute('role', 'status');
    commentsArea.append(commentsList, commentStatus);
    const postFeedback = element('p', 'form-status post-feedback');
    postFeedback.setAttribute('role', 'status');

    if (currentUser) {
        const commentForm = element('form', 'comment-entry');
        const input = element('textarea', 'comment-input');
        input.maxLength = 1000;
        input.rows = 1;
        input.placeholder = 'Escreve um comentário…';
        input.setAttribute('aria-label', 'Escreve um comentário');
        const send = element('button', '', 'Enviar');
        send.type = 'submit';
        commentForm.append(input, send);
        commentForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!input.value.trim()) {
                input.focus();
                return;
            }
            send.disabled = true;
            try {
                const comment = await window.ImpactaAPI.post(`/feed/posts/${postData.id}/comments`, { body: input.value });
                addCommentRow(commentsList, comment);
                input.value = '';
                commentStatus.textContent = '';
                const count = Number(postData.comment_count) + 1;
                postData.comment_count = count;
                commentButton.textContent = `Comentários ${count}`;
            } catch (error) {
                commentStatus.textContent = friendlyError(error, 'Não foi possível publicar o comentário.');
            } finally {
                send.disabled = false;
            }
        });
        commentsArea.append(commentForm);
    } else {
        const loginPrompt = element('a', 'comment-login', 'Entra para comentar');
        loginPrompt.href = 'login.html';
        commentsArea.append(loginPrompt);
    }

    const actions = element('div', 'post-actions');
    const support = element('button', 'support-button');
    support.type = 'button';
    support.setAttribute('aria-pressed', String(Boolean(postData.supported_by_viewer)));
    support.textContent = `Apoiar ${Number(postData.support_count) || 0}`;
    support.addEventListener('click', async () => {
        if (!currentUser) {
            window.location.assign('login.html');
            return;
        }
        support.disabled = true;
        try {
            const result = await window.ImpactaAPI.post(`/feed/posts/${postData.id}/support`, {});
            postData.supported_by_viewer = result.supported;
            postData.support_count = result.supportCount;
            post.dataset.supports = String(result.supportCount);
            support.textContent = `${result.supported ? 'Apoiado' : 'Apoiar'} ${result.supportCount}`;
            support.setAttribute('aria-pressed', String(result.supported));
        } catch (error) {
            postFeedback.textContent = friendlyError(error, 'Não foi possível atualizar o apoio.');
        } finally {
            support.disabled = false;
        }
    });

    const commentButton = element('button', 'comment-button', `Comentários ${Number(postData.comment_count) || 0}`);
    commentButton.type = 'button';
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

    const share = element('button', 'share-button', 'Partilhar');
    share.type = 'button';
    share.addEventListener('click', async () => {
        const url = `${window.location.origin}${window.location.pathname}#publicacao-${postData.id}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'IMPACTA · publicação da comunidade', text: postData.body, url });
                share.textContent = 'Partilhado';
            } else if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
                share.textContent = 'Ligação copiada';
            } else {
                window.prompt('Copia a ligação desta publicação:', url);
                share.textContent = 'Ligação pronta';
            }
        } catch (error) {
            if (error?.name === 'AbortError') return;
            share.textContent = 'Não foi possível partilhar';
        }
        window.setTimeout(() => { share.textContent = 'Partilhar'; }, 1800);
    });

    actions.append(support, commentButton, share);
    if (postData.is_author) {
        const remove = element('button', 'delete-post-button', 'Apagar');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
            if (!window.confirm('Queres apagar esta publicação?')) return;
            remove.disabled = true;
            try {
                await window.ImpactaAPI.delete(`/feed/posts/${postData.id}`);
                post.remove();
                updateEmptyState();
            } catch (error) {
                postFeedback.textContent = friendlyError(error, 'Não foi possível apagar a publicação.');
                remove.disabled = false;
            }
        });
        actions.append(remove);
    }

    const report = element('button', 'report-button', 'Denunciar');
    report.type = 'button';
    const reportForm = createReportForm(postData);
    report.addEventListener('click', () => {
        if (!currentUser) {
            window.location.assign('login.html');
            return;
        }
        reportForm.hidden = !reportForm.hidden;
    });

    post.append(heading, tag, copy, postFeedback, commentsArea, reportForm, actions);
    const reportRow = element('div', 'post-utility-actions');
    reportRow.append(report);
    post.append(reportRow);
    return post;
}

async function loadPosts() {
    feedStatus.hidden = false;
    feedStatus.textContent = 'A carregar publicações…';
    try {
        const posts = await window.ImpactaAPI.get('/feed/posts');
        postList.replaceChildren(...posts.map(createPost));
        feedStatus.hidden = true;
        emptyState.textContent = 'Ainda não há publicações da comunidade. Partilha a primeira ideia.';
        applyFilterAndSort();
    } catch (error) {
        postList.replaceChildren();
        feedStatus.replaceChildren();
        feedStatus.hidden = false;
        feedStatus.append(element('span', '', friendlyError(error, 'Não foi possível carregar as publicações.')));
        const retry = element('button', 'button button-small retry-button', 'Tentar novamente');
        retry.type = 'button';
        retry.addEventListener('click', loadPosts);
        feedStatus.append(retry);
        emptyState.hidden = true;
    }
}

async function submitPost(event) {
    event.preventDefault();
    if (!currentUser) {
        window.location.assign('login.html');
        return;
    }
    const body = composerInput.value.trim();
    if (!body) {
        composerInput.focus();
        return;
    }
    composerButton.disabled = true;
    composerStatus.textContent = 'A publicar…';
    try {
        const post = await window.ImpactaAPI.post('/feed/posts', { body });
        composerInput.value = '';
        updateCharacterCount();
        composerStatus.textContent = 'Publicação partilhada com a comunidade.';
        postList.prepend(createPost(post));
        emptyState.hidden = true;
        applyFilterAndSort();
    } catch (error) {
        composerStatus.textContent = friendlyError(error, 'Não foi possível publicar. Tenta novamente.');
    } finally {
        composerButton.disabled = !currentUser;
    }
}

function createChallenge(challenge) {
    const card = element('article', 'challenge-entry');
    card.dataset.searchable = '';
    card.append(element('span', 'tag tag-green', challenge.impact_area || 'Desafio comunitário'));
    card.append(element('h3', '', challenge.title));
    if (challenge.description) card.append(element('p', '', challenge.description));
    const count = element('small', 'participant-count', `${Number(challenge.participant_count) || 0} participantes`);
    card.append(count);

    if (challenge.viewer_participates) {
        const done = element('p', 'participation-done', 'A tua participação foi recebida.');
        card.append(done);
        return card;
    }
    if (!currentUser) {
        const login = element('a', 'button button-full', 'Entrar para participar');
        login.href = 'login.html';
        card.append(login);
        return card;
    }

    const toggle = element('button', 'button button-full challenge-button', 'Participar');
    toggle.type = 'button';
    const form = element('form', 'action-form challenge-form');
    form.hidden = true;
    const submission = element('textarea', 'action-input');
    submission.maxLength = 2000;
    submission.rows = 3;
    submission.required = true;
    submission.placeholder = 'Conta como gostarias de contribuir com este desafio.';
    const status = element('p', 'form-status');
    status.setAttribute('role', 'status');
    const submit = element('button', 'button button-small', 'Enviar participação');
    submit.type = 'submit';
    form.append(submission, status, submit);
    toggle.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) submission.focus();
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
            await window.ImpactaAPI.post(`/challenges/${challenge.id}/participations`, { submission: submission.value });
            challenge.viewer_participates = true;
            challenge.participant_count = Number(challenge.participant_count) + 1;
            count.textContent = `${challenge.participant_count} participantes`;
            form.replaceChildren(element('p', 'participation-done', 'A tua participação foi recebida.'));
            toggle.remove();
        } catch (error) {
            status.textContent = friendlyError(error, 'Não foi possível enviar a participação.');
            submit.disabled = false;
        }
    });
    card.append(toggle, form);
    return card;
}

function createProject(project) {
    const card = element('article', 'project-card');
    card.dataset.searchable = '';
    const row = element('div', 'project-row');
    row.append(element('span', 'project-icon project-icon-green', '↗'));
    const copy = element('span');
    copy.append(element('strong', '', project.title));
    const details = [project.impact_area, `${Number(project.participant_count) || 0} participantes`].filter(Boolean).join(' · ');
    copy.append(element('small', '', details));
    row.append(copy);
    card.append(row);
    if (project.description) card.append(element('p', 'project-description', project.description));
    if (project.community) card.append(element('small', 'project-community', project.community));

    if (project.viewer_participates) {
        card.append(element('p', 'participation-done', 'Já fazes parte deste projeto.'));
    } else if (!currentUser) {
        const login = element('a', 'project-join', 'Entrar para colaborar');
        login.href = 'login.html';
        card.append(login);
    } else {
        const join = element('button', 'project-join', 'Quero colaborar');
        join.type = 'button';
        join.addEventListener('click', async () => {
            join.disabled = true;
            try {
                await window.ImpactaAPI.post(`/projects/${project.id}/members`, {});
                project.viewer_participates = true;
                project.participant_count = Number(project.participant_count) + 1;
                copy.querySelector('small').textContent = [project.impact_area, `${project.participant_count} participantes`].filter(Boolean).join(' · ');
                join.replaceWith(element('p', 'participation-done', 'Já fazes parte deste projeto.'));
            } catch (error) {
                join.disabled = false;
                join.textContent = friendlyError(error, 'Não foi possível aderir ao projeto.');
            }
        });
        card.append(join);
    }
    return card;
}

function createCommunity(community) {
    const card = element('article', 'community-entry');
    card.dataset.searchable = '';
    const top = element('div', 'community-entry-top');
    top.append(element('strong', '', community.name));
    const details = [community.impact_area, `${Number(community.member_count) || 0} membros`].filter(Boolean).join(' · ');
    top.append(element('small', '', details));
    card.append(top);
    if (community.description) card.append(element('p', '', community.description));

    if (community.viewer_member) {
        card.append(element('span', 'participation-done', 'Já és membro.'));
    } else if (!currentUser) {
        const login = element('a', 'community-join', 'Entrar para aderir');
        login.href = 'login.html';
        card.append(login);
    } else {
        const join = element('button', 'community-join', 'Aderir à comunidade');
        join.type = 'button';
        join.addEventListener('click', async () => {
            join.disabled = true;
            try {
                await window.ImpactaAPI.post(`/communities/${community.id}/members`, {});
                community.viewer_member = true;
                community.member_count = Number(community.member_count) + 1;
                top.querySelector('small').textContent = [community.impact_area, `${community.member_count} membros`].filter(Boolean).join(' · ');
                join.replaceWith(element('span', 'participation-done', 'Já és membro.'));
            } catch (error) {
                join.disabled = false;
                join.textContent = friendlyError(error, 'Não foi possível aderir à comunidade.');
            }
        });
        card.append(join);
    }
    return card;
}

async function loadList(container, path, emptyMessage, createCard, errorMessage) {
    try {
        const items = await window.ImpactaAPI.get(path);
        container.replaceChildren();
        if (items.length === 0) {
            container.append(element('p', 'empty-state', emptyMessage));
        } else {
            items.forEach((item) => container.append(createCard(item)));
        }
    } catch {
        container.replaceChildren();
        const message = element('p', 'empty-state', errorMessage);
        const retry = element('button', 'button button-small retry-button', 'Tentar novamente');
        retry.type = 'button';
        retry.addEventListener('click', () => loadList(container, path, emptyMessage, createCard, errorMessage));
        container.append(message, retry);
    }
}

searchField?.addEventListener('input', applyFilterAndSort);
sortField?.addEventListener('change', applyFilterAndSort);
composer?.addEventListener('submit', submitPost);
composerInput?.addEventListener('input', updateCharacterCount);
updateCharacterCount();

async function startFeed() {
    await loadCurrentAccount();
    await Promise.all([
        loadPosts(),
        loadList(challengeList, '/challenges', 'Não há desafios abertos neste momento.', createChallenge, 'Não foi possível carregar os desafios.'),
        loadList(projectList, '/projects', 'Ainda não há projetos ativos para mostrar.', createProject, 'Não foi possível carregar os projetos.'),
        loadList(communityList, '/communities', 'Ainda não há comunidades públicas para mostrar.', createCommunity, 'Não foi possível carregar as comunidades.')
    ]);
}

void startFeed();

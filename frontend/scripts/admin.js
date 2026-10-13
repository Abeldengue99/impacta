(() => {
    const sidebar = document.querySelector('#admin-sidebar');
    const menuToggle = document.querySelector('.admin-menu-toggle');
    const navLinks = [...document.querySelectorAll('[data-admin-nav]')];
    const views = [...document.querySelectorAll('[data-admin-view]')];
    const currentTitle = document.querySelector('#admin-current-title');
    const description = document.querySelector('#admin-description');
    const reportList = document.querySelector('[data-report-list]');
    const reportStatus = document.querySelector('[data-report-status]');
    const reportRefresh = document.querySelector('[data-report-refresh]');
    const feedReviewList = document.querySelector('[data-feed-review-list]');
    const feedReviewStatus = document.querySelector('[data-feed-review-status]');
    const feedReviewRefresh = document.querySelector('[data-feed-review-refresh]');
    const contentReportList = document.querySelector('[data-content-report-list]');
    const contentReportStatus = document.querySelector('[data-content-report-status]');
    const communityProposalList = document.querySelector('[data-proposal-list="community"]');
    const projectProposalList = document.querySelector('[data-proposal-list="project"]');
    const proposalRefreshButtons = [...document.querySelectorAll('[data-proposal-refresh]')];
    const accessTitle = document.querySelector('[data-admin-access-title]');
    const accessCopy = document.querySelector('[data-admin-access-copy]');
    const accessState = document.querySelector('[data-admin-access-state]');
    const viewDescriptions = {
        overview: 'Acompanha a actividade e as decisões que mantêm a comunidade segura.',
        users: 'Consulta contas e aplica acções permitidas com histórico e motivo.',
        roles: 'Controla cada acesso por permissão e âmbito de recurso.',
        communities: 'Acompanha espaços colaborativos e as respectivas equipas.',
        projects: 'Revê projectos, desafios e a participação da comunidade.',
        moderation: 'Trate conteúdo sinalizado com decisões proporcionais e rastreáveis.',
        reports: 'Revê denúncias urgentes e regista uma decisão de moderação.',
        announcements: 'Prepara comunicações da plataforma com público e datas validados.',
        recognition: 'Reconhece contribuições e mantém o histórico dos pontos.',
        privacy: 'Acompanha pedidos pessoais com acesso estritamente limitado.',
        verifications: 'Confirma o controlo do canal oficial e regista cada decisão.',
        audit: 'Consulta acções administrativas autorizadas e respectivos motivos.',
        security: 'Acompanha a autenticação, as sessões e as acções de segurança.',
        settings: 'Gira definições não secretas e mantenha as alterações auditáveis.'
    };
    const reportReasonLabels = {
        spam: 'Spam ou conteúdo enganador',
        harassment: 'Assédio ou discurso de ódio',
        harmful: 'Conteúdo prejudicial',
        sexual_content: 'Conteúdo sexual explícito ou exploração',
        misinformation: 'Informação falsa',
        other: 'Outro motivo'
    };
    let activeView = 'overview';
    let loadingReports = false;
    let latestQueue = [];
    let canModerate = false;
    let loadingProposals = false;

    function makeElement(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function setAccess(title, copy, state, variant) {
        if (accessTitle) accessTitle.textContent = title;
        if (accessCopy) accessCopy.textContent = copy;
        if (accessState) accessState.textContent = state;
        const notice = document.querySelector('[data-admin-access-notice]');
        notice?.classList.toggle('is-ready', variant === 'ready');
        notice?.classList.toggle('is-warning', variant === 'warning');
    }

    async function revealProfileLink() {
        const link = document.querySelector('[data-admin-profile-link]');
        const verificationLink = navLinks.find((item) => item.dataset.adminNav === 'verifications');
        const verificationStat = document.querySelector('[data-admin-verification-stat]');
        if (!window.ImpactaAPI) {
            if (link) link.hidden = true;
            if (verificationLink) verificationLink.hidden = true;
            return;
        }
        try {
            const access = await window.ImpactaAPI.request('/admin/access');
            const canVerifyAccounts = access?.canVerifyAccounts === true;
            if (verificationLink) verificationLink.hidden = !canVerifyAccounts;
            if (verificationStat) verificationStat.hidden = !canVerifyAccounts;
            if (!canVerifyAccounts && activeView === 'verifications') selectView('overview', true);
            const canOpenProfile = [
                access?.canManageReports,
                access?.canModerate,
                access?.canManageCommunities,
                access?.canReviewProjects,
                access?.canVerifyAccounts
            ].some((allowed) => allowed === true);
            if (!link) return;
            link.hidden = !canOpenProfile;
            if (!canOpenProfile) return;
            try {
                const result = await window.ImpactaAPI.request('/profile');
                const profile = result?.profile;
                if (!profile?.id) return;
                const label = link.querySelector('.admin-profile-link-label');
                if (profile.isPublic) {
                    link.href = `../profile.html?id=${encodeURIComponent(profile.id)}`;
                    link.setAttribute('aria-label', 'Ver o meu perfil público');
                    if (label) label.textContent = 'Ver o meu perfil';
                } else {
                    link.href = '../profile.html';
                    link.setAttribute('aria-label', 'Editar o meu perfil');
                    if (label) label.textContent = 'Completar perfil';
                }
            } catch {
                // Keep the editable profile link available if the profile preview cannot load.
            }
        } catch {
            if (link) link.hidden = true;
            if (verificationLink) verificationLink.hidden = true;
            if (verificationStat) verificationStat.hidden = true;
            if (activeView === 'verifications') selectView('overview', true);
        }
    }

    function setUrgentCount(count) {
        const countText = count === null ? '—' : String(count);
        document.querySelectorAll('[data-urgent-report-count]').forEach((node) => {
            node.textContent = countText;
        });
        document.querySelectorAll('[data-urgent-report-badge]').forEach((node) => {
            node.textContent = count === null ? '' : countText;
            node.hidden = count === null || count < 1;
        });
        const caption = document.querySelector('[data-urgent-report-caption]');
        if (caption && count !== null) caption.textContent = count === 1 ? 'Requer intervenção imediata' : 'Requerem intervenção imediata';
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleString('pt-AO');
    }

    function renderReports(items) {
        latestQueue = items;
        setUrgentCount(items.length);
        if (!reportList) return;
        reportList.replaceChildren();
        const overviewTitle = document.querySelector('[data-report-overview-title]');
        const overviewCopy = document.querySelector('[data-report-overview-copy]');
        if (overviewTitle) overviewTitle.textContent = items.length
            ? items.length + (items.length === 1 ? ' publicação requer' : ' publicações requerem') + ' intervenção imediata.'
            : 'Nenhuma publicação na fila urgente.';
        if (overviewCopy) overviewCopy.textContent = items.length
            ? 'A administração pode abrir a fila, consultar os motivos e decidir se oculta ou remove cada publicação.'
            : 'A fila urgente será ativada quando denúncias abertas vierem de mais de cinco perfis diferentes.';
        if (!items.length) {
            const empty = makeElement('div', 'admin-report-empty');
            empty.append(
                makeElement('strong', '', 'Não há publicações na fila urgente.'),
                makeElement('p', '', 'A fila é ativada quando mais de cinco perfis diferentes denunciam a mesma publicação e as denúncias continuam abertas.')
            );
            reportList.append(empty);
            return;
        }
        items.forEach((item) => reportList.append(createReportCard(item)));
    }

    function createReportCard(item) {
        const card = makeElement('article', 'admin-report-card');
        const heading = makeElement('div', 'admin-report-card-heading');
        const title = makeElement('div');
        title.append(
            makeElement('p', 'admin-eyebrow', 'REVISÃO URGENTE'),
            makeElement('h3', '', 'Publicação de ' + (item.author_name || 'conta indisponível'))
        );
        const count = makeElement('strong', 'admin-report-count', String(item.reporter_count) + ' perfis');
        heading.append(title, count);

        const meta = makeElement('p', 'admin-report-meta', 'Publicada em ' + formatDate(item.post_created_at)
            + (item.post_status === 'hidden' ? ' · já está oculta' : ''));
        const body = makeElement('blockquote', 'admin-reported-post', item.body);
        const feedLink = makeElement('a', 'admin-report-feed-link', 'Ver no feed ↗');
        feedLink.href = '../feed.html#publicacao-' + encodeURIComponent(item.post_id);
        feedLink.target = '_blank';
        feedLink.rel = 'noopener noreferrer';

        const reportsHeading = makeElement('h4', 'admin-reports-subheading', 'Denúncias recebidas');
        const reports = makeElement('ul', 'admin-report-reasons');
        (Array.isArray(item.reports) ? item.reports : []).forEach((report) => {
            const row = makeElement('li');
            const top = makeElement('div', 'admin-report-reason-top');
            top.append(
                makeElement('strong', '', report.reporter || 'Conta encerrada'),
                makeElement('span', '', reportReasonLabels[report.reason_code] || 'Outro motivo'),
                makeElement('time', '', formatDate(report.created_at))
            );
            row.append(top);
            if (report.details) row.append(makeElement('p', '', report.details));
            reports.append(row);
        });
        card.append(heading, meta, body, feedLink, reportsHeading, reports);
        if (canModerate) card.append(createModerationForm(item));
        else card.append(makeElement('p', 'admin-report-no-permission', 'A tua conta pode consultar denúncias, mas não tem permissão para ocultar ou remover publicações.'));
        return card;
    }

    function createModerationForm(item) {
        const form = makeElement('form', 'admin-moderation-form');
        const label = makeElement('label', '', 'Motivo da decisão');
        const reason = makeElement('textarea', 'admin-moderation-reason');
        reason.required = true;
        reason.maxLength = 1000;
        reason.rows = 3;
        reason.placeholder = 'Regista o motivo da decisão para o histórico de moderação.';
        label.append(reason);
        const status = makeElement('p', 'admin-action-status');
        status.setAttribute('role', 'status');
        const actions = makeElement('div', 'admin-moderation-actions');
        const hide = makeElement('button', 'admin-action-button admin-action-hide', item.post_status === 'hidden' ? 'Manter oculta e concluir' : 'Ocultar publicação');
        const remove = makeElement('button', 'admin-action-button admin-action-remove', 'Remover publicação');
        hide.type = 'button';
        remove.type = 'button';
        hide.addEventListener('click', () => submitModeration(item, 'hide', reason, status, [hide, remove]));
        remove.addEventListener('click', () => submitModeration(item, 'remove', reason, status, [hide, remove]));
        actions.append(hide, remove);
        form.append(label, actions, status);
        return form;
    }

    async function submitModeration(item, action, reasonField, status, buttons) {
        const reason = reasonField.value.trim();
        if (!reason) {
            status.textContent = 'Escreve o motivo antes de registar a decisão.';
            reasonField.focus();
            return;
        }
        const actionText = action === 'hide' ? 'ocultar ou manter oculta' : 'remover';
        buttons.forEach((button) => { button.disabled = true; });
        const confirmed = await window.ImpactaModal.confirm({
            title: action === 'hide' ? 'Ocultar publicação?' : 'Remover publicação?',
            message: 'Vais ' + actionText + ' esta publicação. A decisão ficará registada no histórico da plataforma.',
            confirmLabel: action === 'hide' ? 'Confirmar ocultação' : 'Remover publicação',
            danger: action === 'remove'
        });
        if (!confirmed) { buttons.forEach((button) => { button.disabled = false; }); return; }
        try {
            await window.ImpactaAPI.request('/admin/posts/' + encodeURIComponent(item.post_id) + '/moderation', 'POST', {
                action,
                reason
            });
            await loadUrgentReports();
            if (reportStatus) reportStatus.textContent = action === 'hide'
                ? 'Publicação ocultada e denúncias resolvidas.'
                : 'Publicação removida e denúncias resolvidas.';
        } catch (error) {
            status.textContent = friendlyApiError(error, 'Não foi possível registar a decisão.');
        } finally {
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    function friendlyApiError(error, fallback) {
        if (error?.code === 'authentication_required') return 'A sessão terminou. Inicia sessão com uma conta administrativa.';
        if (error?.code === 'permission_required') return 'A conta não tem a permissão administrativa necessária para esta ação.';
        if (error?.code === 'urgent_report_threshold_not_met') return 'A publicação já não cumpre o limite de denúncias urgentes.';
        if (error?.code === 'feed_content_not_allowed') return 'O texto contém uma ameaça, incitação à violência ou conteúdo sexual explícito.';
        if (error?.code === 'post_unavailable') return 'Esta publicação já foi removida ou não está disponível.';
        if (error?.code === 'proposal_not_pending') return 'Esta proposta já foi analisada. Actualiza a fila.';
        if (error?.code === 'invalid_proposal') return 'A proposta não está disponível. Actualiza a fila.';
        if (error?.code === 'invalid_review_action') return 'A decisão enviada não é válida. Actualiza a fila e tenta novamente.';
        if (error?.code === 'invalid_review_reason') return 'O motivo enviado não é válido. Actualiza a fila e tenta novamente.';
        if (error?.code === 'review_reason_required') return 'Escreve o motivo antes de rejeitar a proposta.';
        if (error?.code === 'community_policy_review_required') return 'Confirma a revisão do nome, da descrição e da finalidade antes de publicar.';
        if (error?.code === 'api_unavailable') return 'A API não está disponível. Confirma que o serviço está iniciado.';
        return fallback;
    }

    async function loadFeedContentReview() {
        if (!feedReviewList || !window.ImpactaAPI) return;
        feedReviewStatus.textContent = 'A carregar publicações sinalizadas…';
        try {
            const response = await window.ImpactaAPI.request('/admin/feed-content-review');
            feedReviewList.replaceChildren();
            const items = Array.isArray(response?.items) ? response.items : [];
            window.ImpactaAdminModules?.setAnalyticsData('moderation', 'Publicações sinalizadas', items);
            if (!items.length) {
                feedReviewList.append(makeElement('div', 'admin-report-empty', 'Não há publicações sinalizadas à espera de revisão.'));
                feedReviewStatus.textContent = 'Fila atualizada.';
                return;
            }
            items.forEach((item) => {
                const card = makeElement('article', 'admin-report-card');
                const title = makeElement('h3', '', `Publicação sinalizada de ${item.author_name || 'Conta encerrada'}`);
                const meta = makeElement('p', 'admin-report-meta', 'Enviada em ' + new Date(item.created_at).toLocaleString('pt-AO'));
                const signal = makeElement('p', 'admin-report-meta', 'Sinalizada automaticamente pelas regras de segurança. Confirma o contexto antes de decidir.');
                const body = makeElement('blockquote', 'admin-reported-post', item.body || 'Sem texto');
                card.append(title, meta, signal, body);
                const attachments = Array.isArray(item.media) ? item.media : [];
                attachments.forEach((media) => {
                    const preview = media.media_type === 'video' ? makeElement('video', 'admin-review-media') : makeElement('img', 'admin-review-media');
                    preview.src = window.ImpactaAPI.assetUrl(media.url);
                    if (media.media_type === 'video') { preview.controls = true; preview.preload = 'metadata'; }
                    else { preview.alt = 'Imagem da publicação sinalizada'; }
                    card.append(preview);
                });
                const reason = makeElement('textarea', 'admin-moderation-reason');
                reason.required = true;
                reason.maxLength = 1000;
                reason.rows = 2;
                reason.placeholder = 'Motivo obrigatório, guardado no histórico de moderação.';
                const status = makeElement('p', 'admin-action-status');
                status.setAttribute('role', 'status');
                const actions = makeElement('div', 'admin-moderation-actions');
                const approve = makeElement('button', 'admin-action-button admin-action-hide', 'Aprovar e publicar');
                const reject = makeElement('button', 'admin-action-button admin-action-remove', 'Remover publicação');
                [approve, reject].forEach((button) => { button.type = 'button'; });
                const decide = async (action, buttons) => {
                    if (!reason.value.trim()) { status.textContent = 'Escreve o motivo antes de decidir.'; reason.focus(); return; }
                    buttons.forEach((button) => { button.disabled = true; });
                    try {
                        await window.ImpactaAPI.request('/admin/feed-content-review/' + encodeURIComponent(item.post_id) + '/decision', 'POST', { action, reason: reason.value.trim() });
                        await loadFeedContentReview();
                    } catch (error) {
                        status.textContent = friendlyApiError(error, 'Não foi possível guardar a decisão.');
                    } finally { buttons.forEach((button) => { button.disabled = false; }); }
                };
                approve.addEventListener('click', () => void decide('approve', [approve, reject]));
                reject.addEventListener('click', () => void decide('remove', [approve, reject]));
                actions.append(approve, reject);
                card.append(reason, actions, status);
                feedReviewList.append(card);
            });
            feedReviewStatus.textContent = items.length + (items.length === 1 ? ' publicação aguarda revisão.' : ' publicações aguardam revisão.');
        } catch (error) {
            feedReviewList.replaceChildren();
            window.ImpactaAdminModules?.setAnalyticsUnavailable('moderation', 'A fila de publicações sinalizadas está restrita ou indisponível.');
            feedReviewStatus.textContent = friendlyApiError(error, 'Não foi possível consultar a fila de publicações sinalizadas. Confirma permissões e migração.');
        }
    }

    async function loadContentReports() {
        if (!contentReportList || !window.ImpactaAPI) return;
        contentReportStatus.textContent = 'A carregar denúncias…';
        try {
            const response = await window.ImpactaAPI.request('/admin/content-reports');
            const items = Array.isArray(response?.items) ? response.items : [];
            window.ImpactaAdminModules?.setAnalyticsData('reports', 'Denúncias de conteúdo', items);
            const canDecide = response?.canModerate === true;
            contentReportList.replaceChildren();
            if (!items.length) {
                contentReportList.append(makeElement('div', 'admin-report-empty', 'Não há outras denúncias abertas.'));
                contentReportStatus.textContent = 'Fila atualizada.';
                return;
            }
            items.forEach((item) => {
                const card = makeElement('article', 'admin-report-card');
                const targetLabel = item.target_type === 'project_message'
                    ? 'Mensagem de projecto denunciada'
                    : item.target_type === 'comment' ? 'Comentário denunciado' : 'Publicação denunciada';
                card.append(makeElement('h3', '', `${targetLabel} · ${item.reporter_count} perfil(is)`));
                card.append(makeElement('p', 'admin-report-meta', `Autor: ${item.author_name || 'Conta encerrada'} · ${new Date(item.latest_report_at).toLocaleString('pt-AO')}`));
                card.append(makeElement('blockquote', 'admin-reported-post', item.content || 'Conteúdo indisponível'));
                const reportReasons = makeElement('ul', 'admin-report-reasons');
                (Array.isArray(item.reports) ? item.reports : []).forEach((report) => {
                    const entry = makeElement('li');
                    entry.append(makeElement('strong', '', `${report.reason_code || 'other'} · ${report.reporter || 'Conta encerrada'}`));
                    if (report.details) entry.append(makeElement('p', '', report.details));
                    reportReasons.append(entry);
                });
                card.append(makeElement('h4', 'admin-reports-subheading', 'Motivos recebidos'), reportReasons);
                const reason = makeElement('textarea', 'admin-moderation-reason');
                reason.required = true;
                reason.maxLength = 1000;
                reason.rows = 2;
                reason.placeholder = 'Motivo da decisão, guardado no histórico.';
                const actions = makeElement('div', 'admin-moderation-actions');
                const status = makeElement('p', 'admin-action-status');
                status.setAttribute('role', 'status');
                const decisions = [['dismiss', 'Arquivar denúncia'], ['hide', 'Ocultar conteúdo'], ['remove', 'Remover conteúdo']];
                decisions.forEach(([action, label]) => {
                    const button = makeElement('button', 'admin-action-button', label);
                    button.type = 'button';
                    button.addEventListener('click', async () => {
                        if (!reason.value.trim()) { status.textContent = 'Escreve o motivo antes de decidir.'; reason.focus(); return; }
                        button.disabled = true;
                        try {
                            await window.ImpactaAPI.request(`/admin/content-reports/${item.target_type}/${encodeURIComponent(item.target_id)}/decision`, 'POST', { action, reason: reason.value.trim() });
                            await loadContentReports();
                        } catch (error) { status.textContent = friendlyApiError(error, 'Não foi possível registar a decisão.'); }
                        finally { button.disabled = false; }
                    });
                    if (canDecide) actions.append(button);
                });
                if (canDecide) card.append(reason, actions, status);
                else card.append(makeElement('p', 'admin-report-no-permission', 'A tua conta pode consultar denúncias, mas não tem permissão para moderar conteúdo.'));
                contentReportList.append(card);
            });
            contentReportStatus.textContent = items.length + (items.length === 1 ? ' item denunciado.' : ' itens denunciados.');
        } catch (error) {
            contentReportList.replaceChildren();
            window.ImpactaAdminModules?.setAnalyticsUnavailable('reports', 'A consulta de denúncias de conteúdo está restrita ou indisponível.');
            contentReportStatus.textContent = friendlyApiError(error, 'Não foi possível consultar as denúncias.');
        }
    }

    function renderSpaceProposals(items) {
        const groups = [
            ['community', communityProposalList],
            ['project', projectProposalList]
        ];
        for (const [type, list] of groups) {
            if (!list) continue;
            const entries = items.filter((item) => item.resource_type === type);
            list.replaceChildren();
            if (!entries.length) {
                list.append(makeElement('div', 'admin-proposal-empty', type === 'community'
                    ? 'Não há comunidades pendentes de revisão.'
                    : 'Não há projectos pendentes de análise.'));
                continue;
            }
            entries.forEach((item) => list.append(createSpaceProposalCard(item)));
        }
    }

    function createSpaceProposalCard(item) {
        const card = makeElement('article', 'admin-space-proposal');
        const heading = makeElement('div', 'admin-space-proposal-heading');
        const copy = makeElement('div');
        copy.append(
            makeElement('p', 'admin-eyebrow', item.resource_type === 'community' ? 'NOVA COMUNIDADE' : 'NOVO PROJETO'),
            makeElement('h3', '', item.title)
        );
        heading.append(copy, makeElement('span', 'admin-proposal-state', 'Pendente'));
        const details = [
            item.submitted_by ? 'Proposto por ' + item.submitted_by : 'Autor indisponível',
            item.community_name || null,
            formatDate(item.created_at)
        ].filter(Boolean).join(' · ');
        card.append(heading, makeElement('p', 'admin-space-proposal-meta', details));
        if (item.description) card.append(makeElement('p', 'admin-space-proposal-description', item.description));
        if (item.location_summary) card.append(makeElement('p', 'admin-space-proposal-meta', 'Zona declarada: ' + item.location_summary));
        let policyCheck = null;
        if (item.resource_type === 'community') {
            card.append(makeElement('p', 'admin-space-proposal-policy',
                'Antes de aprovar, confirma o propósito, a zona declarada e procura sinais de pornografia, exploração sexual, assédio, ameaças, ódio, fraude ou actividades ilegais. A aprovação publica o grupo.'));
            policyCheck = makeElement('input');
            policyCheck.type = 'checkbox';
            const policyLabel = makeElement('label', 'admin-community-policy-confirm');
            policyLabel.append(policyCheck, makeElement('span', '', 'Revisei o nome, a descrição e a finalidade desta comunidade.'));
            card.append(policyLabel);
        }

        const reason = makeElement('textarea', 'admin-moderation-reason');
        reason.maxLength = 1000;
        reason.rows = 2;
        reason.placeholder = 'Motivo da rejeição (obrigatório apenas para rejeitar).';
        const status = makeElement('p', 'admin-action-status');
        status.setAttribute('role', 'status');
        const approve = makeElement('button', 'admin-action-button admin-action-hide', 'Aprovar e publicar');
        const reject = makeElement('button', 'admin-action-button admin-action-remove', 'Rejeitar');
        approve.type = reject.type = 'button';
        approve.addEventListener('click', () => submitSpaceProposal(item, 'approve', '', status, [approve, reject], policyCheck?.checked === true));
        reject.addEventListener('click', () => submitSpaceProposal(item, 'reject', reason.value.trim(), status, [approve, reject]));
        const actions = makeElement('div', 'admin-moderation-actions');
        actions.append(approve, reject);
        card.append(reason, actions, status);
        return card;
    }

    async function submitSpaceProposal(item, action, reason, status, buttons, policyChecked = false) {
        if (action === 'reject' && !reason) {
            status.textContent = 'Escreve o motivo antes de rejeitar a proposta.';
            return;
        }
        if (item.resource_type === 'community' && action === 'approve' && !policyChecked) {
            status.textContent = 'Confirma a revisão do nome, da descrição e da finalidade antes de publicar.';
            return;
        }
        buttons.forEach((button) => { button.disabled = true; });
        try {
            const body = action === 'reject' ? { action, reason }
                : item.resource_type === 'community' ? { action, policyChecked: true } : { action };
            await window.ImpactaAPI.request(
                '/admin/space-proposals/' + encodeURIComponent(item.resource_type) + '/' + encodeURIComponent(item.id) + '/review',
                'POST',
                body
            );
            await loadSpaceProposals();
        } catch (error) {
            status.textContent = friendlyApiError(error, 'Não foi possível registar a decisão.');
        } finally {
            buttons.forEach((button) => { button.disabled = false; });
        }
    }

    async function loadSpaceProposals() {
        if (loadingProposals || !window.ImpactaAPI) return;
        loadingProposals = true;
        proposalRefreshButtons.forEach((button) => { button.disabled = true; });
        document.querySelectorAll('[data-proposal-status]').forEach((node) => { node.textContent = 'A carregar propostas…'; });
        try {
            const response = await window.ImpactaAPI.request('/admin/space-proposals');
            const items = Array.isArray(response?.items) ? response.items : [];
            window.ImpactaAdminModules?.setAnalyticsData('communities', 'Propostas de comunidade', items.filter((item) => item.resource_type === 'community'));
            window.ImpactaAdminModules?.setAnalyticsData('projects', 'Propostas de projecto', items.filter((item) => item.resource_type === 'project'));
            renderSpaceProposals(items);
            setAccess(
                'Permissões de revisão autorizadas',
                'A API mostrou apenas propostas correspondentes ao âmbito de gestão da conta.',
                'REVISÃO LIGADA',
                'ready'
            );
            document.querySelectorAll('[data-proposal-status="community"]').forEach((node) => {
                node.textContent = response.canManageCommunities
                    ? `${items.filter((item) => item.resource_type === 'community').length} proposta(s) de comunidade pendente(s).`
                    : 'A tua conta não tem permissão para rever comunidades.';
            });
            document.querySelectorAll('[data-proposal-status="project"]').forEach((node) => {
                node.textContent = response.canReviewProjects
                    ? `${items.filter((item) => item.resource_type === 'project').length} proposta(s) de projecto pendente(s).`
                    : 'A tua conta não tem permissão para analisar projectos.';
            });
        } catch (error) {
            renderSpaceProposals([]);
            window.ImpactaAdminModules?.setAnalyticsUnavailable('communities', 'A fila de propostas requer permissão de revisão.');
            window.ImpactaAdminModules?.setAnalyticsUnavailable('projects', 'A fila de propostas requer permissão de revisão.');
            const message = error?.code === 'authentication_required'
                ? 'Inicia sessão com uma conta administrativa para rever propostas.'
                : error?.code === 'permission_required'
                    ? 'A conta não tem permissão para analisar comunidades ou projectos.'
                    : friendlyApiError(error, 'Não foi possível carregar as propostas. Confirma a API e a migração de comunidades.');
            document.querySelectorAll('[data-proposal-status]').forEach((node) => { node.textContent = message; });
            if (error?.code === 'permission_required') {
                setAccess('Permissão de revisão necessária', message, 'SEM PERMISSÃO', 'warning');
            }
        } finally {
            loadingProposals = false;
            proposalRefreshButtons.forEach((button) => { button.disabled = false; });
        }
    }

    async function loadUrgentReports() {
        if (loadingReports || !window.ImpactaAPI) return;
        loadingReports = true;
        if (reportRefresh) reportRefresh.disabled = true;
        if (reportStatus && latestQueue.length === 0) reportStatus.textContent = 'A carregar denúncias urgentes…';
        try {
            const response = await window.ImpactaAPI.request('/admin/reports/urgent');
            const items = Array.isArray(response?.items) ? response.items : [];
            window.ImpactaAdminModules?.setAnalyticsData('reports', 'Denúncias urgentes', items);
            canModerate = response?.canModerate === true;
            renderReports(items);
            setAccess(
                'Sessão administrativa autorizada',
                'A fila mostra publicações denunciadas por pelo menos 6 perfis distintos. As decisões exigem permissão de moderação e um motivo.',
                'FILA LIGADA',
                'ready'
            );
            if (reportStatus) reportStatus.textContent = items.length
                ? items.length + (items.length === 1 ? ' publicação requer' : ' publicações requerem') + ' intervenção imediata.'
                : 'Fila actualizada. Não há publicações que atinjam o limite de denúncias distintas.';
        } catch (error) {
            latestQueue = [];
            window.ImpactaAdminModules?.setAnalyticsUnavailable('reports', 'A fila urgente requer permissão para gerir denúncias.');
            setUrgentCount(null);
            reportList?.replaceChildren();
            const overviewTitle = document.querySelector('[data-report-overview-title]');
            const overviewCopy = document.querySelector('[data-report-overview-copy]');
            if (error?.code === 'authentication_required') {
                setAccess('Inicia sessão para consultar a fila', 'É necessária uma sessão ativa com uma função administrativa da plataforma.', 'SEM SESSÃO', 'warning');
                if (reportStatus) reportStatus.textContent = 'A sessão terminou. Inicia sessão com uma conta administrativa.';
                if (overviewTitle) overviewTitle.textContent = 'Sessão administrativa necessária.';
                if (overviewCopy) overviewCopy.textContent = 'Inicia sessão com uma conta que tenha acesso autorizado à administração da plataforma.';
            } else if (error?.code === 'permission_required') {
                setAccess('Acesso administrativo necessário', 'A conta autenticada não tem a permissão reports.manage na plataforma.', 'SEM PERMISSÃO', 'warning');
                if (reportStatus) reportStatus.textContent = 'A tua conta não tem permissão para consultar denúncias urgentes.';
                if (overviewTitle) overviewTitle.textContent = 'Acesso administrativo necessário.';
                if (overviewCopy) overviewCopy.textContent = 'A fila só é visível para contas com permissão de gestão de denúncias.';
            } else {
                setAccess('Não foi possível carregar a fila', 'Confirma se a API e a migração de escalada de denúncias estão ativas.', 'ERRO', 'warning');
                if (reportStatus) reportStatus.textContent = friendlyApiError(error, 'Não foi possível carregar as denúncias urgentes.');
                if (overviewTitle) overviewTitle.textContent = 'Fila indisponível.';
                if (overviewCopy) overviewCopy.textContent = 'Confirma o serviço da API e aplica a migração de escalada de denúncias.';
            }
        } finally {
            loadingReports = false;
            if (reportRefresh) reportRefresh.disabled = false;
        }
    }

    const selectView = (name, updateAddress) => {
        const link = navLinks.find((item) => item.dataset.adminNav === name) || navLinks[0];
        const selected = link.dataset.adminNav;
        activeView = selected;
        if (selected === 'reports') window.ImpactaAdminModules?.resetAnalytics(selected);
        navLinks.forEach((item) => {
            if (item === link) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        views.forEach((view) => { view.hidden = view.dataset.adminView !== selected; });
        currentTitle.textContent = [...link.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join('')
            .trim();
        description.textContent = viewDescriptions[selected];
        if (updateAddress && window.location.hash !== '#' + selected) {
            window.history.replaceState(null, '', '#' + selected);
        }
        sidebar.classList.remove('is-open');
        menuToggle?.setAttribute('aria-expanded', 'false');
        menuToggle?.setAttribute('aria-label', 'Abrir navegação');
        if (selected === 'reports') void loadUrgentReports();
        if (selected === 'reports') void loadContentReports();
        if (selected === 'moderation') void loadFeedContentReview();
        if (selected === 'communities' || selected === 'projects') void loadSpaceProposals();
        if (window.ImpactaAdminModules) {
            void window.ImpactaAdminModules.load(selected);
        } else {
            const selectedView = views.find((view) => view.dataset.adminView === selected);
            if (selectedView) {
                selectedView.querySelectorAll('.admin-module-grid, .admin-locked-state').forEach((item) => item.remove());
                let fallback = selectedView.querySelector('[data-admin-module-fallback]');
                if (!fallback) {
                    fallback = document.createElement('p');
                    fallback.className = 'admin-live-status is-warning';
                    fallback.dataset.adminModuleFallback = '';
                    fallback.setAttribute('role', 'status');
                    selectedView.append(fallback);
                }
                fallback.textContent = 'Este módulo não carregou. Atualiza a página para tentares novamente.';
            }
        }
    };

    function onNavClick(event) {
        event.preventDefault();
        selectView(event.currentTarget.dataset.adminNav, true);
    }

    navLinks.forEach((link) => link.addEventListener('click', onNavClick));
    document.querySelector('[data-report-overview-link]')?.addEventListener('click', (event) => {
        event.preventDefault();
        selectView('reports', true);
    });
    menuToggle?.addEventListener('click', () => {
        const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
        menuToggle.setAttribute('aria-expanded', String(!isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Abrir navegação' : 'Fechar navegação');
        sidebar.classList.toggle('is-open', !isOpen);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
            sidebar.classList.remove('is-open');
            menuToggle?.setAttribute('aria-expanded', 'false');
            menuToggle?.setAttribute('aria-label', 'Abrir navegação');
            menuToggle?.focus();
        }
    });
    reportRefresh?.addEventListener('click', () => void loadUrgentReports());
    feedReviewRefresh?.addEventListener('click', () => void loadFeedContentReview());
    proposalRefreshButtons.forEach((button) => button.addEventListener('click', () => void loadSpaceProposals()));

    const initialView = window.location.hash.slice(1);
    selectView(views.some((view) => view.dataset.adminView === initialView) ? initialView : 'overview', false);
    void revealProfileLink();
    void loadUrgentReports();
    window.setInterval(() => {
        if (!document.hidden) void loadUrgentReports();
    }, 30000);
})();

(() => {
    const api = window.ImpactaAPI;
    if (!api) return;

    const ui = {
        status: document.querySelector('#dm-status'),
        searchForm: document.querySelector('#dm-search-form'),
        searchInput: document.querySelector('#dm-search-input'),
        searchResults: document.querySelector('#dm-search-results'),
        tabs: [...document.querySelectorAll('[data-dm-tab]')],
        requestCount: document.querySelector('#dm-request-count'),
        requestSwitch: document.querySelector('#dm-request-switch'),
        requestBoxes: [...document.querySelectorAll('[data-dm-request-box]')],
        list: document.querySelector('#dm-list'),
        policy: document.querySelector('#dm-policy'),
        workspace: document.querySelector('.dm-workspace'),
        empty: document.querySelector('#dm-empty'),
        conversationHeading: document.querySelector('#dm-conversation-heading'),
        peerAvatar: document.querySelector('#dm-peer-avatar'),
        peerName: document.querySelector('#dm-peer-name'),
        messages: document.querySelector('#dm-messages'),
        loadOlder: document.querySelector('#dm-load-older'),
        composer: document.querySelector('#dm-composer'),
        messageInput: document.querySelector('#dm-message-input'),
        mediaInput: document.querySelector('#dm-media-input'),
        mediaPreview: document.querySelector('#dm-attachment-preview'),
        back: document.querySelector('#dm-back-button'),
        mute: document.querySelector('#dm-mute-button'),
        archive: document.querySelector('#dm-archive-button'),
        block: document.querySelector('#dm-block-button'),
        dialog: document.querySelector('#dm-start-dialog'),
        startForm: document.querySelector('#dm-start-form'),
        startInput: document.querySelector('#dm-start-input'),
        startNote: document.querySelector('#dm-start-note'),
        startLimit: document.querySelector('#dm-start-limit'),
        startClose: document.querySelector('#dm-start-close'),
        reportDialog: document.querySelector('#dm-report-dialog'),
        reportForm: document.querySelector('#dm-report-form'),
        reportReason: document.querySelector('#dm-report-reason'),
        reportDetails: document.querySelector('#dm-report-details'),
        reportClose: document.querySelector('#dm-report-close'),
        blockedToggle: document.querySelector('#dm-blocked-toggle'),
        blockedList: document.querySelector('#dm-blocked-list')
    };

    let sessionUser = null;
    let view = 'inbox';
    let requestBox = 'incoming';
    let selectedConversation = null;
    let selectedPerson = null;
    let reportTarget = null;
    let isConnected = false;
    let searchTimer = 0;
    let pollingTimer = 0;
    let refreshGeneration = 0;
    let messageHistory = [];
    let historyConversationId = '';
    let hasOlderMessages = false;
    let loadingOlderMessages = false;
    let selectedAttachment = null;
    const mediaUrl = (path) => window.location.protocol === 'https:' ? path : api.assetUrl(path);

    const message = (code) => ({
        api_unavailable: 'Não foi possível ligar ao serviço de mensagens. Tenta novamente.',
        api_timeout: 'O pedido demorou demasiado tempo. Tenta novamente.',
        contact_unavailable: 'Esta pessoa não está a aceitar novos contactos ou não pode receber esta mensagem.',
        message_request_must_be_short_and_link_free: 'O pedido deve ter até 500 caracteres e não pode incluir links.',
        contact_cooldown: 'Já houve uma tentativa recente de contacto. Aguarda antes de voltar a enviar um pedido.',
        message_request_limit_reached: 'Atingiste o limite diário de pedidos. Tenta novamente mais tarde.',
        request_already_pending: 'Já enviaste um pedido a esta pessoa.',
        incoming_request_exists: 'Esta pessoa já te enviou um pedido. Consulta a caixa de pedidos recebidos.',
        conversation_not_found: 'A conversa já não está disponível.',
        message_request_not_found: 'Este pedido já não está disponível.',
        invalid_message_request_report: 'Não foi possível enviar esta denúncia.',
        invalid_direct_message: 'Escreve uma mensagem com até 1 200 caracteres.',
        unsupported_direct_message_media_type: 'Escolhe uma imagem JPEG, PNG ou WebP, ou um vídeo MP4/MOV.',
        invalid_direct_message_media: 'Não foi possível ler este ficheiro. Escolhe-o novamente.',
        invalid_direct_message_caption: 'A legenda não é válida. Revê o texto e tenta novamente.',
        invalid_direct_message_image: 'A imagem não é válida ou tem dimensões demasiado grandes.',
        direct_message_media_too_large: 'A foto pode ter até 12 MB e o vídeo até 100 MB antes da compressão.',
        direct_message_video_too_long: 'Os vídeos na conversa podem ter até 60 segundos.',
        video_processing_busy: 'O servidor está a comprimir outro vídeo. Tenta novamente dentro de instantes.',
        video_processor_unavailable: 'A compressão de vídeo não está disponível neste momento.',
        processed_media_too_large: 'O ficheiro continua demasiado grande depois da compressão.',
        video_processing_timeout: 'A compressão demorou demasiado tempo. Envia um vídeo mais curto.',
        video_processing_failed: 'Não foi possível converter este vídeo. Tenta exportá-lo novamente como MP4.',
        post_video_resolution_too_large: 'Este vídeo tem uma resolução incompatível. Exporta-o numa resolução mais baixa e tenta novamente.',
        invalid_post_video: 'O vídeo não é válido ou não tem uma faixa de imagem compatível.',
        feed_content_not_allowed: 'A legenda contém conteúdo que não pode ser enviado.',
        report_limit_reached: 'Atingiste o limite de denúncias por agora.',
        message_limit_reached: 'Atingiste o limite de mensagens por hora. Aguarda um pouco antes de continuares.',
        already_reported: 'Esta mensagem já foi denunciada por ti.',
        profile_not_found: 'Não foi possível encontrar esse perfil.'
    }[code] || 'Ocorreu um erro. Tenta novamente.');

    function setStatus(text = '', success = false) {
        ui.status.textContent = text;
        ui.status.classList.toggle('is-success', Boolean(success));
    }

    function clearAttachment() {
        selectedAttachment = null;
        ui.mediaInput.value = '';
        ui.mediaPreview.hidden = true;
        ui.mediaPreview.replaceChildren();
    }

    function selectAttachment(file) {
        if (!file) return clearAttachment();
        const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
        const isVideo = ['video/mp4', 'video/quicktime'].includes(file.type);
        const maximum = (isVideo ? 100 : 12) * 1024 * 1024;
        if ((!isImage && !isVideo) || file.size <= 0 || file.size > maximum) {
            clearAttachment();
            setStatus((!isImage && !isVideo)
                ? message('unsupported_direct_message_media_type')
                : message('direct_message_media_too_large'));
            return;
        }
        selectedAttachment = file;
        ui.mediaPreview.replaceChildren();
        const details = document.createElement('span');
        details.className = 'dm-attachment-details';
        const name = document.createElement('strong');
        name.textContent = file.name;
        const size = document.createElement('small');
        size.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB · será convertido e comprimido`;
        details.append(name, size);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dm-attachment-remove';
        remove.textContent = 'Remover';
        remove.addEventListener('click', clearAttachment);
        ui.mediaPreview.append(details, remove);
        ui.mediaPreview.hidden = false;
    }

    function initials(name) {
        return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
            .map((part) => part[0]).join('').toLocaleUpperCase('pt') || 'I';
    }

    function makeAvatar(person, small = false) {
        const avatar = document.createElement('span');
        avatar.className = `dm-person-avatar${small ? ' is-small' : ''}`;
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = initials(person?.peer_name || person?.display_name || person?.name);
        if (person?.avatar_url) {
            const image = document.createElement('img');
            image.alt = '';
            image.loading = small ? 'eager' : 'lazy';
            image.src = mediaUrl(person.avatar_url);
            image.addEventListener('error', () => { image.remove(); avatar.textContent = initials(person?.peer_name || person?.display_name || person?.name); }, { once: true });
            avatar.replaceChildren(image);
        }
        return avatar;
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('pt-AO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
    }

    function setTab(next) {
        view = next;
        selectedConversation = null;
        ui.messageInput.value = '';
        clearAttachment();
        ui.workspace.classList.remove('has-open-conversation');
        ui.empty.hidden = false;
        ui.conversationHeading.hidden = true;
        ui.messages.hidden = true;
        ui.composer.hidden = true;
        ui.tabs.forEach((tab) => {
            const active = tab.dataset.dmTab === view;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        ui.requestSwitch.hidden = view !== 'requests';
        void loadCurrentList();
    }

    async function loadSummary() {
        const summary = await api.request('/direct-messages/summary');
        const requestCount = Math.max(0, Number(summary?.request_count) || 0);
        const unreadCount = Math.max(0, Number(summary?.unread_count) || 0);
        const totalCount = requestCount + unreadCount;
        ui.requestCount.textContent = requestCount > 99 ? '99+' : String(requestCount);
        ui.requestCount.hidden = requestCount === 0;
        ui.requestCount.setAttribute('aria-label', requestCount + ' pedidos pendentes');
        document.querySelectorAll('[data-direct-message-link]').forEach((link) => {
            const badge = link.querySelector('[data-direct-message-badge]');
            if (!badge) return;
            badge.textContent = totalCount > 99 ? '99+' : String(totalCount);
            badge.hidden = totalCount === 0;
            link.setAttribute('aria-label', totalCount
                ? 'Mensagens, ' + unreadCount + ' por ler e ' + requestCount + ' pedidos'
                : 'Mensagens');
        });
    }

    function renderEmpty(text) {
        ui.list.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'dm-list-empty';
        empty.textContent = text;
        ui.list.append(empty);
    }

    function renderConversations(items) {
        ui.list.replaceChildren();
        if (!items.length) {
            renderEmpty(view === 'archived'
                ? 'As conversas que arquiva aparecem aqui.'
                : 'Ainda não tens conversas. Procura uma pessoa para começar.');
            return;
        }
        items.forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `dm-conversation-item${selectedConversation?.id === item.id ? ' is-selected' : ''}`;
            row.setAttribute('role', 'listitem');
            row.append(makeAvatar(item, true));
            const copy = document.createElement('span');
            copy.className = 'dm-conversation-copy';
            const heading = document.createElement('strong');
            const name = document.createElement('span');
            name.textContent = item.peer_name || 'Conta IMPACTA';
            const time = document.createElement('time');
            time.className = 'dm-conversation-time';
            time.dateTime = item.last_message_at || '';
            time.textContent = item.last_message_at ? formatDate(item.last_message_at) : '';
            heading.append(name, time);
            const preview = document.createElement('small');
            preview.textContent = item.last_message || 'Conversa iniciada';
            copy.append(heading, preview);
            row.append(copy);
            if (Number(item.unread_count) > 0) {
                const unread = document.createElement('span');
                unread.className = 'dm-unread-dot';
                unread.textContent = Number(item.unread_count) > 99 ? '99+' : String(item.unread_count);
                unread.setAttribute('aria-label', `${item.unread_count} mensagens por ler`);
                row.append(unread);
            }
            row.addEventListener('click', () => { void openConversation(item); });
            ui.list.append(row);
        });
    }

    function renderRequests(items, outgoing) {
        ui.list.replaceChildren();
        if (!items.length) {
            renderEmpty(outgoing ? 'Não tens pedidos enviados pendentes.' : 'Não tens pedidos de mensagem pendentes.');
            return;
        }
        items.forEach((item) => {
            const card = document.createElement('article');
            card.className = 'dm-request-card ' + (outgoing ? 'is-outgoing' : 'is-incoming');
            card.setAttribute('role', 'listitem');
            const top = document.createElement('div');
            top.className = 'dm-request-top';
            top.append(makeAvatar(item, true));
            const identity = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = item.peer_name || 'Conta IMPACTA';
            const date = document.createElement('small');
            date.textContent = formatDate(item.created_at);
            identity.append(name, date);
            top.append(identity);
            const body = document.createElement('p');
            body.className = 'dm-request-body';
            body.textContent = item.body;
            card.append(top, body);
            const actions = document.createElement('div');
            actions.className = 'dm-request-actions';
            if (outgoing) {
                actions.append(actionButton('Cancelar pedido', () => runRequestAction(item.id, 'cancel')));
            } else {
                actions.append(actionButton('Aceitar e conversar', () => runRequestAction(item.id, 'accept')));
                actions.append(actionButton('Recusar', () => runRequestAction(item.id, 'decline'), 'is-danger'));
                actions.append(actionButton('Denunciar', () => openReport('request', item.id), 'is-danger'));
                actions.append(actionButton('Bloquear', () => blockPerson(item.peer_id), 'is-danger'));
            }
            card.append(actions);
            ui.list.append(card);
        });
    }

    function actionButton(label, action, extraClass = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (extraClass) button.className = extraClass;
        button.addEventListener('click', action);
        return button;
    }

    async function loadCurrentList() {
        try {
            if (view === 'requests') {
                const result = await api.request(`/direct-messages/requests?box=${requestBox}`);
                renderRequests(result.items || [], requestBox === 'outgoing');
            } else {
                const box = view === 'archived' ? 'archived' : 'inbox';
                const result = await api.request(`/direct-messages/conversations?box=${box}`);
                renderConversations(result.items || []);
            }
            await loadSummary();
        } catch (error) {
            renderEmpty(message(error?.code));
        }
    }

    async function openConversation(item) {
        if (selectedConversation?.id !== item.id) {
            messageHistory = [];
            historyConversationId = item.id;
            hasOlderMessages = false;
            ui.loadOlder.hidden = true;
            ui.messageInput.value = '';
            clearAttachment();
        }
        selectedConversation = item;
        ui.workspace.classList.add('has-open-conversation');
        ui.empty.hidden = true;
        ui.conversationHeading.hidden = false;
        ui.messages.hidden = false;
        ui.composer.hidden = false;
        ui.peerName.textContent = item.peer_name || 'Conta IMPACTA';
        ui.peerAvatar.replaceChildren(makeAvatar(item).firstChild || document.createTextNode(initials(item.peer_name)));
        const imageSource = item.avatar_url ? mediaUrl(item.avatar_url) : '';
        if (imageSource) {
            const image = document.createElement('img');
            image.alt = '';
            image.src = imageSource;
            image.addEventListener('error', () => { image.remove(); ui.peerAvatar.textContent = initials(item.peer_name); }, { once: true });
            ui.peerAvatar.replaceChildren(image);
        } else {
            ui.peerAvatar.textContent = initials(item.peer_name);
        }
        ui.peerAvatar.className = 'dm-person-avatar';
        ui.archive.textContent = view === 'archived' ? 'Desarquivar' : 'Arquivar';
        ui.mute.textContent = item.muted ? 'Activar som' : 'Silenciar';
        await loadMessages();
        await api.post(`/direct-messages/conversations/${item.id}/read`, {}).catch(() => undefined);
        void loadSummary();
        ui.messageInput.focus({ preventScroll: true });
    }

    async function loadMessages(beforeId = '') {
        const current = selectedConversation;
        if (!current) return;
        const generation = ++refreshGeneration;
        const beforeHeight = ui.messages.scrollHeight;
        const beforeTop = ui.messages.scrollTop;
        const wasAtBottom = beforeHeight - beforeTop - ui.messages.clientHeight < 90;
        try {
            const query = beforeId ? `?before=${encodeURIComponent(beforeId)}` : '';
            const result = await api.request(`/direct-messages/conversations/${current.id}/messages${query}`);
            if (generation !== refreshGeneration || selectedConversation?.id !== current.id) return;
            const items = result.items || [];
            const seen = new Set(messageHistory.map((entry) => entry.id));
            if (beforeId) {
                messageHistory = [...items.filter((entry) => !seen.has(entry.id)), ...messageHistory];
            } else if (!messageHistory.length || historyConversationId !== current.id) {
                messageHistory = items;
                historyConversationId = current.id;
            } else {
                const merged = new Map(messageHistory.map((entry) => [entry.id, entry]));
                items.forEach((entry) => merged.set(entry.id, entry));
                messageHistory = [...merged.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
            }
            hasOlderMessages = beforeId ? Boolean(result.hasMore) : Boolean(result.hasMore || hasOlderMessages);
            ui.loadOlder.hidden = !hasOlderMessages || !messageHistory.length;
            ui.messages.replaceChildren();
            if (!messageHistory.length) {
                const empty = document.createElement('p');
                empty.className = 'dm-list-empty';
                empty.textContent = 'Ainda não há mensagens. Podes começar a conversa quando quiseres.';
                ui.messages.append(empty);
            }
            messageHistory.forEach((item) => ui.messages.append(renderMessage(item)));
            if (beforeId) ui.messages.scrollTop = beforeTop + (ui.messages.scrollHeight - beforeHeight);
            else if (wasAtBottom || messageHistory.length === items.length) ui.messages.scrollTop = ui.messages.scrollHeight;
        } catch (error) {
            setStatus(message(error?.code));
        }
    }

    async function loadOlderMessages() {
        if (loadingOlderMessages || !hasOlderMessages || !messageHistory.length) return;
        loadingOlderMessages = true;
        ui.loadOlder.disabled = true;
        try { await loadMessages(messageHistory[0].id); }
        finally { loadingOlderMessages = false; ui.loadOlder.disabled = false; }
    }

    function renderMessage(item) {
        const mine = String(item.author_user_id) === String(sessionUser?.id);
        const bubble = document.createElement('article');
        bubble.className = 'dm-message ' + (mine ? 'is-mine' : 'is-received') + (item.deleted_at ? ' is-deleted' : '');
        if (item.body) {
            const body = document.createElement('p');
            body.className = 'dm-message-body';
            body.textContent = item.body;
            bubble.append(body);
        }
        if (item.media_url && ['image', 'video'].includes(item.media_type)) {
            const source = mediaUrl(item.media_url);
            if (item.media_type === 'image') {
                const image = document.createElement('img');
                image.className = 'dm-message-media';
                image.alt = 'Fotografia enviada na conversa';
                image.loading = 'lazy';
                image.crossOrigin = 'use-credentials';
                image.src = source;
                bubble.append(image);
            } else {
                const video = document.createElement('video');
                video.className = 'dm-message-media';
                video.controls = true;
                video.playsInline = true;
                video.preload = 'metadata';
                video.crossOrigin = 'use-credentials';
                video.src = source;
                bubble.append(video);
            }
        }
        const footer = document.createElement('div');
        footer.className = 'dm-message-footer';
        const time = document.createElement('time');
        time.dateTime = item.created_at;
        time.textContent = formatDate(item.created_at);
        footer.append(time);
        if (!mine && !item.deleted_at) {
            const report = document.createElement('button');
            report.type = 'button';
            report.className = 'dm-report-button';
            report.textContent = 'Denunciar';
            report.addEventListener('click', () => openReport('message', item.id));
            footer.append(report);
        }
        bubble.append(footer);
        return bubble;
    }

    async function runRequestAction(requestId, action) {
        try {
            const result = await api.post(`/direct-messages/requests/${requestId}/${action}`, {});
            setStatus(action === 'accept' ? 'Pedido aceite. A conversa privada está pronta.' : 'Pedido actualizado.', true);
            await loadCurrentList();
            if (action === 'accept') {
                const opened = await api.request('/direct-messages/conversations?box=inbox');
                const conversation = (opened.items || []).find((item) => item.id === result.conversationId);
                if (conversation) {
                    setTab('inbox');
                    await openConversation(conversation);
                }
            }
        } catch (error) { setStatus(message(error?.code)); }
    }

    async function blockPerson(userId) {
        if (!userId || !window.confirm('Bloquear esta pessoa? A conversa deixa de estar acessível e não poderão iniciar novo contacto.')) return;
        try {
            await api.post(`/direct-messages/blocks/${userId}`, {});
            selectedConversation = null;
            ui.messageInput.value = '';
            clearAttachment();
            ui.workspace.classList.remove('has-open-conversation');
            ui.conversationHeading.hidden = true;
            ui.messages.hidden = true;
            ui.composer.hidden = true;
            ui.empty.hidden = false;
            setStatus('Pessoa bloqueada. A conversa foi retirada da tua lista.', true);
            await loadCurrentList();
        } catch (error) { setStatus(message(error?.code)); }
    }

    function openReport(kind, id) {
        reportTarget = { kind, id: String(id) };
        ui.reportForm.reset();
        ui.reportDialog.showModal();
        ui.reportReason.focus();
    }

    async function submitReport(event) {
        event.preventDefault();
        if (!reportTarget) return;
        const target = reportTarget;
        const submit = ui.reportForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const endpoint = target.kind === 'request'
                ? `/direct-messages/requests/${encodeURIComponent(target.id)}/report`
                : `/direct-messages/messages/${encodeURIComponent(target.id)}/report`;
            const result = await api.post(endpoint, {
                reasonCode: ui.reportReason.value,
                details: ui.reportDetails.value.trim()
            });
            ui.reportDialog.close();
            reportTarget = null;
            const isDuplicate = result.status === 'already_reported';
            const subject = target.kind === 'request' ? 'Pedido' : 'Mensagem';
            setStatus(isDuplicate ? message('already_reported') : `${subject} denunciado à equipa de moderação.`, !isDuplicate);
        } catch (error) {
            setStatus(message(error?.code));
        } finally {
            submit.disabled = false;
        }
    }

    async function loadBlockedPeople() {
        try {
            const result = await api.request('/direct-messages/blocks');
            ui.blockedList.replaceChildren();
            const items = result.items || [];
            if (!items.length) {
                const empty = document.createElement('p');
                empty.className = 'dm-list-empty';
                empty.textContent = 'Não tens pessoas bloqueadas.';
                ui.blockedList.append(empty);
                return;
            }
            items.forEach((person) => {
                const row = document.createElement('div');
                row.className = 'dm-blocked-person';
                row.append(makeAvatar({ display_name: person.display_name, avatar_url: person.avatar_url }, true));
                const name = document.createElement('span');
                name.textContent = person.display_name;
                const unblock = actionButton('Desbloquear', async () => {
                    try {
                        await api.delete(`/direct-messages/blocks/${person.user_id}`);
                        setStatus('Pessoa desbloqueada.', true);
                        await loadBlockedPeople();
                    } catch (error) { setStatus(message(error?.code)); }
                });
                row.append(name, unblock);
                ui.blockedList.append(row);
            });
        } catch (error) { setStatus(message(error?.code)); }
    }

    async function runSearch() {
        const query = ui.searchInput.value.trim();
        if (Array.from(query).length < 2) {
            ui.searchResults.hidden = true;
            ui.searchResults.replaceChildren();
            return;
        }
        try {
            const result = await api.request(`/people?query=${encodeURIComponent(query)}`);
            if (ui.searchInput.value.trim() !== query) return;
            ui.searchResults.replaceChildren();
            if (!(result.items || []).length) {
                const empty = document.createElement('p');
                empty.className = 'dm-list-empty';
                empty.textContent = 'Não encontrámos pessoas com esse nome.';
                ui.searchResults.append(empty);
            }
            (result.items || []).forEach((person) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'dm-search-result';
                button.setAttribute('role', 'option');
                button.append(makeAvatar({ display_name: person.display_name, avatar_url: person.avatar_url }, true));
                const text = document.createElement('span');
                const name = document.createElement('strong');
                name.textContent = person.display_name;
                const note = document.createElement('small');
                note.textContent = person.headline || 'Abrir um contacto privado';
                text.append(name, note);
                button.append(text);
                button.addEventListener('click', () => { void prepareStart(person); });
                ui.searchResults.append(button);
            });
            ui.searchResults.hidden = false;
        } catch (error) { setStatus(message(error?.code)); }
    }

    async function prepareStart(person) {
        selectedPerson = person;
        isConnected = false;
        try {
            const status = await api.request(`/impactations/status/${person.id}`);
            isConnected = status.status === 'connected';
        } catch { /* The API still enforces the relationship and request rules. */ }
        ui.startInput.value = '';
        ui.startInput.maxLength = isConnected ? 1200 : 500;
        ui.startNote.textContent = isConnected
            ? `Já existe uma ligação Impacta com ${person.display_name}. A mensagem abrirá uma conversa privada.`
            : `Esta primeira mensagem será um pedido curto para ${person.display_name}. A pessoa decide se aceita; não incluas links.`;
        ui.startLimit.textContent = isConnected ? 'Até 1 200 caracteres.' : 'Até 500 caracteres e sem links.';
        ui.startInput.setAttribute('aria-label', `Mensagem para ${person.display_name}`);
        ui.searchResults.hidden = true;
        ui.dialog.showModal();
        ui.startInput.focus();
    }

    async function sendInitialMessage(event) {
        event.preventDefault();
        if (!selectedPerson) return;
        const submit = ui.startForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const result = await api.post('/direct-messages/start', {
                recipientUserId: String(selectedPerson.id), body: ui.startInput.value
            });
            ui.dialog.close();
            if (result.status === 'request_sent') {
                setStatus('Pedido enviado. A conversa só começa se a pessoa aceitar.', true);
                setTab('requests');
                requestBox = 'outgoing';
                ui.requestBoxes.forEach((button) => button.classList.toggle('is-active', button.dataset.dmRequestBox === requestBox));
                await loadCurrentList();
            } else {
                setStatus('Mensagem enviada.', true);
                setTab('inbox');
                const resultList = await api.request('/direct-messages/conversations?box=inbox');
                const conversation = (resultList.items || []).find((item) => item.id === result.conversationId);
                if (conversation) await openConversation(conversation);
            }
        } catch (error) { setStatus(message(error?.code)); }
        finally { submit.disabled = false; }
    }

    async function submitMessage(event) {
        event.preventDefault();
        const current = selectedConversation;
        const body = ui.messageInput.value;
        const attachment = selectedAttachment;
        if (!current || (!body.trim() && !attachment)) return;
        const submit = ui.composer.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            if (attachment) {
                await api.upload(`/direct-messages/conversations/${current.id}/media`, attachment, {
                    caption: body.trim()
                });
                clearAttachment();
            } else {
                await api.post(`/direct-messages/conversations/${current.id}/messages`, { body });
            }
            ui.messageInput.value = '';
            setStatus('Mensagem enviada.', true);
            await loadMessages();
            await loadCurrentList();
        } catch (error) { setStatus(message(error?.code)); }
        finally { submit.disabled = false; }
    }

    ui.tabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.dmTab)));
    ui.requestBoxes.forEach((button) => button.addEventListener('click', () => {
        requestBox = button.dataset.dmRequestBox;
        ui.requestBoxes.forEach((entry) => entry.classList.toggle('is-active', entry === button));
        void loadCurrentList();
    }));
    ui.searchInput.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => { void runSearch(); }, 250);
    });
    ui.searchForm.addEventListener('submit', (event) => { event.preventDefault(); void runSearch(); });
    ui.startForm.addEventListener('submit', (event) => { void sendInitialMessage(event); });
    ui.startClose.addEventListener('click', () => ui.dialog.close());
    ui.reportForm.addEventListener('submit', (event) => { void submitReport(event); });
    ui.reportClose.addEventListener('click', () => { ui.reportDialog.close(); reportTarget = null; });
    ui.composer.addEventListener('submit', (event) => { void submitMessage(event); });
    ui.mediaInput.addEventListener('change', () => selectAttachment(ui.mediaInput.files?.[0] || null));
    ui.back.addEventListener('click', () => {
        ui.workspace.classList.remove('has-open-conversation');
        selectedConversation = null;
        ui.messageInput.value = '';
        clearAttachment();
    });
    ui.loadOlder.addEventListener('click', () => { void loadOlderMessages(); });
    ui.archive.addEventListener('click', async () => {
        if (!selectedConversation) return;
        const action = view === 'archived' ? 'unarchive' : 'archive';
        try {
            await api.post(`/direct-messages/conversations/${selectedConversation.id}/${action}`, {});
            setStatus(action === 'archive' ? 'Conversa arquivada.' : 'Conversa devolvida à caixa de entrada.', true);
            selectedConversation = null;
            ui.messageInput.value = '';
            clearAttachment();
            ui.workspace.classList.remove('has-open-conversation');
            ui.empty.hidden = false;
            ui.conversationHeading.hidden = true;
            ui.messages.hidden = true;
            ui.composer.hidden = true;
            await loadCurrentList();
        } catch (error) { setStatus(message(error?.code)); }
    });
    ui.mute.addEventListener('click', async () => {
        if (!selectedConversation) return;
        const action = selectedConversation.muted ? 'unmute' : 'mute';
        try {
            await api.post(`/direct-messages/conversations/${selectedConversation.id}/${action}`, {});
            selectedConversation.muted = action === 'mute';
            ui.mute.textContent = selectedConversation.muted ? 'Activar som' : 'Silenciar';
            setStatus(selectedConversation.muted ? 'Notificações da conversa silenciadas.' : 'Notificações activadas.', true);
            await loadCurrentList();
        } catch (error) { setStatus(message(error?.code)); }
    });
    ui.block.addEventListener('click', () => blockPerson(selectedConversation?.peer_id));
    ui.policy.addEventListener('change', async () => {
        try {
            await api.put('/direct-messages/preferences', { requestPolicy: ui.policy.value });
            setStatus('Preferência de contacto actualizada.', true);
        } catch (error) { setStatus(message(error?.code)); }
    });
    ui.blockedToggle.addEventListener('click', async () => {
        const opening = ui.blockedList.hidden;
        ui.blockedList.hidden = !opening;
        ui.blockedToggle.setAttribute('aria-expanded', String(opening));
        if (opening) await loadBlockedPeople();
    });

    void (async () => {
        try {
            const session = await api.currentSession();
            if (!session?.authenticated || !session.user) {
                window.location.replace(new URL('index.html#login', window.location.href).href);
                return;
            }
            sessionUser = session.user;
            const [policy] = await Promise.all([
                api.request('/direct-messages/preferences'), loadCurrentList()
            ]);
            ui.policy.value = policy.requestPolicy || 'requests';
            pollingTimer = window.setInterval(() => {
                if (document.visibilityState === 'hidden') return;
                void loadCurrentList();
                if (selectedConversation) {
                    void loadMessages();
                    void api.post(`/direct-messages/conversations/${selectedConversation.id}/read`, {}).catch(() => undefined);
                }
            }, 25000);
        } catch (error) { setStatus(message(error?.code)); }
    })();

    window.addEventListener('pagehide', () => window.clearInterval(pollingTimer), { once: true });
})();

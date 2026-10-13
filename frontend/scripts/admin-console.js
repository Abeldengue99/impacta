(() => {
    const hostCache = new Map();
    const analyticsState = new Map();


    const auditActionLabels = {
        'project.activity.read': 'Consulta administrativa da actividade dos projectos',
        'announcement.published': 'Anúncio publicado',
        'announcement.create': 'Anúncio criado',
        'announcement.edit': 'Anúncio editado',
        'announcement.remove': 'Anúncio eliminado',
        'promotion.image.upload': 'Imagem de aviso ou anúncio enviada',
        'promotion.image.remove': 'Imagem de aviso ou anúncio removida',
        'account_verification_approved': 'Verificação de conta aprovada',
        'account_verification_rejected': 'Verificação de conta recusada',
        'account_verification_revoked': 'Verificação de conta revogada',
        'user.close': 'Conta encerrada',
        'user.role.grant': 'Função atribuída à conta',
        'user.role.revoke': 'Função retirada da conta',
        'recognition.points.adjust': 'Pontuação de reconhecimento ajustada',
        'recognition.badge.create': 'Distintivo criado',
        'recognition.badge.award': 'Distintivo atribuído',
        'settings.homepage_notice.update': 'Aviso da página inicial actualizado',
        'challenge.create': 'Desafio criado',
        'session.revoke': 'Sessão encerrada',
        'community.chat.read': 'Conversa da comunidade consultada pela administração',
        'community.chat.locked': 'Conversa da comunidade bloqueada',
        'community.chat.unlocked': 'Conversa da comunidade desbloqueada',
        'community.message.moderate': 'Mensagem da comunidade moderada',
        'community.member.approved': 'Pedido para entrar na comunidade aprovado',
        'community.member.rejected': 'Pedido para entrar na comunidade recusado',
        'community.media.approve': 'Anexo da comunidade aprovado',
        'community.media.remove': 'Anexo da comunidade removido',
        'feed.post.approve': 'Publicação aprovada',
        'feed.post.remove': 'Publicação removida',
        'announcement.report.csv': 'Relatório do anúncio descarregado em CSV',
        'announcement.report.xlsx': 'Relatório do anúncio descarregado em Excel',
        'community.report.dismiss': 'Denúncia sobre comunidade arquivada',
        'community.report.resolve': 'Denúncia sobre comunidade resolvida',
        'community.report.approve': 'Denúncia sobre comunidade analisada',
        'community.report.reject': 'Denúncia sobre comunidade recusada',
        'content.approve': 'Conteúdo aprovado',
        'content.remove': 'Conteúdo removido',
        'content.dismiss': 'Denúncia de conteúdo arquivada',
        'feed.post.hide': 'Publicação ocultada',
        'feed.post.restore': 'Publicação restaurada',
        'suspend_user': 'Conta suspensa',
        'restore_user': 'Conta reactivada',
        'hide_content': 'Conteúdo ocultado',
        'remove_content': 'Conteúdo removido',
        'restore_content': 'Conteúdo restaurado',
        'content.hide': 'Conteúdo ocultado'
    };

    const auditEntityLabels = {
        user: 'Conta', account: 'Conta', announcement: 'Anúncio', media: 'Ficheiro',
        project: 'Projecto', community: 'Comunidade', community_message: 'Mensagem da comunidade',
        community_member: 'Membro da comunidade', post: 'Publicação', challenge: 'Desafio',
        badge: 'Distintivo', privacy_request: 'Pedido de privacidade', session: 'Sessão',
        platform_setting: 'Configuração da plataforma', account_verification_request: 'Pedido de verificação',
        content: 'Conteúdo', report: 'Denúncia'
    };

    const auditTokenLabels = {
        account: 'conta', verification: 'verificação', approved: 'aprovada', rejected: 'recusada', revoked: 'revogada',
        user: 'conta', active: 'activa', suspended: 'suspensa', close: 'encerrada', role: 'função', grant: 'atribuída',
        revoke: 'retirada', recognition: 'reconhecimento', points: 'pontuação', adjust: 'ajustada', badge: 'distintivo',
        create: 'criado', award: 'atribuído', settings: 'configurações', homepage: 'página inicial', notice: 'aviso',
        update: 'actualizado', announcement: 'anúncio', published: 'publicado', edit: 'editado', remove: 'removido',
        promotion: 'divulgação', image: 'imagem', upload: 'enviada', project: 'projecto', activity: 'actividade',
        community: 'comunidade', chat: 'conversa', locked: 'bloqueada', unlocked: 'desbloqueada', message: 'mensagem',
        moderate: 'moderada', member: 'membro', approve: 'aprovado', media: 'anexo', feed: 'publicação', post: 'publicação',
        report: 'denúncia', dismiss: 'arquivada', resolve: 'resolvida', content: 'conteúdo', challenge: 'desafio',
        open: 'aberto', closed: 'encerrado', pending: 'pendente', completed: 'concluído', archived: 'arquivado',
        draft: 'rascunho', scheduled: 'agendado', published_status: 'publicado', privacy: 'privacidade', reviewing: 'em análise',
        waiting_user: 'à espera do utilizador', received: 'recebido', session: 'sessão', download: 'descarregado',
        csv: 'CSV', xlsx: 'Excel', read: 'consultada'
    };

    function auditActionLabel(code) {
        const value = String(code || '').trim();
        if (auditActionLabels[value]) return auditActionLabels[value];
        const parts = value.toLowerCase().split(/[._-]+/).filter(Boolean);
        if (parts.length === 2 && ['active', 'suspended', 'closed', 'pending', 'approved', 'rejected'].includes(parts[1])) {
            const entity = auditEntityLabels[parts[0]] || auditTokenLabels[parts[0]];
            const status = auditTokenLabels[parts[1]];
            if (entity && status) return entity + ' — ' + status;
        }
        if (parts.length >= 2 && ['community', 'project', 'announcement', 'challenge', 'privacy'].includes(parts[0])) {
            const entity = auditEntityLabels[parts[0]] || auditTokenLabels[parts[0]];
            const status = auditTokenLabels[parts[parts.length - 1]];
            if (entity && status) return 'Estado do ' + entity.toLowerCase() + ' actualizado: ' + status;
        }
        const translated = parts.map((part) => auditTokenLabels[part]).filter(Boolean);
        return translated.length === parts.length && translated.length
            ? translated.join(' ').replace(/^./, (letter) => letter.toUpperCase())
            : 'Acção administrativa registada';
    }

    function auditTargetLabel(type, id) {
        const entityType = String(type || '').toLowerCase();
        const label = auditEntityLabels[entityType] || 'Registo';
        const targetId = String(id || '').trim();
        if (!targetId) return label;
        if (entityType === 'platform_setting' && targetId === 'homepage.notice') return label + ': aviso da página inicial';
        return label + ' ' + targetId;
    }

    function auditReasonLabel(reason) {
        const value = String(reason || '').trim();
        if (!value) return '';
        const separator = value.indexOf(':');
        if (separator > 0) {
            const placement = value.slice(0, separator).trim().toLowerCase();
            const placementLabels = { notice: 'Aviso', announcement: 'Novidade da comunidade', advertisement: 'Publicidade' };
            if (placementLabels[placement]) return placementLabels[placement] + ': ' + (value.slice(separator + 1).trim() || 'sem título');
        }
        const roleLabels = { community_manager: 'Gestor da comunidade', platform_admin: 'Administrador da plataforma', moderator: 'Moderador' };
        return Object.entries(roleLabels).reduce((text, [key, label]) => text.split(key).join(label), value);
    }


    function localizedStatus(value) {
        const labels = { active: 'Activo', inactive: 'Inactivo', pending: 'Pendente', review: 'Em revisão', approved: 'Aprovado', rejected: 'Recusado', suspended: 'Suspenso', closed: 'Encerrado', open: 'Aberto', archived: 'Arquivado', completed: 'Concluído', published: 'Publicado', scheduled: 'Agendado', draft: 'Rascunho', expired: 'Expirado', deleted: 'Eliminado', removed: 'Removido', hidden: 'Oculto', received: 'Recebido', reviewing: 'Em análise', waiting_user: 'À espera do utilizador', resolved: 'Resolvido', dismissed: 'Arquivado', paused: 'Pausado', locked: 'Bloqueado', unlocked: 'Desbloqueado', flagged: 'Sinalizado', revoked: 'Revogado' };
        return labels[String(value || '').toLowerCase()] || 'Estado não identificado';
    }

    function localizedRole(value) {
        const labels = { platform_admin: 'Administrador da plataforma', super_admin: 'Administrador principal', support: 'Apoio', moderator: 'Moderador', community_manager: 'Gestor da comunidade', project_manager: 'Gestor do projecto', participant: 'Participante', member: 'Membro' };
        return labels[String(value || '').toLowerCase()] || 'Função adicional';
    }

    function localizedPrivacyRequest(value) {
        const labels = { access: 'Acesso aos dados', correction: 'Correcção de dados', export: 'Exportação de dados', closure: 'Encerramento da conta' };
        return labels[String(value || '').toLowerCase()] || 'Pedido de privacidade';
    }

    function node(tag, className = '', content = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (content !== undefined && content !== null) element.textContent = String(content);
        return element;
    }

    function moduleHost(name) {
        if (hostCache.has(name)) return hostCache.get(name);
        const view = document.querySelector(`[data-admin-view="${name}"]`);
        if (!view) return null;
        view.querySelectorAll('.admin-module-grid, .admin-locked-state').forEach((item) => item.remove());
        const host = node('div', 'admin-live-module');
        host.dataset.adminModuleHost = name;
        view.append(host);
        ensureAnalyticsHost(name, view, host);
        hostCache.set(name, host);
        return host;
    }

    function ensureAnalyticsHost(name, view = document.querySelector(`[data-admin-view="${name}"]`), anchor = null) {
        if (!view) return null;
        let host = view.querySelector(`[data-admin-analytics="${name}"]`);
        if (!host) {
            host = node('section', 'admin-screen-analytics');
            host.dataset.adminAnalytics = name;
            host.setAttribute('aria-label', 'Gráficos e métricas desta secção');
            const insertionPoint = anchor || view.querySelector('.admin-live-module, [data-account-verification-list], [data-feed-review-list], [data-report-list], [data-proposal-list], .admin-report-toolbar, .admin-proposal-toolbar, .admin-overview-grid');
            if (insertionPoint) view.insertBefore(host, insertionPoint);
            else view.append(host);
        }
        return host;
    }

    function resetAnalytics(name) {
        analyticsState.set(name, { groups: new Map(), unavailable: new Set() });
        const host = ensureAnalyticsHost(name);
        if (host) renderAnalytics(name);
    }

    function setAnalyticsData(name, label, items, options = {}) {
        const state = analyticsState.get(name) || { groups: new Map(), unavailable: new Set() };
        const rows = Array.isArray(items) ? items : [];
        state.groups.set(label, {
            label,
            items: rows,
            value: Number.isFinite(options.value) ? options.value : rows.length,
            metric: Number.isFinite(options.value),
            timelineOnly: options.timelineOnly === true,
            valueField: options.valueField || ''
        });
        if (options.unavailable) state.unavailable.add(options.unavailable);
        analyticsState.set(name, state);
        renderAnalytics(name);
    }

    function setAnalyticsUnavailable(name, label) {
        const state = analyticsState.get(name) || { groups: new Map(), unavailable: new Set() };
        state.unavailable.add(label || 'Uma fonte de dados desta secção está indisponível.');
        analyticsState.set(name, state);
        renderAnalytics(name);
    }

    function analyticsDate(item) {
        const keys = ['created_at', 'occurred_at', 'latest_report_at', 'last_seen_at', 'last_seen', 'updated_at', 'proof_confirmed_at'];
        for (const key of keys) {
            if (item?.[key]) {
                const date = new Date(item[key]);
                if (!Number.isNaN(date.getTime())) return date;
            }
        }
        return null;
    }

    function chartPanel(kicker, title, className = '') {
        const panel = node('article', `admin-panel admin-screen-chart ${className}`.trim());
        const heading = node('div', 'admin-panel-heading');
        const copy = node('div');
        copy.append(node('p', 'admin-eyebrow', kicker), node('h3', '', title));
        heading.append(copy, node('span', 'admin-chart-orbit', '✳'));
        panel.append(heading);
        return panel;
    }

    function renderAnalytics(name) {
        const host = ensureAnalyticsHost(name);
        if (!host) return;
        const state = analyticsState.get(name) || { groups: new Map(), unavailable: new Set() };
        const groups = [...state.groups.values()];
        const rows = groups.flatMap((group) => group.items);
        const distributionGroups = groups.filter((group) => !group.timelineOnly);
        const total = distributionGroups.reduce((sum, group) => sum + group.value, 0);
        const unavailable = [...state.unavailable];
        const distribution = new Map();
        const distributionRows = distributionGroups.flatMap((group) => group.items);
        const statusRows = distributionRows.filter((item) => item && (item.status || item.state || item.status_code));
        if (statusRows.length) {
            statusRows.forEach((item) => {
                const key = localizedStatus(item.status || item.state || item.status_code);
                distribution.set(key, (distribution.get(key) || 0) + 1);
            });
        } else {
            distributionGroups.forEach((group) => distribution.set(group.label, group.value));
        }
        const palette = ['#197653', '#74b990', '#e7b353', '#6386c4', '#bd765e', '#947cc1', '#97a79b'];
        const panels = node('div', 'admin-screen-chart-grid');
        const distributionPanel = chartPanel('DISTRIBUIÇÃO', 'Estado e composição');
        const distributionBody = node('div', 'admin-screen-chart-body');
        if (distribution.size && total > 0) {
            const entries = [...distribution.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
            const sum = entries.reduce((value, [, count]) => value + count, 0);
            let cursor = 0;
            const segments = entries.map(([, count], index) => {
                const start = cursor;
                cursor += count / sum * 100;
                return `${palette[index % palette.length]} ${start}% ${cursor}%`;
            });
            const donutArea = node('div', 'admin-donut-area');
            const donut = node('div', 'admin-donut');
            donut.style.setProperty('--admin-donut-stops', segments.join(', '));
            donut.setAttribute('role', 'img');
            donut.setAttribute('aria-label', `${sum} registos distribuídos por ${entries.length} categorias`);
            donut.append(node('span', '', sum.toLocaleString('pt-AO')));
            const legend = node('div', 'admin-donut-legend');
            entries.slice(0, 6).forEach(([label, value], index) => {
                const item = node('div', 'admin-donut-legend-item');
                const marker = node('i');
                marker.style.background = palette[index % palette.length];
                item.append(marker, node('span', '', label), node('strong', '', value.toLocaleString('pt-AO')));
                legend.append(item);
            });
            donutArea.append(donut, legend);
            distributionBody.append(donutArea, node('p', 'admin-chart-footnote', distributionGroups.some((group) => group.metric)
                ? 'Indicadores agregados devolvidos pela API autorizada.'
                : `${sum.toLocaleString('pt-AO')} registos nesta consulta autorizada.`));
        } else {
            distributionBody.append(node('p', 'admin-chart-empty', unavailable.length ? 'A distribuição aguarda permissão para consultar os dados.' : 'Ainda não há registos disponíveis para distribuir.'));
        }
        distributionPanel.append(distributionBody);

        const activityPanel = chartPanel('MOVIMENTO', 'Atividade recente');
        const activityBody = node('div', 'admin-screen-chart-body');
        const bins = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            return { date, label: date.toLocaleDateString('pt-AO', { weekday: 'short' }).replace('.', ''), value: 0 };
        });
        let datedRecords = 0;
        let dated = 0;
        groups.forEach((group) => group.items.forEach((item) => {
            const date = analyticsDate(item);
            if (!date) return;
            date.setHours(0, 0, 0, 0);
            const index = bins.findIndex((bin) => bin.date.getTime() === date.getTime());
            if (index >= 0) {
                const amount = group.valueField ? Math.max(0, Number(item[group.valueField]) || 0) : 1;
                bins[index].value += amount;
                dated += amount;
                datedRecords += 1;
            }
        }));
        const activityGroups = groups.filter((group) => !group.timelineOnly);
        if (!datedRecords && activityGroups.length) {
            activityPanel.querySelector('.admin-panel-heading h3').textContent = 'Volume por conjunto';
            activityPanel.querySelector('.admin-eyebrow').textContent = 'DISTRIBUIÇÃO';
        }
        if (datedRecords) {
            const maximum = Math.max(1, ...bins.map((bin) => bin.value));
            const chart = node('div', 'admin-week-chart');
            bins.forEach((bin, index) => {
                const column = node('div', 'admin-week-column');
                const value = node('span', 'admin-week-value', bin.value ? bin.value.toLocaleString('pt-AO') : '');
                const track = node('div', 'admin-week-track');
                const bar = node('span', 'admin-week-bar');
                bar.style.setProperty('--admin-bar-height', `${Math.max(bin.value ? 8 : 0, bin.value / maximum * 100)}%`);
                bar.style.setProperty('--admin-bar-delay', `${index * 55}ms`);
                track.append(bar);
                column.append(value, track, node('small', '', bin.label));
                chart.append(column);
            });
            activityBody.append(chart, node('p', 'admin-chart-footnote', groups.some((group) => group.valueField)
                ? `${dated.toLocaleString('pt-AO')} acções nos últimos 7 dias, somadas a partir dos indicadores carregados.`
                : `${dated.toLocaleString('pt-AO')} registos nesta lista nos últimos 7 dias.`));
        } else if (activityGroups.length) {
            const chart = node('div', 'admin-horizontal-chart');
            const maximum = Math.max(1, ...activityGroups.map((group) => group.value));
            activityGroups.slice(0, 6).forEach((group, index) => {
                const row = node('div', 'admin-horizontal-row');
                const label = node('div', 'admin-horizontal-label');
                label.append(node('span', '', group.label), node('strong', '', group.value.toLocaleString('pt-AO')));
                const track = node('div', 'admin-week-track admin-horizontal-track');
                const bar = node('span', 'admin-week-bar');
                bar.style.setProperty('--admin-bar-height', `${group.value / maximum * 100}%`);
                bar.style.setProperty('--admin-bar-delay', `${index * 55}ms`);
                track.append(bar);
                row.append(label, track);
                chart.append(row);
            });
            activityBody.append(chart, node('p', 'admin-chart-footnote', 'Volume por conjunto de registos carregados.'));
        } else {
            activityBody.append(node('p', 'admin-chart-empty', unavailable.length ? 'A atividade aguarda permissão para consultar os dados.' : 'Ainda não há atividade neste período.'));
        }
        activityPanel.append(activityBody);
        panels.append(distributionPanel, activityPanel);
        host.replaceChildren(panels);
        if (unavailable.length) {
            host.append(node('p', 'admin-chart-access-note', `Vista parcial: ${unavailable.join(' · ')}`));
        }
    }

    function setFooter(text, warning = false) {
        const footerStatus = document.querySelector('#admin-footer-status');
        if (!footerStatus) return;
        footerStatus.textContent = text;
        footerStatus.classList.toggle('is-warning', warning);
    }

    function statusNode(parent, message, variant = '') {
        const status = node('p', `admin-live-status${variant ? ` is-${variant}` : ''}`, message);
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        parent.append(status);
        return status;
    }

    function actionButton(label, callback, className = 'admin-action-button') {
        const button = node('button', className, label);
        button.type = 'button';
        button.addEventListener('click', callback);
        return button;
    }

    function field(labelText, name, options = {}) {
        const label = node('label', 'admin-tool-field', labelText);
        const control = options.multiline ? node('textarea', 'admin-tool-control') : node('input', 'admin-tool-control');
        control.name = name;
        control.required = options.required !== false;
        if (options.multiline) control.rows = options.rows || 3;
        else control.type = options.type || 'text';
        if (options.placeholder) control.placeholder = options.placeholder;
        if (options.maxLength) control.maxLength = options.maxLength;
        if (options.min !== undefined) control.min = String(options.min);
        if (options.max !== undefined) control.max = String(options.max);
        label.append(control);
        return { label, control };
    }

    function promotionImageField(labelText, initialUrl = '') {
        const label = node('label', 'admin-tool-field admin-promotion-image-field', labelText);
        const control = node('input', 'admin-tool-control');
        control.type = 'file';
        control.accept = 'image/jpeg,image/png,image/webp';
        const preview = node('img', 'admin-promotion-image-preview');
        preview.alt = 'Pré-visualização da imagem';
        preview.hidden = true;
        let objectUrl = '';
        const setPreview = (url) => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = url.startsWith('blob:') ? url : '';
            if (url) preview.src = url;
            else preview.removeAttribute('src');
            preview.hidden = !url;
        };
        if (initialUrl && window.ImpactaAPI) setPreview(window.ImpactaAPI.assetUrl(initialUrl));
        control.addEventListener('change', () => {
            const file = control.files?.[0];
            if (!file) return;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
                control.value = '';
                setPreview('');
                return;
            }
            setPreview(URL.createObjectURL(file));
        });
        label.append(control, preview);
        return { label, control, preview, setPreview };
    }

    async function uploadPromotionImage(file) {
        if (!file) return null;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
            throw Object.assign(new Error('invalid_promotion_image'), { code: 'invalid_promotion_image' });
        }
        return window.ImpactaAPI.upload('/admin/promotions/media', file);
    }

    async function removeUnusedPromotionImage(mediaId) {
        if (!mediaId) return;
        try { await window.ImpactaAPI.delete(`/admin/promotions/media/${encodeURIComponent(mediaId)}`); }
        catch { /* A API preserva a imagem se outra publicação ainda a utilizar. */ }
    }

    function selectField(labelText, name, choices, required = true) {
        const label = node('label', 'admin-tool-field', labelText);
        const select = node('select', 'admin-tool-control');
        select.name = name;
        select.required = required;
        choices.forEach(([value, title]) => {
            const option = node('option', '', title);
            option.value = value;
            select.append(option);
        });
        label.append(select);
        return { label, control: select };
    }

    function formShell(title) {
        const form = node('form', 'admin-tool-form');
        form.append(node('h3', '', title));
        return form;
    }

    function cardList(host) {
        const list = node('div', 'admin-tool-list');
        host.append(list);
        return list;
    }

    function empty(list, message) {
        list.replaceChildren(node('p', 'admin-tool-empty', message));
    }

    function readableError(error, fallback) {
        const messages = {
            backup_unavailable: 'O backup não está disponível. Confirma a instalação ou configuração de pg_dump.',
            backup_reason_required: 'Indica um motivo com pelo menos 5 caracteres para o backup.',
            invalid_maintenance_settings: 'Revê o estado e a mensagem de manutenção.',
            authentication_required: 'A sessão terminou. Inicia sessão novamente.',
            permission_required: 'A tua conta não tem permissão para esta operação.',
              administrative_access_unavailable: 'Não foi possível confirmar as permissões administrativas. Tenta novamente mais tarde.',
              verification_request_already_reviewed: 'Este pedido já foi analisado. Actualiza a fila.',
              invalid_verification_decision: 'Indica uma decisão e um motivo válido para este pedido.',
            protected_admin: 'Esta conta administrativa está protegida contra suspensão.',
            user_unavailable: 'A conta já não está disponível para esta operação.',
            admin_actions_migration_required: 'Aplica a migração 20261012-admin-account-close-and-announcement-edit.sql como proprietário da base de dados para activar estas acções.',
            invalid_user_date_range: 'Escolhe um intervalo válido; a data inicial não pode ser posterior à data final.',
            invalid_user_close_request: 'Indica um motivo válido, com pelo menos 5 caracteres, para encerrar a conta.',
            cannot_close_own_account: 'Não podes encerrar a conta da sessão administrativa atual.',
            user_has_active_responsibilities: 'Transfere primeiro a responsabilidade desta conta por comunidades e projectos activos.',
            already_assigned: 'Esta função já está atribuída nesse âmbito.',
            session_unavailable: 'A sessão já foi revogada ou não está disponível.',
            invalid_homepage_notice: 'O aviso deve ter até 240 caracteres.',
            invalid_promotion_image: 'Escolhe uma imagem JPEG, PNG ou WebP com até 12 MB.',
            announcement_optional_copy_migration_required: 'O banco ainda exige título e mensagem. A migração de destaques opcionais precisa ser aplicada pelo administrador da base de dados.',
            announcement_image_required: 'Escolhe a imagem obrigatória do destaque.',
            announcement_date_required: 'Indica a data e hora de publicação.',
            announcement_date_in_future: 'Para publicar agora, escolhe uma data que não esteja no futuro.',
            announcement_schedule_must_be_future: 'Para agendar, escolhe uma data e hora futuras.',
            unsupported_promotion_image_type: 'Usa uma imagem JPEG, PNG ou WebP.',
            promotion_image_too_large: 'A imagem excede o limite permitido de 12 MB.',
            media_storage_unavailable: 'Não foi possível guardar a imagem no servidor. Tenta novamente.',
            report_already_reviewed: 'Esta denúncia já foi tratada. Actualiza a fila.',
            report_not_found: 'Esta denúncia já não está disponível. Actualiza a fila.',
            message_not_found: 'A mensagem já foi removida ou não está disponível.',
            community_not_found: 'A comunidade já não está disponível.',
            invalid_community_report_decision: 'Escolhe uma decisão e regista o motivo.',
            invalid_report_action: 'Esta decisão não se aplica ao conteúdo denunciado.',
            mfa_required: 'Confirma o segundo factor para rever conteúdo privado de grupos.',
            promotion_image_unavailable: 'A imagem não está disponível. Escolhe outra e tenta novamente.',
            invalid_announcement: 'Confirma o título, o texto, o tipo e a ligação do destaque.',
            invalid_announcement_report_period: 'Escolhe um período válido, com no máximo 367 dias.',
            active_project_required: 'Escolhe um projecto activo.',
            announcement_date_required: 'Define a data de publicação para agendar o anúncio.',
            badge_code_exists: 'Já existe um distintivo com esse código.'
        };
        return messages[error?.code] || fallback;
    }

    function showFailure(host, error, fallback) {
        const message = readableError(error, fallback);
        statusNode(host, message, 'warning');
        if (host?.dataset?.adminModuleHost) setAnalyticsUnavailable(host.dataset.adminModuleHost, 'A API não autorizou ou não conseguiu carregar esta fonte.');
        setFooter('A API recusou ou não concluiu uma operação.', true);
    }

    function renderOverviewCharts(data) {
        const trendHost = document.querySelector('[data-admin-trend-chart]');
        if (trendHost) {
            const trend = Array.isArray(data.trend) ? data.trend : [];
            if (!trend.length) {
                trendHost.replaceChildren(node('p', 'admin-chart-empty', 'Ainda não há actividade para representar.'));
            } else {
                const svgNs = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNs, 'svg');
                svg.setAttribute('viewBox', '0 0 680 250');
                svg.setAttribute('preserveAspectRatio', 'none');
                svg.setAttribute('role', 'img');
                svg.setAttribute('aria-label', 'Gráfico diário de novas contas, publicações e acções administrativas nos últimos sete dias');
                svg.classList.add('admin-trend-svg');
                const maxValue = Math.max(1, ...trend.flatMap((day) => [Number(day.registrations), Number(day.publications), Number(day.admin_actions)]));
                const maxTick = Math.max(4, Math.ceil(maxValue / 4) * 4);
                const left = 42; const right = 664; const top = 24; const bottom = 194;
                for (let tick = 0; tick <= 4; tick += 1) {
                    const y = bottom - ((bottom - top) / 4) * tick;
                    const line = document.createElementNS(svgNs, 'line');
                    line.setAttribute('x1', String(left)); line.setAttribute('x2', String(right));
                    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
                    line.classList.add('admin-chart-gridline'); svg.append(line);
                    const label = document.createElementNS(svgNs, 'text');
                    label.setAttribute('x', '29'); label.setAttribute('y', String(y + 4));
                    label.setAttribute('text-anchor', 'end'); label.classList.add('admin-chart-axis-label');
                    label.textContent = String(Math.round(maxTick * tick / 4)); svg.append(label);
                }
                const series = [
                    { key: 'registrations', label: 'Novas contas', className: 'is-accounts' },
                    { key: 'publications', label: 'Publicações', className: 'is-posts' },
                    { key: 'admin_actions', label: 'Acções administrativas', className: 'is-admin-actions' }
                ];
                const pointsFor = (key) => trend.map((day, index) => {
                    const x = trend.length === 1 ? (left + right) / 2 : left + (right - left) * index / (trend.length - 1);
                    const y = bottom - (bottom - top) * Math.min(maxTick, Number(day[key]) || 0) / maxTick;
                    return { x, y, value: Number(day[key]) || 0, day: day.day };
                });
                series.forEach((item) => {
                    const points = pointsFor(item.key);
                    const line = document.createElementNS(svgNs, 'polyline');
                    line.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
                    line.classList.add('admin-chart-line', item.className); svg.append(line);
                    points.forEach((point) => {
                        const circle = document.createElementNS(svgNs, 'circle');
                        circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y));
                        circle.setAttribute('r', '4'); circle.classList.add('admin-chart-point', item.className);
                        const title = document.createElementNS(svgNs, 'title');
                        title.textContent = `${item.label}: ${point.value} · ${new Date(`${point.day}T00:00:00`).toLocaleDateString('pt-AO')}`;
                        circle.append(title); svg.append(circle);
                    });
                });
                trend.forEach((day, index) => {
                    const x = trend.length === 1 ? (left + right) / 2 : left + (right - left) * index / (trend.length - 1);
                    const label = document.createElementNS(svgNs, 'text');
                    label.setAttribute('x', String(x)); label.setAttribute('y', '222');
                    label.setAttribute('text-anchor', 'middle'); label.classList.add('admin-chart-axis-label');
                    label.textContent = new Date(`${day.day}T00:00:00`).toLocaleDateString('pt-AO', { weekday: 'short' }).replace('.', '');
                    svg.append(label);
                });
                const legend = node('div', 'admin-chart-legend');
                series.forEach((item) => {
                    const entry = node('span', `admin-chart-legend-item ${item.className}`, item.label);
                    legend.append(entry);
                });
                trendHost.replaceChildren(svg, legend);
            }
        }

        const statusHost = document.querySelector('[data-admin-status-chart]');
        if (statusHost) {
            const groups = [
                { key: 'users', label: 'Contas de utilizador' },
                { key: 'communities', label: 'Comunidades' },
                { key: 'projects', label: 'Projectos' },
                { key: 'posts', label: 'Publica\u00e7\u00f5es' }
            ];
            const statusOrder = ['pending', 'review', 'draft', 'active', 'published', 'completed', 'suspended', 'hidden', 'rejected', 'removed', 'deleted', 'archived', 'closed'];
            const statusLabels = {
                pending: 'Pendente', review: 'Em revis\u00e3o', draft: 'Rascunho', active: 'Activo', published: 'Publicado',
                completed: 'Conclu\u00eddo', suspended: 'Suspenso', hidden: 'Oculto', rejected: 'Rejeitado', removed: 'Removido',
                deleted: 'Eliminado', archived: 'Arquivado', closed: 'Encerrado'
            };
            const colorByStatus = {
                pending: 'is-pending', review: 'is-review', draft: 'is-draft', active: 'is-active', published: 'is-published',
                completed: 'is-completed', suspended: 'is-suspended', hidden: 'is-hidden', rejected: 'is-rejected',
                removed: 'is-removed', deleted: 'is-deleted', archived: 'is-archived', closed: 'is-closed'
            };
            const summary = Array.isArray(data.statusSummary) ? data.statusSummary : [];
            const chart = node('div', 'admin-status-bars');
            const legendStatuses = new Set();
            groups.forEach((group) => {
                const entries = summary
                    .filter((item) => item.entity === group.key)
                    .map((item) => ({ status: item.status, value: Math.max(0, Number(item.value) || 0) }))
                    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
                const total = entries.reduce((sum, item) => sum + item.value, 0);
                const row = node('div', 'admin-status-bar-row');
                const heading = node('div', 'admin-status-bar-heading');
                heading.append(node('span', '', group.label), node('strong', '', total.toLocaleString('pt-AO')));
                const track = node('div', 'admin-status-bar-track');
                track.setAttribute('role', 'img');
                track.setAttribute('aria-label', group.label + ': ' + (entries.map((item) => (statusLabels[item.status] || localizedStatus(item.status)) + ', ' + item.value).join('; ') || 'sem registos'));
                entries.forEach((item) => {
                    legendStatuses.add(item.status);
                    const segment = node('span', 'admin-status-bar-fill ' + (colorByStatus[item.status] || 'is-other'));
                    segment.style.width = total ? (item.value / total * 100) + '%' : '0%';
                    segment.title = (statusLabels[item.status] || localizedStatus(item.status)) + ': ' + item.value;
                    segment.setAttribute('aria-hidden', 'true');
                    track.append(segment);
                });
                row.append(heading, track);
                chart.append(row);
            });
            const legend = node('div', 'admin-status-legend');
            statusOrder.filter((status) => legendStatuses.has(status)).forEach((status) => {
                legend.append(node('span', 'admin-status-legend-item ' + (colorByStatus[status] || 'is-other'), statusLabels[status] || localizedStatus(status)));
            });
            statusHost.replaceChildren(chart, legend, node('p', 'admin-chart-footnote', 'Distribui\u00e7\u00e3o de todos os registos por estado \u00b7 actualizada ao abrir esta sec\u00e7\u00e3o.'));
        }
    }

    async function loadOverview() {
        const host = moduleHost('overview');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('overview');
        host.replaceChildren();
        const toolbar = node('div', 'admin-module-toolbar');
        const status = statusNode(toolbar, 'A carregar indicadores da base de dados…');
        toolbar.append(actionButton('Actualizar indicadores da plataforma', () => void loadOverview(), 'admin-refresh-button'));
        host.append(toolbar);
        try {
            const data = await window.ImpactaAPI.request('/admin/overview');
            renderOverviewCharts(data);
            setAnalyticsData('overview', 'Contas ativas', [], { value: Number(data.active_users) || 0 });
            setAnalyticsData('overview', 'Comunidades ativas', [], { value: Number(data.active_communities) || 0 });
            setAnalyticsData('overview', 'Projectos ativos', [], { value: Number(data.active_projects) || 0 });
            setAnalyticsData('overview', 'Pendentes de revisão', [], { value: (Number(data.pending_projects) || 0) + (Number(data.pending_communities) || 0) });
            const trendRows = (Array.isArray(data.trend) ? data.trend : []).map((day) => ({
                occurred_at: day.day,
                total: (Number(day.registrations) || 0) + (Number(day.publications) || 0) + (Number(day.admin_actions) || 0)
            }));
            setAnalyticsData('overview', 'Movimento diário', trendRows, { timelineOnly: true, valueField: 'total' });
            const values = [data.active_users, data.active_projects, null, data.open_privacy_requests, data.pending_verifications];
            document.querySelectorAll('.admin-stat-card').forEach((card, index) => {
                const strong = card.querySelector('strong');
                const small = card.querySelector('small');
                if (strong && values[index] !== null) strong.textContent = String(values[index] ?? 0);
                if (small && index === 0) small.textContent = 'Contas ativas';
                if (small && index === 1) small.textContent = `${data.pending_projects ?? 0} aguardam revisão`;
                if (small && index === 3) small.textContent = 'Recebidos, em análise ou à espera do utilizador';
                  if (small && index === 4) small.textContent = 'Aguardam confirmação de identidade';
            });
            const period = document.querySelector('.admin-period-label');
            if (period) period.textContent = `Actualizado às ${new Date().toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}`;
            const activityPanel = document.querySelector('.admin-activity-panel .admin-empty-state');
            if (activityPanel) {
                activityPanel.replaceChildren(node('strong', '', 'Atividade recente'), node('p', '', 'As últimas decisões registadas na auditoria.'));
                const list = node('div', 'admin-tool-list');
                (Array.isArray(data.activity) ? data.activity : []).forEach((item) => {
                    const row = node('article', 'admin-tool-card');
                    row.append(node('strong', '', auditActionLabel(item.action_code)), node('p', '', `${item.actor_name || 'Conta indisponível'} · ${auditTargetLabel(item.target_type, item.target_id)}`));
                    const reason = auditReasonLabel(item.reason);
                    if (reason) row.append(node('small', '', reason));
                    list.append(row);
                });
                if (!data.activity?.length) list.append(node('p', 'admin-tool-empty', 'Ainda não há acções administrativas registadas.'));
                activityPanel.append(list);
            }
            status.textContent = `Comunidades ativas: ${data.active_communities ?? 0} · ${data.pending_communities ?? 0} pendentes.`;
            setFooter('API ligada · indicadores obtidos da base de dados.');
        } catch (error) {
            status.textContent = readableError(error, 'Não foi possível carregar os indicadores.');
            status.classList.add('is-warning');
            setAnalyticsUnavailable('overview', 'Os indicadores da plataforma estão restritos ou indisponíveis.');
            setFooter('Ligação administrativa indisponível.', true);
        }
    }

    function luandaDateKey(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Luanda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
        const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
        return value.year + '-' + value.month + '-' + value.day;
    }

    function shiftDateKey(value, days) {
        const [year, month, day] = value.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
    }

    function userRegistrationRange(period, fromValue, toValue) {
        const today = luandaDateKey();
        let from = '';
        let to = '';
        if (period === 'today') from = to = today;
        else if (period === 'last7') { from = shiftDateKey(today, -6); to = today; }
        else if (period === 'last30') { from = shiftDateKey(today, -29); to = today; }
        else if (period === 'month') { from = today.slice(0, 7) + '-01'; to = today; }
        else if (period === 'year') { from = today.slice(0, 4) + '-01-01'; to = today; }
        else if (period === 'custom') { from = fromValue || ''; to = toValue || ''; }
        if (period === 'custom' && !from && !to) return null;
        if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) return null;
        return { from, to };
    }

    function renderUserRegistrationSummary(host, metrics = {}) {
        const entries = [
            ['Registos no período', metrics.period_total, 'Corresponde aos filtros aplicados'],
            ['Hoje', metrics.today, 'Novas contas de hoje'],
            ['Este mês', metrics.this_month, 'Novas contas do mês actual'],
            ['Este ano', metrics.this_year, 'Novas contas do ano actual'],
            ['Total histórico', metrics.all_time, 'Contas que correspondem à pesquisa']
        ];
        host.replaceChildren();
        entries.forEach(([label, value, note]) => {
            const card = node('article', 'admin-stat-card');
            card.append(node('span', '', label), node('strong', '', (Number(value) || 0).toLocaleString('pt-AO')), node('small', '', note));
            host.append(card);
        });
    }

    async function loadUsers() {
        const host = moduleHost('users');
        if (!host || !window.ImpactaAPI) return;
        host.replaceChildren();
        const searchForm = formShell('Pesquisar e filtrar inscrições');
        searchForm.classList.add('admin-user-filter-form');
        const search = field('Nome ou e-mail', 'search', { required: false, placeholder: 'Pesquisar utilizadores...', maxLength: 100 });
        const period = selectField('Período de registo', 'period', [
            ['all', 'Todo o histórico'], ['today', 'Hoje'], ['last7', 'Últimos 7 dias'],
            ['last30', 'Últimos 30 dias'], ['month', 'Este mês'], ['year', 'Este ano'],
            ['custom', 'Intervalo personalizado']
        ], false);
        const from = field('De', 'from', { type: 'date', required: false });
        const to = field('Até', 'to', { type: 'date', required: false });
        const actions = node('div', 'admin-user-filter-actions');
        actions.append(actionButton('Aplicar filtros', () => searchForm.requestSubmit(), 'admin-refresh-button'),
            actionButton('Limpar filtros', async () => {
                search.control.value = ''; period.control.value = 'all'; from.control.value = ''; to.control.value = '';
                await refreshUsers();
            }, 'admin-action-button admin-user-filter-clear'));
        searchForm.append(search.label, period.label, from.label, to.label, actions);
        const summary = node('div', 'admin-stat-grid admin-user-summary-grid');
        const status = statusNode(host, 'A carregar utilizadores...');
        const list = cardList(host);
        const pagination = node('div', 'admin-user-pagination');
        const state = { requestId: 0, items: [] };
        host.prepend(searchForm);
        host.insertBefore(summary, status);
        host.append(pagination);
        const syncPreset = () => {
            const range = userRegistrationRange(period.control.value, from.control.value, to.control.value);
            if (period.control.value !== 'custom') {
                from.control.value = range ? range.from : '';
                to.control.value = range ? range.to : '';
            }
        };
        period.control.addEventListener('change', syncPreset);
        [from.control, to.control].forEach((control) => control.addEventListener('change', () => { period.control.value = 'custom'; }));
        async function refreshUsers() {
            const range = userRegistrationRange(period.control.value, from.control.value, to.control.value);
            if (!range) {
                status.textContent = 'Escolhe um intervalo válido; a data inicial não pode ser posterior à data final.';
                status.classList.add('is-warning');
                return;
            }
            await fetchUsers(search.control.value.trim(), range.from, range.to, list, status, summary, pagination, state);
        }
        searchForm.addEventListener('submit', async (event) => { event.preventDefault(); await refreshUsers(); });
        await refreshUsers();
    }

    async function fetchUsers(search, from, to, list, status, summary, pagination, state, offset = 0, append = false) {
        if (!append) {
            state.requestId += 1;
            state.items = [];
            resetAnalytics('users');
            pagination.replaceChildren();
        } else {
            const more = pagination.querySelector('button[data-users-more]');
            if (more) more.disabled = true;
        }
        const requestId = state.requestId;
        status.classList.remove('is-warning');
        status.textContent = append ? 'A carregar mais utilizadores...' : 'A pesquisar...';
        try {
            const query = new URLSearchParams({ search });
            if (from) query.set('from', from);
            if (to) query.set('to', to);
            if (offset) query.set('offset', String(offset));
            const data = await window.ImpactaAPI.request('/admin/users?' + query.toString());
            if (requestId !== state.requestId) return;
            const items = Array.isArray(data.items) ? data.items : [];
            const total = Number(data.total) || 0;
            state.items = append ? state.items.concat(items) : items;
            renderUserRegistrationSummary(summary, data.metrics || {});
            const label = from || to ? 'Inscrições no período seleccionado' : search ? 'Resultados da pesquisa' : 'Contas recentes';
            setAnalyticsData('users', label, state.items);
            renderUsers(items, list, status, search, total, offset, append);
            pagination.replaceChildren();
            if (offset + items.length < total && items.length) {
                const more = actionButton('Carregar mais utilizadores', async () => {
                    await fetchUsers(search, from, to, list, status, summary, pagination, state, offset + items.length, true);
                }, 'admin-refresh-button admin-user-load-more');
                more.dataset.usersMore = 'true';
                pagination.append(more);
            }
            setFooter('API ligada · inscrições filtradas no servidor pela data local de Luanda.');
        } catch (error) {
            if (requestId !== state.requestId) return;
            if (append) {
                const more = pagination.querySelector('button[data-users-more]');
                if (more) more.disabled = false;
            }
            status.textContent = readableError(error, 'Não foi possível carregar os utilizadores.');
            status.classList.add('is-warning');
            setAnalyticsUnavailable('users', 'A consulta de utilizadores requer permissão administrativa.');
        }
    }

    function renderUsers(items, list, status, search, total, offset, append) {
        if (!append) list.replaceChildren();
        const shown = Math.min(offset + items.length, total);
        status.textContent = total.toLocaleString('pt-AO') + ' conta(s) encontrada(s); a mostrar ' + shown.toLocaleString('pt-AO') + ' de ' + total.toLocaleString('pt-AO') + '.';
        if (!items.length && !append) return empty(list, 'Não foram encontradas contas para estes filtros.');
        items.forEach((item) => {
            const card = node('article', 'admin-tool-card');
            const heading = node('div', 'admin-tool-card-heading');
            heading.append(node('strong', '', item.display_name), node('span', 'admin-tool-pill', localizedStatus(item.status)));
            const registeredAt = item.created_at
                ? new Date(item.created_at).toLocaleString('pt-AO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Luanda' })
                : 'Data de registo indisponível';
            card.append(heading,
                node('p', '', item.email || 'E-mail não disponível'),
                node('small', 'admin-user-created-at', 'Inscrito em ' + registeredAt),
                node('small', '', 'Identificador ' + item.id + ' · Funções: ' + ((item.roles || []).map(localizedRole).join(', ') || 'membro') + ' · Verificação em dois passos: ' + (item.mfa_required ? 'obrigatória' : 'desactivada')));
            const canManage = item.can_manage === true && item.is_current_user !== true
                && item.protected_admin !== true && item.status !== 'closed';
            if (canManage) {
                const form = node('form', 'admin-tool-inline-form');
                const reason = field('Motivo da acção', 'reason', { placeholder: 'Regista o motivo para o histórico administrativo.', maxLength: 1000 });
                const actions = node('div', 'admin-tool-inline-actions');
                if (item.status === 'active' || item.status === 'suspended') {
                    const nextStatus = item.status === 'active' ? 'suspended' : 'active';
                    const submit = node('button', item.status === 'active' ? 'admin-action-button admin-action-remove' : 'admin-action-button admin-action-hide', item.status === 'active' ? 'Suspender conta' : 'Reativar conta');
                    submit.type = 'submit';
                    actions.append(submit);
                    form.addEventListener('submit', async (event) => {
                        event.preventDefault();
                        if (!reason.control.value.trim()) {
                            status.textContent = 'Regista o motivo antes de continuar.';
                            status.classList.add('is-warning');
                            reason.control.focus();
                            return;
                        }
                        if (!window.ImpactaModal?.confirm) {
                            status.textContent = 'O modal de confirmação não está disponível. Actualiza a página.';
                            status.classList.add('is-warning');
                            return;
                        }
                        const confirmed = await window.ImpactaModal.confirm({
                            title: nextStatus === 'suspended' ? 'Suspender esta conta?' : 'Reactivar esta conta?',
                            message: nextStatus === 'suspended'
                                ? 'A pessoa deixará de poder iniciar sessão. O motivo ficará no histórico administrativo.'
                                : 'A pessoa poderá voltar a iniciar sessão. O motivo ficará no histórico administrativo.',
                            confirmLabel: nextStatus === 'suspended' ? 'Suspender conta' : 'Reactivar conta',
                            danger: nextStatus === 'suspended'
                        });
                        if (!confirmed) return;
                        submit.disabled = true;
                        try {
                            await window.ImpactaAPI.request('/admin/users/' + encodeURIComponent(item.id) + '/status', 'POST', { status: nextStatus, reason: reason.control.value.trim() });
                            await fetchUsers(search, list, status);
                            window.ImpactaModal.notice({ title: nextStatus === 'suspended' ? 'Conta suspensa' : 'Conta reactivada', message: 'A alteração foi registada no histórico administrativo.' });
                        } catch (error) {
                            status.textContent = readableError(error, 'Não foi possível alterar o estado da conta.');
                            status.classList.add('is-warning');
                        } finally { submit.disabled = false; }
                    });
                }

                const close = actionButton('Eliminar utilizador', async () => {
                    const reasonText = reason.control.value.trim();
                    if (reasonText.length < 5) {
                        status.textContent = 'Escreve um motivo com pelo menos 5 caracteres antes de eliminar a conta.';
                        status.classList.add('is-warning');
                        reason.control.focus();
                        return;
                    }
                    if (!window.ImpactaModal?.confirm) {
                        status.textContent = 'O modal de confirmação não está disponível. Actualiza a página.';
                        status.classList.add('is-warning');
                        return;
                    }
                    const confirmed = await window.ImpactaModal.confirm({
                        title: 'Eliminar este utilizador?',
                        message: 'A pessoa deixará de poder iniciar sessão. O e-mail, perfil, verificação em dois passos e documentos serão removidos; publicações, participações e métricas ficam preservadas com o nome Conta encerrada. Contas administrativas protegidas e responsáveis por comunidades ou projectos activos não podem ser eliminadas.',
                        confirmLabel: 'Eliminar utilizador',
                        danger: true
                    });
                    if (!confirmed) return;
                    close.disabled = true;
                    status.classList.remove('is-warning');
                    status.textContent = 'A encerrar a conta e a revogar os acessos...';
                    try {
                        await window.ImpactaAPI.request('/admin/users/' + encodeURIComponent(item.id) + '/close', 'POST', { reason: reasonText });
                        await fetchUsers(search, list, status);
                        window.ImpactaModal.notice({ title: 'Conta eliminada', message: 'O acesso foi encerrado, os dados de perfil foram removidos e o histórico foi preservado.' });
                    } catch (error) {
                        status.textContent = readableError(error, 'Não foi possível encerrar a conta.');
                        status.classList.add('is-warning');
                    } finally { close.disabled = false; }
                }, 'admin-action-button admin-action-remove admin-user-delete');
                if (item.has_active_responsibilities === true) {
                    close.disabled = true;
                    close.title = 'Transfere primeiro a gestão de comunidades e projectos activos.';
                }
                actions.append(close);
                form.append(reason.label, actions);
                if (item.has_active_responsibilities === true) card.append(node('small', 'admin-close-blocked-note', 'Esta conta ainda gere comunidades ou projectos activos. Transfere a responsabilidade antes de a eliminar.'));
                card.append(form);
            }
            list.append(card);
        });
    }

    async function loadAccountVerifications() {
        const list = document.querySelector('[data-account-verification-list]');
        const status = document.querySelector('[data-verification-status]');
        const refresh = document.querySelector('[data-verification-refresh]');
        if (!list || !status || !window.ImpactaAPI) return;
        resetAnalytics('verifications');
        if (refresh) refresh.disabled = true;
        status.textContent = 'A carregar pedidos de verificação…';
        list.replaceChildren();
        try {
            const data = await window.ImpactaAPI.request('/admin/account-verifications');
            const items = Array.isArray(data.items) ? data.items : [];
            setAnalyticsData('verifications', 'Pedidos de verificação', items);
            status.textContent = items.length
                ? `${items.filter((item) => item.status === 'pending').length} pedido(s) pendente(s) · ${items.filter((item) => item.status === 'approved' && item.proof_confirmed_at).length} canal(is) confirmado(s).`
                : 'Não há pedidos pendentes nem canais confirmados.';
            if (!items.length) {
                empty(list, 'A fila está actualizada.');
                return;
            }
            items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                const heading = node('div', 'admin-tool-card-heading');
                heading.append(
                    node('strong', '', item.display_name || 'Conta da comunidade'),
                    node('span', 'admin-tool-pill', `${item.category === 'organization' ? 'Organização' : 'Figura pública'} · ${item.status === 'approved' ? (item.proof_confirmed_at ? 'Canal confirmado' : 'Aprovação antiga') : 'Pendente'}`)
                );
                card.append(heading);
                if (item.organization) card.append(node('p', '', `Organização indicada: ${item.organization}`));
                card.append(node('p', '', item.request_note || 'Sem contexto adicional.'));
                const evidence = node('a', 'admin-report-feed-link', 'Abrir canal oficial indicado');
                evidence.href = item.evidence_url;
                evidence.target = '_blank';
                evidence.rel = 'noopener noreferrer';
                card.append(evidence, node('small', '', `Pedido recebido em ${new Date(item.created_at).toLocaleString('pt-AO')}`));
                if (item.status === 'pending') {
                    const proof = node('p', 'admin-verification-proof');
                    if (item.proof_code) {
                        const expires = item.proof_expires_at ? new Date(item.proof_expires_at).toLocaleString('pt-AO') : '—';
                        proof.append(node('strong', '', `Código para confirmação privada: ${item.proof_code}`));
                        proof.append(node('small', '', `Confirma por uma fonte independente que o canal é oficial e que recebeste o código em privado a partir de um contacto associado a esse canal. O código não deve ser publicado. Válido até ${expires}.`));
                    } else {
                        proof.append(node('strong', '', 'Código expirado ou indisponível.'));
                        proof.append(node('small', '', 'Pede à pessoa que gere um novo código antes de decidir.'));
                    }
                    card.append(proof);
                } else if (item.proof_confirmed_at) {
                    card.append(node('small', '', `Canal oficial confirmado em ${new Date(item.proof_confirmed_at).toLocaleString('pt-AO')}.`));
                }

                const form = node('form', 'admin-tool-inline-form');
                const decision = selectField('Decisão', 'decision', item.status === 'approved'
                    ? [['revoke', 'Retirar verificação']]
                    : [['approve', 'Confirmar canal oficial'], ['reject', 'Recusar pedido']]);
                const proofConfirmation = node('label', 'admin-verification-proof-check');
                const proofCheckbox = node('input');
                proofCheckbox.type = 'checkbox';
                proofCheckbox.name = 'proofConfirmed';
                const proofLabel = node('span', '', 'Confirmei por fonte independente que o canal é oficial e recebi o código em privado de um contacto associado a esse canal.');
                proofConfirmation.append(proofCheckbox, proofLabel);
                proofConfirmation.hidden = item.status !== 'pending';
                proofCheckbox.required = decision.control.value === 'approve';
                decision.control.addEventListener('change', () => {
                    proofCheckbox.required = decision.control.value === 'approve';
                });
                const reason = field('Motivo da decisão', 'reason', {
                    multiline: true,
                    rows: 3,
                    maxLength: 1000,
                    placeholder: 'Regista a evidência analisada e o motivo da decisão.'
                });
                const submit = node('button', 'admin-action-button', item.status === 'approved' ? 'Registar retirada' : 'Registar decisão');
                submit.type = 'submit';
                form.append(decision.label, proofConfirmation, reason.label, submit);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    if (decision.control.value === 'approve' && !proofCheckbox.checked) {
                        status.textContent = 'Confirma que recebeste o código em privado a partir de um contacto associado ao canal oficial.';
                        status.classList.add('is-warning');
                        return;
                    }
                    if (!reason.control.value.trim() || reason.control.value.trim().length < 5) {
                        status.textContent = 'Escreve um motivo com pelo menos 5 caracteres.';
                        status.classList.add('is-warning');
                        return;
                    }
                    submit.disabled = true;
                    try {
                        await window.ImpactaAPI.request(
                            `/admin/account-verifications/${encodeURIComponent(item.id)}/review`,
                            'POST',
                            { decision: decision.control.value, reason: reason.control.value.trim(), proofConfirmed: proofCheckbox.checked }
                        );
                        await loadAccountVerifications();
                    } catch (error) {
                        status.textContent = error?.code === 'verification_proof_not_active'
                            ? 'O código expirou. Pede à pessoa que gere outro antes de aprovar.'
                            : readableError(error, 'Não foi possível guardar a decisão.');
                        status.classList.add('is-warning');
                    } finally {
                        submit.disabled = false;
                    }
                });
                card.append(form);
                list.append(card);
            });
        } catch (error) {
            status.textContent = readableError(error, 'Não foi possível carregar os pedidos de verificação.');
            status.classList.add('is-warning');
            setAnalyticsUnavailable('verifications', 'A fila de verificação requer permissão de revisão.');
        } finally {
            if (refresh) refresh.disabled = false;
        }
    }

    document.querySelector('[data-verification-refresh]')?.addEventListener('click', () => void loadAccountVerifications());

    async function loadRoles() {
        const host = moduleHost('roles');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('roles');
        host.replaceChildren();
        statusNode(host, 'A carregar funções e âmbitos…');
        try {
            const data = await window.ImpactaAPI.request('/admin/roles');
            setAnalyticsData('roles', 'Funções disponíveis', data.items || [], { value: (data.items || []).reduce((sum, item) => sum + (Number(item.assigned_users) || 0), 0) });
            setAnalyticsData('roles', 'Atribuições atuais', data.assignments || []);
            const status = host.querySelector('.admin-live-status');
            status.textContent = `${data.items.length} funções disponíveis. Super-administrador e administrador da plataforma não podem ser atribuídos por esta interface.`;
            const form = formShell('Atribuir função limitada');
            const user = field('Identificador do utilizador', 'userId', { type: 'number', min: 1, placeholder: 'Ex.: 12' });
            const role = selectField('Função', 'roleCode', [['support_agent', 'Apoio'], ['moderator', 'Moderação'], ['community_manager', 'Gestor de comunidade']]);
            const community = selectField('Comunidade', 'communityId', [['', 'Escolhe uma comunidade'], ...(data.communities || []).map((item) => [item.id, item.name])]);
            community.label.hidden = true;
            community.control.required = false;
            role.control.addEventListener('change', () => { community.label.hidden = role.control.value !== 'community_manager'; community.control.required = !community.label.hidden; });
            const submit = node('button', 'admin-action-button admin-action-hide', 'Atribuir função');
            submit.type = 'submit';
            form.append(user.label, role.label, community.label, submit);
            const statusLine = statusNode(form, '');
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                submit.disabled = true;
                try {
                    await window.ImpactaAPI.request('/admin/roles/assign', 'POST', { userId: user.control.value, roleCode: role.control.value, communityId: role.control.value === 'community_manager' ? community.control.value : undefined });
                    await loadRoles();
                } catch (error) { statusLine.textContent = readableError(error, 'Não foi possível atribuir a função.'); statusLine.classList.add('is-warning'); }
                finally { submit.disabled = false; }
            });
            host.append(form);
            const roleList = node('div', 'admin-tool-list');
            (data.items || []).forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', item.name), node('p', '', `${item.description} · ${item.assigned_users} utilizador(es)`), node('small', '', `Permissões: ${(item.permissions || []).join(', ') || 'nenhuma'}`));
                roleList.append(card);
            });
            host.append(node('h3', 'admin-tool-section-title', 'Funções da plataforma'), roleList);
            const assignmentList = node('div', 'admin-tool-list');
            (data.assignments || []).forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', `${item.display_name} · ${item.role_name}`), node('p', '', item.community_name ? `Comunidade: ${item.community_name}` : 'Âmbito: plataforma'));
                const formRow = node('form', 'admin-tool-inline-form');
                const reason = field('Motivo da remoção', 'reason', { placeholder: 'Indica por que a função deve ser removida.', maxLength: 1000 });
                const remove = node('button', 'admin-action-button admin-action-remove', 'Remover função');
                remove.type = 'submit';
                formRow.append(reason.label, remove);
                formRow.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    remove.disabled = true;
                    try { await window.ImpactaAPI.request(`/admin/roles/${encodeURIComponent(item.id)}`, 'DELETE', { reason: reason.control.value.trim() }); await loadRoles(); }
                    catch (error) { status.textContent = readableError(error, 'Não foi possível remover a função.'); status.classList.add('is-warning'); }
                    finally { remove.disabled = false; }
                });
                card.append(formRow);
                assignmentList.append(card);
            });
            if (!data.assignments?.length) empty(assignmentList, 'Não há funções limitadas atribuídas.');
            host.append(node('h3', 'admin-tool-section-title', 'Atribuições atuais'), assignmentList);
            setFooter('API ligada · funções e permissões carregadas.');
        } catch (error) { showFailure(host, error, 'Não foi possível carregar as funções.'); }
    }

    async function loadCommunities() {
        const host = moduleHost('communities');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('communities');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar comunidades ativas…');
        const list = cardList(host);
        try {
            const data = await window.ImpactaAPI.request('/admin/communities/managed');
            setAnalyticsData('communities', 'Comunidades geridas', data.items || []);
            status.textContent = `${data.items.length} comunidade(s) gerida(s). As propostas pendentes aparecem acima.`;
            if (!data.items.length) empty(list, 'Ainda não existem comunidades ativas.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('div', 'admin-tool-card-heading', ''), node('strong', '', item.name), node('p', '', `${item.member_count} membro(s) · estado ${localizedStatus(item.status)}`));
                if (item.description) card.append(node('p', '', item.description));
                if (item.status === 'active') {
                    const conversation = node('a', 'admin-refresh-button', 'Acompanhar conversa');
                    conversation.href = `../feed.html?community=${encodeURIComponent(item.id)}`;
                    card.append(conversation);
                }
                const form = node('form', 'admin-tool-inline-form');
                const reason = field('Motivo', 'reason', { placeholder: 'Regista o motivo da alteração.', maxLength: 1000 });
                const action = selectField('Novo estado', 'status', [['active', 'Ativa'], ['suspended', 'Suspensa'], ['archived', 'Arquivada']]);
                const save = node('button', 'admin-action-button admin-action-hide', 'Guardar estado');
                save.type = 'submit';
                form.append(action.label, reason.label, save);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault(); save.disabled = true;
                    try { await window.ImpactaAPI.request(`/admin/communities/${encodeURIComponent(item.id)}/status`, 'POST', { status: action.control.value, reason: reason.control.value.trim() }); await loadCommunities(); }
                    catch (error) { status.textContent = readableError(error, 'Não foi possível atualizar a comunidade.'); status.classList.add('is-warning'); }
                    finally { save.disabled = false; }
                });
                card.append(form); list.append(card);
            });
            setFooter('API ligada · comunidades carregadas.');
        } catch (error) { status.textContent = readableError(error, 'Não foi possível carregar as comunidades.'); status.classList.add('is-warning'); setAnalyticsUnavailable('communities', 'A lista de comunidades requer permissão de gestão.'); }
    }

    async function loadProjects() {
        const host = moduleHost('projects');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('projects');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar projectos e desafios…');
        const list = cardList(host);
        try {
            const [projectData, challengeData, activityData] = await Promise.all([
                window.ImpactaAPI.request('/admin/projects/managed'),
                window.ImpactaAPI.request('/admin/challenges'),
                window.ImpactaAPI.request('/admin/projects/activity')
            ]);
            setAnalyticsData('projects', 'Projectos', projectData.items || []);
            setAnalyticsData('projects', 'Desafios', challengeData.items || []);
            setAnalyticsData('projects', 'Actualizações de progresso', activityData.items || []);
            status.textContent = `${projectData.items.length} projecto(s) activo(s) ou concluído(s) · ${challengeData.items.length} desafio(s). As propostas pendentes aparecem acima.`;
            if (!projectData.items.length) empty(list, 'Ainda não existem projectos publicados.');
            projectData.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', item.title), node('p', '', `${item.participant_count} participante(s) · ${item.community_name || 'Projecto independente'} · ${localizedStatus(item.status)}`));
                const location = [item.location_neighborhood, item.location_commune, item.location_municipality, item.location_province].filter(Boolean).join(', ');
                if (location) card.append(node('small', '', location));
                const form = node('form', 'admin-tool-inline-form');
                const reason = field('Motivo', 'reason', { placeholder: 'Regista o motivo da alteração.', maxLength: 1000 });
                const next = selectField('Estado', 'status', [['active', 'Em curso'], ['completed', 'Concluído'], ['archived', 'Arquivado']]);
                const save = node('button', 'admin-action-button admin-action-hide', 'Guardar estado'); save.type = 'submit';
                form.append(next.label, reason.label, save);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault(); save.disabled = true;
                    try { await window.ImpactaAPI.request(`/admin/projects/${encodeURIComponent(item.id)}/status`, 'POST', { status: next.control.value, reason: reason.control.value.trim() }); await loadProjects(); }
                    catch (error) { status.textContent = readableError(error, 'Não foi possível actualizar o projecto.'); status.classList.add('is-warning'); }
                    finally { save.disabled = false; }
                });
                card.append(form); list.append(card);
            });
            const challengeForm = formShell('Criar desafio num projecto publicado');
            const projectChoice = selectField('Projecto', 'projectId', [['', 'Escolhe um projecto'], ...projectData.items.filter((item) => item.status === 'active').map((item) => [item.id, item.title])]);
            const title = field('Título do desafio', 'title', { maxLength: 160 });
            const description = field('Descrição', 'description', { multiline: true, rows: 3, maxLength: 3000 });
            const opensAt = field('Abre em (opcional)', 'opensAt', { type: 'datetime-local', required: false });
            const closesAt = field('Fecha em (opcional)', 'closesAt', { type: 'datetime-local', required: false });
            const create = node('button', 'admin-action-button admin-action-hide', 'Criar desafio neste projecto'); create.type = 'submit';
            challengeForm.append(projectChoice.label, title.label, description.label, opensAt.label, closesAt.label, create);
            challengeForm.addEventListener('submit', async (event) => {
                event.preventDefault(); create.disabled = true;
                try {
                    await window.ImpactaAPI.request('/admin/challenges', 'POST', {
                        projectId: projectChoice.control.value, title: title.control.value.trim(), description: description.control.value.trim(),
                        opensAt: opensAt.control.value ? new Date(opensAt.control.value).toISOString() : undefined,
                        closesAt: closesAt.control.value ? new Date(closesAt.control.value).toISOString() : undefined
                    });
                    await loadProjects();
                } catch (error) { status.textContent = readableError(error, 'Não foi possível criar o desafio.'); status.classList.add('is-warning'); }
                finally { create.disabled = false; }
            });
            host.append(challengeForm, node('h3', 'admin-tool-section-title', 'Desafios publicados'));
            const challenges = cardList(host);
            if (!challengeData.items.length) empty(challenges, 'Ainda não existem desafios nestes projectos.');
            challengeData.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', item.title), node('p', '', `${item.project_title} · ${item.submissions} candidatura(s) · ${localizedStatus(item.status)}`));
                const toggle = actionButton(item.status === 'open' ? 'Fechar desafio' : 'Abrir desafio', async () => {
                    toggle.disabled = true;
                    try { await window.ImpactaAPI.request(`/admin/challenges/${encodeURIComponent(item.id)}/status`, 'POST', { status: item.status === 'open' ? 'closed' : 'open' }); await loadProjects(); }
                    catch (error) { status.textContent = readableError(error, 'Não foi possível actualizar o desafio.'); status.classList.add('is-warning'); }
                    finally { toggle.disabled = false; }
                });
                card.append(toggle); challenges.append(card);
            });
            host.append(node('h3', 'admin-tool-section-title', 'Actividade dos projectos'));
            const activity = cardList(host);
            let activityOffset = 0;
            const renderActivity = (data) => {
                const activityItems = [
                    ...(data.submissions || []).map((item) => ({ ...item, activity_type: 'challenge_submission' })),
                    ...(data.members || []).map((item) => ({ ...item, activity_type: 'project_member' }))
                ].sort((left, right) => {
                    const a = left.submitted_at ? new Date(left.submitted_at).getTime() : 0;
                    const b = right.submitted_at ? new Date(right.submitted_at).getTime() : 0;
                    return b - a;
                });
                if (!activityItems.length && activityOffset === 0) {
                    empty(activity, 'Ainda não há adesões ou participações registadas nos projectos.');
                    return;
                }
                activity.querySelector('.admin-tool-empty')?.remove();
                activityItems.forEach((item) => {
                    const card = node('article', 'admin-tool-card');
                    if (item.activity_type === 'challenge_submission') {
                        card.append(
                            node('strong', '', `${item.display_name} · ${item.challenge_title}`),
                            node('p', '', `${item.project_title} · ${item.community_name || 'Projecto independente'}`),
                            node('p', '', item.submission),
                            node('small', '', new Date(item.submitted_at).toLocaleString('pt-AO'))
                        );
                    } else {
                        card.append(
                            node('strong', '', `${item.display_name} aderiu a ${item.project_title}`),
                            node('p', '', `${item.community_name || 'Projecto independente'} · ${localizedRole(item.membership_role)}`)
                        );
                    }
                    activity.append(card);
                });
            };
            renderActivity(activityData);
            if (activityData.has_more) {
                const moreActivity = actionButton('Carregar mais actividade dos projectos', async () => {
                    moreActivity.disabled = true;
                    try {
                        const next = await window.ImpactaAPI.request(`/admin/projects/activity?offset=${activityOffset + 100}`);
                        activityOffset = next.next_offset - 100;
                        renderActivity(next);
                        moreActivity.hidden = next.has_more !== true;
                    } catch (error) {
                        status.textContent = readableError(error, 'Não foi possível carregar mais actividade dos projectos.');
                        status.classList.add('is-warning');
                    } finally { moreActivity.disabled = false; }
                }, 'admin-refresh-button');
                host.append(moreActivity);
            }
                    setFooter('API ligada · projectos e desafios carregados.');
        } catch (error) { status.textContent = readableError(error, 'Não foi possível carregar projectos e desafios.'); status.classList.add('is-warning'); setAnalyticsUnavailable('projects', 'Projectos e desafios estão restritos ou indisponíveis.'); }
    }

    const communityReportLabels = {
        adult_sexual_content: 'Pornografia ou conteúdo sexual explícito',
        sexual_exploitation: 'Exploração sexual ou risco para menores',
        harassment: 'Assédio',
        hate: 'Discurso de ódio',
        threats_violence: 'Ameaças ou violência',
        spam_scam: 'Spam ou fraude',
        illegal_activity: 'Actividade ilegal',
        privacy: 'Exposição de dados pessoais',
        other: 'Outro problema'
    };

    function renderCommunityReportCard(item, access, onDecision) {
        const card = node('article', 'admin-tool-card admin-community-report-card');
        const isMessage = Boolean(item.message_id);
        card.append(node('strong', '', isMessage
            ? `${item.community_name} · mensagem de ${item.author_name || 'conta indisponível'}`
            : `${item.community_name} · comunidade denunciada`));
        card.append(node('p', '', `${Number(item.reporter_count) || 0} denúncia(s) · estado ${localizedStatus(item.community_status)} · ${new Date(item.latest_report_at).toLocaleString('pt-AO')}`));
        if (isMessage && item.message_body) card.append(node('blockquote', 'admin-reported-post', item.message_body));
        const reasons = node('ul', 'admin-community-report-reasons');
        (Array.isArray(item.reports) ? item.reports : []).forEach((report) => {
            const line = node('li');
            const label = communityReportLabels[report.reason_code] || 'Outro problema';
            line.append(node('strong', '', `${label} · ${report.reporter || 'Conta encerrada'}`));
            if (report.details) line.append(node('p', '', report.details));
            reasons.append(line);
        });
        card.append(reasons);
        const auditLink = node('a', 'admin-report-feed-link', 'Abrir conversa e auditar o grupo ↗');
        auditLink.href = `../feed.html?community=${encodeURIComponent(item.community_id)}`;
        auditLink.target = '_blank';
        auditLink.rel = 'noopener noreferrer';
        card.append(auditLink);

        const reason = field('Motivo da decisão (obrigatório)', 'reason', { multiline: true, rows: 2, maxLength: 1000 });
        reason.control.placeholder = 'Explica o que foi analisado e por que decidiste assim.';
        const actions = node('div', 'admin-moderation-actions');
        const state = statusNode(card, '');
        const act = (action, label, permitted) => {
            if (!permitted) return;
            const button = actionButton(label, async () => {
                const reasonText = reason.control.value.trim();
                if (reasonText.length < 5) {
                    state.textContent = 'Regista um motivo com pelo menos 5 caracteres.';
                    state.classList.add('is-warning');
                    reason.control.focus();
                    return;
                }
                button.disabled = true;
                state.textContent = 'A guardar decisão…';
                try {
                    await window.ImpactaAPI.request(`/admin/community-reports/${encodeURIComponent(item.report_id)}/decision`, 'POST', {
                        action, reason: reasonText
                    });
                    state.textContent = 'Decisão registada na auditoria.';
                    await onDecision();
                } catch (error) {
                    state.textContent = readableError(error, 'Não foi possível registar a decisão.');
                    state.classList.add('is-warning');
                    button.disabled = false;
                }
            }, action === 'dismiss' ? 'admin-action-button' : 'admin-action-button admin-action-remove');
            actions.append(button);
        };
        act('remove_message', 'Remover mensagem', isMessage && access.canModerate);
        act('suspend_community', 'Suspender comunidade', !isMessage && access.canManageCommunities);
        act('dismiss', 'Arquivar denúncia', true);
        card.append(reason.label, actions);
        return card;
    }

    function renderPendingCommunityMedia(item, onDecision) {
        const card = node('article', 'admin-tool-card admin-community-report-card');
        card.append(node('strong', '', `${item.community_name} · anexo de ${item.author_name || 'conta indisponível'}`));
        card.append(node('p', '', `Enviado em ${new Date(item.created_at).toLocaleString('pt-AO')} · só o autor e a equipa de moderação o podem ver enquanto aguarda revisão.`));
        if (item.body) card.append(node('blockquote', 'admin-reported-post', item.body));
        card.append(node('small', 'admin-content-warning', 'O anexo pode conter conteúdo explícito ou violento. Abre-o apenas se for necessário para a revisão.'));
        const reveal = actionButton('Mostrar anexo para análise', () => {
            if (card.querySelector('.admin-community-pending-media')) return;
            const url = window.ImpactaAPI.assetUrl(item.media_url);
            const preview = item.media_type === 'video' ? node('video', 'admin-community-pending-media') : node('img', 'admin-community-pending-media');
            preview.src = url;
            if (preview instanceof HTMLVideoElement) {
                preview.controls = true;
                preview.preload = 'metadata';
                preview.playsInline = true;
                preview.setAttribute('aria-label', 'Vídeo enviado para revisão');
            } else preview.alt = 'Imagem enviada para revisão';
            card.insertBefore(preview, reason.label);
            reveal.remove();
        }, 'admin-refresh-button');
        card.append(reveal);
        const reason = field('Motivo da decisão (obrigatório)', 'reason', { multiline: true, rows: 2, maxLength: 1000 });
        reason.control.placeholder = 'Regista por que o anexo respeita ou viola as regras da comunidade.';
        const state = statusNode(card, '');
        const actions = node('div', 'admin-moderation-actions');
        const decide = (action, label, style) => {
            const button = actionButton(label, async () => {
                const decisionReason = reason.control.value.trim();
                if (decisionReason.length < 5) {
                    state.textContent = 'Regista um motivo com pelo menos 5 caracteres.';
                    state.classList.add('is-warning');
                    reason.control.focus();
                    return;
                }
                button.disabled = true;
                state.textContent = 'A guardar decisão…';
                try {
                    await window.ImpactaAPI.request(`/admin/community-content-review/${encodeURIComponent(item.id)}/decision`, 'POST', {
                        action, reason: decisionReason
                    });
                    await onDecision();
                } catch (error) {
                    state.textContent = readableError(error, 'Não foi possível registar a decisão.');
                    state.classList.add('is-warning');
                    button.disabled = false;
                }
            }, style);
            actions.append(button);
        };
        decide('approve', 'Aprovar e mostrar ao grupo', 'admin-action-button admin-action-hide');
        decide('remove', 'Rejeitar e colocar em quarentena', 'admin-action-button admin-action-remove');
        card.append(reason.label, actions);
        return card;
    }

    async function loadCommunitySafety(host) {
        host.querySelectorAll('.admin-community-safety-section').forEach((section) => section.remove());
        const pendingSection = node('section', 'admin-community-safety-section');
        pendingSection.append(node('h3', 'admin-tool-section-title', 'Anexos à espera de revisão'));
        pendingSection.append(node('p', 'admin-live-status', 'Imagens e vídeos de conversas não aparecem aos outros membros até a equipa os aprovar.'));
        const pendingStatus = statusNode(pendingSection, 'A carregar anexos pendentes…');
        const pendingList = cardList(pendingSection);
        host.append(pendingSection);
        try {
            const pending = await window.ImpactaAPI.request('/admin/community-content-review');
            pendingStatus.textContent = `${pending.items.length} anexo(s) aguardam revisão.`;
            if (!pending.items.length) empty(pendingList, 'Não há anexos pendentes de revisão.');
            pending.items.forEach((item) => pendingList.append(renderPendingCommunityMedia(item, () => loadCommunitySafety(host))));
        } catch (error) {
            pendingStatus.textContent = readableError(error, 'Não foi possível carregar os anexos pendentes.');
            pendingStatus.classList.add('is-warning');
            setAnalyticsUnavailable('moderation', 'A fila de anexos requer permissão de moderação.');
            empty(pendingList, 'A revisão de anexos exige a permissão de moderação da plataforma.');
        }

        const reportSection = node('section', 'admin-community-safety-section');
        reportSection.append(node('h3', 'admin-tool-section-title', 'Denúncias sobre comunidades e conversas'));
        const reportStatus = statusNode(reportSection, 'A carregar denúncias de grupos…');
        const reportList = cardList(reportSection);
        host.append(reportSection);

        const auditSection = node('section', 'admin-community-safety-section');
        auditSection.append(node('h3', 'admin-tool-section-title', 'Auditoria dos grupos'));
        auditSection.append(node('p', 'admin-live-status', 'A lista mostra actividade, número de membros e denúncias abertas. Abrir uma conversa regista o acesso administrativo na auditoria.'));
        const auditStatus = statusNode(auditSection, 'A carregar comunidades…');
        const auditList = cardList(auditSection);
        host.append(auditSection);

        let access = { canModerate: false, canManageCommunities: false };
        try {
            const data = await window.ImpactaAPI.request('/admin/community-reports');
            access = { canModerate: data.canModerate === true, canManageCommunities: data.canManageCommunities === true };
            reportStatus.textContent = data.items.length
                ? `${data.items.length} grupo(s) ou conversa(s) aguardam análise.`
                : 'Não há denúncias abertas sobre comunidades.';
            if (!data.items.length) empty(reportList, 'Denúncias recebidas para grupos e mensagens aparecem aqui.');
            else data.items.forEach((item) => reportList.append(renderCommunityReportCard(item, access, () => loadCommunitySafety(host))));
        } catch (error) {
            reportStatus.textContent = readableError(error, 'Não foi possível carregar as denúncias dos grupos.');
            reportStatus.classList.add('is-warning');
            setAnalyticsUnavailable('moderation', 'A fila de grupos requer permissão de gestão de denúncias.');
            empty(reportList, 'A fila de grupos exige a permissão de gestão de denúncias.');
        }

        try {
            const data = await window.ImpactaAPI.request('/admin/community-audit');
            setAnalyticsData('moderation', 'Comunidades sob auditoria', data.items || []);
            auditStatus.textContent = `${data.items.length} comunidade(s) recentes ou sob acompanhamento.`;
            if (!data.items.length) empty(auditList, 'Ainda não há comunidades para auditar.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card admin-community-audit-card');
                card.append(node('strong', '', item.name));
                card.append(node('p', '', `${item.owner_name} · ${item.member_count} membro(s) · estado ${localizedStatus(item.status)}`));
                const lastMessage = item.last_message_at
                    ? `Última mensagem: ${new Date(item.last_message_at).toLocaleString('pt-AO')}`
                    : 'Ainda sem mensagens';
                const lastModeration = item.last_moderation_at
                    ? `Última acção moderada: ${new Date(item.last_moderation_at).toLocaleString('pt-AO')}`
                    : 'Sem acções de moderação registadas';
                card.append(node('small', '', `${lastMessage} · ${item.open_report_count} denúncia(s) aberta(s) · ${item.moderation_event_count} acção(ões) de moderação`));
                card.append(node('small', '', lastModeration));
                const open = node('a', 'admin-action-button', 'Abrir conversa para auditar');
                open.href = `../feed.html?community=${encodeURIComponent(item.id)}`;
                open.target = '_blank';
                open.rel = 'noopener noreferrer';
                card.append(open);
                const history = node('div', 'admin-community-event-list');
                history.hidden = true;
                const historyButton = actionButton('Ver histórico e decisões', async () => {
                    if (history.dataset.loaded === 'true') {
                        history.hidden = !history.hidden;
                        historyButton.textContent = history.hidden ? 'Ver histórico e decisões' : 'Ocultar histórico';
                        return;
                    }
                    historyButton.disabled = true;
                    history.replaceChildren(node('p', 'admin-live-status', 'A carregar histórico…'));
                    history.hidden = false;
                    try {
                        const events = await window.ImpactaAPI.request(`/admin/community-audit/${encodeURIComponent(item.id)}/events`);
                        history.replaceChildren();
                        if (!events.items.length) empty(history, 'Ainda não há acções administrativas ou de moderação registadas neste grupo.');
                        events.items.forEach((event) => {
                            const entry = node('article', 'admin-community-event');
                            entry.append(node('strong', '', auditActionLabel(event.action_code)));
                            entry.append(node('p', '', `${event.actor_name || 'Conta indisponível'} · ${auditTargetLabel(event.target_type, event.target_id)}`));
                            entry.append(node('small', '', `${new Date(event.occurred_at).toLocaleString('pt-AO')}${event.reason ? ` · ${auditReasonLabel(event.reason)}` : ''}`));
                            history.append(entry);
                        });
                        history.dataset.loaded = 'true';
                        historyButton.textContent = 'Ocultar histórico';
                    } catch (error) {
                        history.replaceChildren(node('p', 'admin-live-status is-warning', readableError(error, 'Não foi possível carregar o histórico deste grupo.')));
                    } finally { historyButton.disabled = false; }
                }, 'admin-refresh-button');
                card.append(historyButton, history);
                auditList.append(card);
            });
        } catch (error) {
            auditStatus.textContent = readableError(error, 'Não foi possível carregar as comunidades para auditoria.');
            auditStatus.classList.add('is-warning');
            setAnalyticsUnavailable('moderation', 'A auditoria dos grupos requer permissão administrativa.');
            empty(auditList, 'A auditoria exige uma conta com permissão de gestão de denúncias.');
        }
    }

    async function loadModeration() {
        const host = moduleHost('moderation');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('moderation');
        host.replaceChildren();
        const historySection = node('section', 'admin-community-safety-section');
        historySection.append(node('h3', 'admin-tool-section-title', 'Histórico de moderação'));
        const status = statusNode(historySection, 'A carregar histórico de moderação…');
        const openReports = actionButton('Abrir fila de denúncias gerais', () => document.querySelector('[data-admin-nav="reports"]')?.click(), 'admin-refresh-button');
        historySection.append(openReports);
        const list = cardList(historySection);
        host.append(historySection);
        try {
            const data = await window.ImpactaAPI.request('/admin/moderation/actions');
            setAnalyticsData('moderation', 'Acções de moderação', data.items || []);
            status.textContent = `${data.items.length} ação(ões) recentes.`;
            if (!data.items.length) empty(list, 'Ainda não há acções de moderação registadas.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', auditActionLabel(item.action_type)), node('p', '', `${item.actor_name || 'Conta administrativa'} · ${item.target_user_name || (item.post_id ? `publicação ${item.post_id}` : `comentário ${item.comment_id || ''}`)}`), node('small', '', `${new Date(item.created_at).toLocaleString('pt-AO')} · ${auditReasonLabel(item.reason)}`));
                list.append(card);
            });
        } catch (error) {
            status.textContent = readableError(error, 'Não foi possível carregar o histórico de moderação.');
            status.classList.add('is-warning');
            setAnalyticsUnavailable('moderation', 'O histórico de moderação está restrito ou indisponível.');
        }
        await loadCommunitySafety(host);
        setFooter('API ligada · moderação e auditoria de comunidades carregadas.');
    }

    function localDateTimeValue(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        return date.toISOString().slice(0, 16);
    }
    async function loadAnnouncements() {
        const host = moduleHost('announcements');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('announcements');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar avisos e publicidade...');
        try {
            const data = await window.ImpactaAPI.request('/admin/announcements');
            setAnalyticsData('announcements', 'Avisos e campanhas', data.items || []);
            status.textContent = data.items.length + ' aviso(s), an\u00fancio(s) ou publicidade(s).';
            host.append(node('p', 'admin-promotion-methodology', 'As métricas contam apenas campanhas públicas: impressão após 1 segundo com pelo menos metade do destaque visível; no máximo uma impressão por navegador anónimo e campanha por dia. O alcance estima navegadores, não pessoas.'));
            const measurable = data.items.filter((item) => item.placement !== 'notice');
            const impressionsTotal = measurable.reduce((sum, item) => sum + Number(item.impressions || 0), 0);
            const clicksTotal = measurable.reduce((sum, item) => sum + Number(item.clicks || 0), 0);
            const activeTotal = measurable.filter((item) => item.status === 'published' || item.status === 'scheduled').length;
            const summary = node('div', 'admin-stat-grid admin-promotion-stat-grid');
            [
                ['Destaques activos', activeTotal, 'Conteúdo em destaque publicado ou agendado'],
                ['Impressões qualificadas', impressionsTotal, 'Destaque visível por pelo menos 1 segundo'],
                ['Cliques registados', clicksTotal, 'Cliques nos links das campanhas'],
                ['CTR agregado', impressionsTotal ? `${(clicksTotal / impressionsTotal * 100).toFixed(2)}%` : '0,00%', 'Cliques ÷ impressões qualificadas']
            ].forEach(([label, value, detail]) => {
                const card = node('article', 'admin-stat-card');
                card.append(node('span', '', label), node('strong', '', value), node('small', '', detail));
                summary.append(card);
            });
            host.append(summary);
            const performance = node('div', 'admin-promotion-chart-grid');
            const promotionCharts = [
                { key: 'impressions', title: 'Impress\u00f5es por destaque', color: 'is-impressions' },
                { key: 'clicks', title: 'Cliques por campanha', color: 'is-clicks' }
            ];
            promotionCharts.forEach((definition) => {
                const panel = node('article', 'admin-panel admin-promotion-chart-panel');
                panel.append(node('p', 'admin-eyebrow', 'DESEMPENHO'), node('h3', '', definition.title));
                const chart = node('div', 'admin-promotion-chart');
                const leaders = [...measurable]
                    .sort((a, b) => Number(b[definition.key] || 0) - Number(a[definition.key] || 0))
                    .slice(0, 5);
                const maximum = Math.max(0, ...leaders.map((item) => Number(item[definition.key]) || 0));
                if (!leaders.length || maximum === 0) {
                    chart.append(node('p', 'admin-chart-empty', 'Ainda sem dados registados para este gr\u00e1fico.'));
                } else {
                    leaders.forEach((item) => {
                        const row = node('div', 'admin-promotion-chart-row');
                        const label = node('div', 'admin-promotion-chart-label');
                        label.append(node('span', '', item.title), node('strong', '', Number(item[definition.key] || 0).toLocaleString('pt-AO')));
                        const track = node('div', 'admin-promotion-chart-track');
                        const fill = node('span', 'admin-promotion-chart-fill ' + definition.color);
                        fill.style.width = (Number(item[definition.key] || 0) / maximum * 100) + '%';
                        track.append(fill);
                        row.append(label, track);
                        chart.append(row);
                    });
                }
                panel.append(chart);
                performance.append(panel);
            });
            host.append(performance);
            const form = formShell('Publicar no destaque da comunidade');
            const placement = selectField('Tipo de destaque', 'placement', [
                ['notice', 'Aviso p\u00fablico'], ['announcement', 'An\u00fancio da comunidade'], ['advertisement', 'Publicidade']
            ]);
            const title = field('T\u00edtulo (opcional)', 'title', { required: false, maxLength: 160 });
            const body = field('Mensagem (opcional)', 'body', { required: false, multiline: true, rows: 4, maxLength: 5000 });
            const advertiserName = field('Nome do cliente anunciante (opcional)', 'advertiserName', { required: false, maxLength: 160, placeholder: 'Pessoa ou organização que solicitou a publicidade' });
            const advertiserEmail = field('E-mail do cliente (opcional)', 'advertiserEmail', { required: false, type: 'email', maxLength: 254, placeholder: 'cliente@exemplo.ao' });
            const updateAdvertiserFields = () => {
                const isAdvertisement = placement.control.value === 'advertisement';
                advertiserName.label.hidden = !isAdvertisement;
                advertiserEmail.label.hidden = !isAdvertisement;
                
                
            };
            placement.control.addEventListener('change', updateAdvertiserFields);
            updateAdvertiserFields();
            const image = promotionImageField('Imagem obrigat\u00f3ria (JPEG, PNG ou WebP, m\u00e1ximo 12 MB)');
            image.control.required = true;
            const targetUrl = field('Liga\u00e7\u00e3o do bot\u00e3o (opcional)', 'targetUrl', { type: 'url', required: false, placeholder: 'https://exemplo.ao' });
            const state = selectField('Publica\u00e7\u00e3o', 'status', [['draft', 'Guardar rascunho'], ['published', 'Publicar agora'], ['scheduled', 'Agendar']]);
            const publishAt = field('Data e hora de publica\u00e7\u00e3o *', 'publishAt', { type: 'datetime-local', required: true });
            const publishNow = new Date();
            publishNow.setMinutes(publishNow.getMinutes() - publishNow.getTimezoneOffset());
            publishAt.control.value = publishNow.toISOString().slice(0, 16);
            const expiresAt = field('Expira em (opcional)', 'expiresAt', { type: 'datetime-local', required: false });
            
            
            const save = node('button', 'admin-action-button admin-action-hide', 'Guardar destaque'); save.type = 'submit';
            form.noValidate = true;
            form.append(placement.label, title.label, body.label, advertiserName.label, advertiserEmail.label, image.label, targetUrl.label,
                state.label, publishAt.label, expiresAt.label);
            const saveStatus = statusNode(form, 'A imagem e a data são obrigatórias. Os restantes detalhes são opcionais.');
            form.append(save);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                saveStatus.classList.remove('is-warning');
                if (!form.reportValidity()) {
                    const invalidControl = [...form.elements].find((control) => control.willValidate && !control.checkValidity());
                    saveStatus.textContent = invalidControl === image.control
                        ? 'Escolhe a imagem obrigatória antes de guardar.'
                        : invalidControl === publishAt.control
                            ? 'Indica uma data e hora de publicação válidas.'
                            : 'Revê os campos assinalados antes de guardar.';
                    saveStatus.classList.add('is-warning');
                    invalidControl?.focus();
                    return;
                }
                save.disabled = true;
                saveStatus.classList.remove('is-warning');
                saveStatus.textContent = 'A preparar o anúncio…';
                save.textContent = 'A enviar imagem…';
                let uploaded = null;
                try {
                    uploaded = await uploadPromotionImage(image.control.files?.[0]);
                    save.textContent = 'A guardar destaque…';
                    saveStatus.textContent = 'Imagem enviada. A guardar o destaque no IMPACTA…';
                    await window.ImpactaAPI.request('/admin/announcements', 'POST', {
                        placement: placement.control.value,
                        title: title.control.value.trim(), body: body.control.value.trim(), status: state.control.value,
                        imageId: uploaded?.id ?? null,
                        targetUrl: targetUrl.control.value.trim() || null,
                        advertiserName: placement.control.value === 'advertisement' ? advertiserName.control.value.trim() : null,
                        advertiserEmail: placement.control.value === 'advertisement' ? advertiserEmail.control.value.trim() : null,
                        publishAt: publishAt.control.value ? new Date(publishAt.control.value).toISOString() : undefined,
                        expiresAt: expiresAt.control.value ? new Date(expiresAt.control.value).toISOString() : undefined
                    });
                    image.setPreview('');
                    saveStatus.textContent = 'Destaque guardado. A actualizar a lista…';
                    await loadAnnouncements();
                    window.ImpactaModal?.notice({ title: 'Destaque guardado', message: 'O aviso ou anúncio foi guardado e a lista foi actualizada.' });
                } catch (error) {
                    const message = error?.code === 'announcement_optional_copy_migration_required'
                        || error?.message === 'announcement_optional_copy_migration_required'
                        ? 'O banco ainda exige título e mensagem. A migração de destaques opcionais precisa ser aplicada pelo administrador da base de dados.'
                        : readableError(error, 'N\u00e3o foi poss\u00edvel guardar o destaque.');
                    saveStatus.textContent = message;
                    saveStatus.classList.add('is-warning');
                    if (uploaded?.id) await removeUnusedPromotionImage(uploaded.id);
                } finally {
                    save.disabled = false;
                    save.textContent = 'Guardar destaque';
                }
            });
            host.append(form);
            const list = cardList(host);
            if (!data.items.length) empty(list, 'Ainda n\u00e3o h\u00e1 avisos ou publicidade.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                const heading = node('div', 'admin-tool-card-heading');
                const kinds = { notice: 'Aviso p\u00fablico', announcement: 'An\u00fancio', advertisement: 'Publicidade' };
                const statuses = { draft: 'Rascunho', scheduled: 'Agendado', published: 'Publicado', archived: 'Arquivado', expired: 'Expirado' };
                heading.append(node('span', 'admin-tool-pill', kinds[item.placement] || 'An\u00fancio'), node('span', 'admin-tool-pill', statuses[item.status] || localizedStatus(item.status)));
                if (item.title) card.append(heading, node('strong', '', item.title));
                else card.append(heading, node('strong', '', 'Destaque sem título'));
                if (item.body) card.append(node('p', '', item.body));
                else card.append(node('p', '', 'Sem mensagem adicional; a imagem apresenta o destaque.'));
                if (item.advertiser_name || item.advertiser_email) {
                    card.append(node('small', '', `Cliente: ${item.advertiser_name || 'Não indicado'}${item.advertiser_email ? ` · ${item.advertiser_email}` : ''}`));
                }
                if (item.placement !== 'notice') {
                    const impressions = Number(item.impressions || 0);
                    const clicks = Number(item.clicks || 0);
                    const metrics = node('div', 'admin-promotion-metrics');
                    [
                        ['Impressões', impressions],
                        ['Alcance estimado', Number(item.unique_reach || 0)],
                        ['Cliques', clicks],
                        ['CTR', `${impressions ? (clicks / impressions * 100).toFixed(2) : '0.00'}%`]
                    ].forEach(([label, value]) => {
                        const cell = node('div', '');
                        cell.append(node('span', '', label), node('strong', '', value));
                        metrics.append(cell);
                    });
                    card.append(metrics, node('small', 'admin-promotion-metric-note', 'Alcance estimado por navegadores únicos; não representa uma contagem exacta de pessoas.'));
                    const reportControls = node('div', 'admin-promotion-report-controls');
                    const dateTo = new Date();
                    const dateFrom = new Date(dateTo);
                    dateFrom.setDate(dateFrom.getDate() - 29);
                    const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const from = field('De', 'reportFrom', { type: 'date' });
                    const to = field('Até', 'reportTo', { type: 'date' });
                    from.control.value = localDate(dateFrom);
                    to.control.value = localDate(dateTo);
                    const exportStatus = node('small', 'admin-promotion-export-status', 'Relatório de métricas para enviar ao cliente.');
                    const makeReportButton = (format, label) => {
                        const button = actionButton(label, async () => {
                            if (!from.control.value || !to.control.value || from.control.value > to.control.value) {
                                exportStatus.textContent = 'Indica um intervalo de datas válido.';
                                return;
                            }
                            button.disabled = true;
                            exportStatus.textContent = 'A preparar o relatório…';
                            try {
                                const query = new URLSearchParams({ from: from.control.value, to: to.control.value, format });
                                const result = await window.ImpactaAPI.download(`/admin/announcements/${encodeURIComponent(item.id)}/report?${query}`);
                                const objectUrl = URL.createObjectURL(result.blob);
                                const link = node('a');
                                link.href = objectUrl;
                                link.download = result.filename;
                                link.click();
                                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
                                exportStatus.textContent = 'Relatório preparado. Já podes enviá-lo ao cliente.';
                            } catch (error) {
                                exportStatus.textContent = readableError(error, 'Não foi possível preparar o relatório.');
                                exportStatus.classList.add('is-warning');
                            } finally { button.disabled = false; }
                        });
                        return button;
                    };
                    const excel = makeReportButton('xls', 'Descarregar Excel');
                    const word = makeReportButton('doc', 'Descarregar Word');
                    reportControls.append(from.label, to.label, excel, word, exportStatus);
                    card.append(reportControls);
                }
                if (item.image_url) {
                    const imagePreview = node('img', 'admin-promotion-image-preview');
                    imagePreview.src = window.ImpactaAPI.assetUrl(item.image_url);
                    imagePreview.alt = '';
                    imagePreview.loading = 'lazy';
                    card.append(imagePreview);
                }
                if (item.target_url) card.append(node('small', '', item.target_url));

                const editor = node('details', 'admin-announcement-editor');
                editor.append(node('summary', 'admin-action-button', 'Editar anúncio'));
                const editForm = formShell('Editar destaque');
                editForm.noValidate = true;
                const editPlacement = selectField('Tipo de destaque', 'placement', [
                    ['notice', 'Aviso público'], ['announcement', 'Anúncio da comunidade'], ['advertisement', 'Publicidade']
                ]);
                editPlacement.control.value = item.placement;
                const editTitle = field('Título (opcional)', 'title', { required: false, maxLength: 160 });
                editTitle.control.value = item.title || '';
                const editBody = field('Mensagem (opcional)', 'body', { required: false, multiline: true, rows: 4, maxLength: 5000 });
                editBody.control.value = item.body || '';
                const editAdvertiserName = field('Nome do cliente (opcional)', 'advertiserName', { required: false, maxLength: 160 });
                editAdvertiserName.control.value = item.advertiser_name || '';
                const editAdvertiserEmail = field('E-mail do cliente (opcional)', 'advertiserEmail', { required: false, type: 'email', maxLength: 254 });
                editAdvertiserEmail.control.value = item.advertiser_email || '';
                const updateEditAdvertiserFields = () => {
                    const isAdvertisement = editPlacement.control.value === 'advertisement';
                    editAdvertiserName.label.hidden = !isAdvertisement;
                    editAdvertiserEmail.label.hidden = !isAdvertisement;
                };
                editPlacement.control.addEventListener('change', updateEditAdvertiserFields);
                updateEditAdvertiserFields();
                const editImage = promotionImageField('Substituir imagem (opcional)', item.image_url || '');
                editImage.control.required = false;
                const editTargetUrl = field('Ligação do botão (opcional)', 'targetUrl', { type: 'url', required: false, placeholder: 'https://exemplo.ao' });
                editTargetUrl.control.value = item.target_url || '';
                const editStatus = selectField('Publicação', 'status', [
                    ['draft', 'Guardar rascunho'], ['published', 'Publicar agora'],
                    ['scheduled', 'Agendar'], ['archived', 'Arquivar']
                ]);
                editStatus.control.value = ['draft', 'published', 'scheduled', 'archived'].includes(item.status) ? item.status : 'draft';
                const editPublishAt = field('Data e hora de publicação *', 'publishAt', { type: 'datetime-local', required: true });
                editPublishAt.control.value = localDateTimeValue(item.publish_at);
                const editExpiresAt = field('Expira em (opcional)', 'expiresAt', { type: 'datetime-local', required: false });
                editExpiresAt.control.value = localDateTimeValue(item.expires_at);
                const editStatusLine = statusNode(editForm, 'A imagem actual será mantida se não escolheres outra.');
                const editActions = node('div', 'admin-tool-inline-actions');
                const editSave = node('button', 'admin-action-button admin-action-hide', 'Guardar alterações');
                editSave.type = 'submit';
                const editCancel = node('button', 'admin-action-button', 'Cancelar');
                editCancel.type = 'button';
                editCancel.addEventListener('click', () => { editor.open = false; });
                editActions.append(editSave, editCancel);
                editForm.append(editPlacement.label, editTitle.label, editBody.label, editAdvertiserName.label,
                    editAdvertiserEmail.label, editImage.label, editTargetUrl.label, editStatus.label,
                    editPublishAt.label, editExpiresAt.label, editStatusLine, editActions);
                editForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    if (!editForm.reportValidity()) {
                        editStatusLine.textContent = 'Indica uma data e hora de publicação válidas.';
                        editStatusLine.classList.add('is-warning');
                        editPublishAt.control.focus();
                        return;
                    }
                    editSave.disabled = true;
                    editStatusLine.classList.remove('is-warning');
                    editStatusLine.textContent = 'A guardar alterações...';
                    let uploaded = null;
                    try {
                        uploaded = await uploadPromotionImage(editImage.control.files?.[0]);
                        await window.ImpactaAPI.request('/admin/announcements/' + encodeURIComponent(item.id), 'PUT', {
                            placement: editPlacement.control.value,
                            title: editTitle.control.value.trim(),
                            body: editBody.control.value.trim(),
                            status: editStatus.control.value,
                            imageId: uploaded?.id,
                            targetUrl: editTargetUrl.control.value.trim() || null,
                            advertiserName: editPlacement.control.value === 'advertisement' ? editAdvertiserName.control.value.trim() : null,
                            advertiserEmail: editPlacement.control.value === 'advertisement' ? editAdvertiserEmail.control.value.trim() : null,
                            publishAt: editPublishAt.control.value ? new Date(editPublishAt.control.value).toISOString() : undefined,
                            expiresAt: editExpiresAt.control.value ? new Date(editExpiresAt.control.value).toISOString() : null
                        });
                        await loadAnnouncements();
                        window.ImpactaModal?.notice({ title: 'Anúncio actualizado', message: 'As alterações foram guardadas e a lista foi actualizada.' });
                    } catch (error) {
                        editStatusLine.textContent = readableError(error, 'Não foi possível guardar as alterações.');
                        editStatusLine.classList.add('is-warning');
                        if (uploaded?.id) await removeUnusedPromotionImage(uploaded.id);
                    } finally { editSave.disabled = false; }
                });
                editor.append(editForm);
                card.append(editor);

                const actionRow = node('div', 'admin-tool-inline-actions');
                if (item.status !== 'archived') {
                    actionRow.append(actionButton(item.status === 'published' ? 'Arquivar' : 'Publicar agora', async () => {
                        if (!window.ImpactaModal?.confirm) {
                            status.textContent = 'O modal de confirmação não está disponível. Actualiza a página.';
                            status.classList.add('is-warning');
                            return;
                        }
                        const nextStatus = item.status === 'published' ? 'archived' : 'published';
                        const confirmed = await window.ImpactaModal.confirm({
                            title: nextStatus === 'archived' ? 'Arquivar este destaque?' : 'Publicar este destaque agora?',
                            message: nextStatus === 'archived'
                                ? 'O destaque deixará de aparecer ao público. As métricas e os relatórios ficam preservados.'
                                : 'O destaque ficará visível ao público assim que a alteração for guardada.',
                            confirmLabel: nextStatus === 'archived' ? 'Arquivar' : 'Publicar agora',
                            danger: nextStatus === 'archived'
                        });
                        if (!confirmed) return;
                        try {
                            await window.ImpactaAPI.request('/admin/announcements/' + encodeURIComponent(item.id) + '/status', 'POST', { status: nextStatus });
                            await loadAnnouncements();
                            window.ImpactaModal.notice({ title: nextStatus === 'archived' ? 'Destaque arquivado' : 'Destaque publicado', message: 'A lista foi actualizada.' });
                        } catch (error) {
                            status.textContent = readableError(error, 'Não foi possível actualizar o destaque.');
                            status.classList.add('is-warning');
                        }
                    }));
                    actionRow.append(actionButton('Eliminar anúncio', async () => {
                        if (!window.ImpactaModal?.confirm) {
                            status.textContent = 'O modal de confirmação não está disponível. Actualiza a página.';
                            status.classList.add('is-warning');
                            return;
                        }
                        const confirmed = await window.ImpactaModal.confirm({
                            title: 'Eliminar este anúncio?',
                            message: 'O anúncio será retirado da área pública. As métricas ficam guardadas para relatórios e facturas.',
                            confirmLabel: 'Eliminar anúncio',
                            danger: true
                        });
                        if (!confirmed) return;
                        try {
                            await window.ImpactaAPI.delete('/admin/announcements/' + encodeURIComponent(item.id));
                            await loadAnnouncements();
                            window.ImpactaModal.notice({ title: 'Anúncio eliminado', message: 'Foi retirado do site e as métricas foram preservadas.' });
                        } catch (error) {
                            status.textContent = readableError(error, 'Não foi possível eliminar o anúncio.');
                            status.classList.add('is-warning');
                        }
                    }, 'admin-action-button admin-action-remove'));
                }
                if (actionRow.childElementCount) card.append(actionRow);
                list.append(card);
            });
            setFooter('API ligada - avisos e publicidade carregados.');
        } catch (error) { showFailure(host, error, 'N\u00e3o foi poss\u00edvel carregar avisos e publicidade.'); }
    }

    async function loadRecognition() {
        const host = moduleHost('recognition');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('recognition');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar distintivos e pontos…');
        try {
            const data = await window.ImpactaAPI.request('/admin/recognition');
            setAnalyticsData('recognition', 'Distintivos', data.badges || [], { value: (data.badges || []).reduce((sum, item) => sum + (Number(item.awards) || 0), 0) });
            setAnalyticsData('recognition', 'Pessoas no quadro de pontos', data.leaders || []);
            status.textContent = `${data.badges.length} distintivo(s) · classificação atualizada.`;
            const profileCard = node('article', 'admin-tool-card admin-profile-preview');
            const profileCopy = node('div', 'admin-profile-preview-copy');
            profileCopy.append(
                node('strong', '', 'Perfil da conta administrativa'),
                node('p', '', 'Abre o perfil da sessão atual para confirmares os dados públicos.')
            );
            const profileLink = node('a', 'admin-action-button admin-profile-preview-link', 'Abrir perfil');
            profileLink.href = '../profile.html';
            profileCard.append(profileCopy, profileLink);
            host.append(profileCard);
            void window.ImpactaAPI.request('/profile').then((result) => {
                const profile = result?.profile;
                if (!profile?.id) {
                    profileCopy.querySelector('strong').textContent = 'Perfil indisponível';
                    return;
                }
                profileCopy.querySelector('strong').textContent = profile.displayName || 'Perfil da conta administrativa';
                profileCopy.querySelector('p').textContent = profile.isPublic
                    ? 'Perfil público da conta autenticada.'
                    : 'O perfil ainda é privado; abre a edição para rever os dados.';
                profileLink.href = profile.isPublic
                    ? `../profile.html?id=${encodeURIComponent(profile.id)}`
                    : '../profile.html';
                profileLink.textContent = profile.isPublic ? 'Ver perfil público' : 'Editar perfil';
            }).catch(() => {
                profileCopy.querySelector('p').textContent = 'Não foi possível carregar o perfil desta sessão.';
            });
            const badgeForm = formShell('Criar distintivo');
            const code = field('Código', 'code', { placeholder: 'ex.: colaborador_ativo', maxLength: 40 });
            const name = field('Nome', 'name', { maxLength: 100 });
            const description = field('Descrição', 'description', { multiline: true, rows: 2, required: false, maxLength: 500 });
            const create = node('button', 'admin-action-button admin-action-hide', 'Criar distintivo'); create.type = 'submit';
            badgeForm.append(code.label, name.label, description.label, create);
            badgeForm.addEventListener('submit', async (event) => {
                event.preventDefault(); create.disabled = true;
                try { await window.ImpactaAPI.request('/admin/recognition/badges', 'POST', { code: code.control.value, name: name.control.value, description: description.control.value }); await loadRecognition(); }
                catch (error) { status.textContent = readableError(error, 'Não foi possível criar o distintivo.'); status.classList.add('is-warning'); }
                finally { create.disabled = false; }
            });
            const pointsForm = formShell('Ajustar pontos');
            const userId = field('Identificador do utilizador', 'userId', { type: 'number', min: 1 });
            const points = field('Pontos (+/-)', 'points', { type: 'number', min: -1000, max: 1000 });
            const reason = field('Motivo', 'reason', { maxLength: 500 });
            const adjust = node('button', 'admin-action-button admin-action-hide', 'Registar pontos'); adjust.type = 'submit';
            pointsForm.append(userId.label, points.label, reason.label, adjust);
            pointsForm.addEventListener('submit', async (event) => {
                event.preventDefault(); adjust.disabled = true;
                try { await window.ImpactaAPI.request('/admin/recognition/points', 'POST', { userId: userId.control.value, points: Number(points.control.value), reason: reason.control.value }); await loadRecognition(); }
                catch (error) { status.textContent = readableError(error, 'Não foi possível registar os pontos.'); status.classList.add('is-warning'); }
                finally { adjust.disabled = false; }
            });
            const awardForm = formShell('Atribuir distintivo');
            const awardUser = field('Identificador do utilizador', 'userId', { type: 'number', min: 1 });
            const badge = selectField('Distintivo', 'badgeId', [['', 'Escolhe um distintivo'], ...data.badges.filter((item) => item.is_active).map((item) => [item.id, item.name])]);
            const awardReason = field('Motivo', 'reason', { maxLength: 500 });
            const award = node('button', 'admin-action-button admin-action-hide', 'Atribuir distintivo'); award.type = 'submit';
            awardForm.append(awardUser.label, badge.label, awardReason.label, award);
            awardForm.addEventListener('submit', async (event) => {
                event.preventDefault(); award.disabled = true;
                try { await window.ImpactaAPI.request(`/admin/recognition/users/${encodeURIComponent(awardUser.control.value)}/badges`, 'POST', { badgeId: badge.control.value, reason: awardReason.control.value }); await loadRecognition(); }
                catch (error) { status.textContent = readableError(error, 'Não foi possível atribuir o distintivo.'); status.classList.add('is-warning'); }
                finally { award.disabled = false; }
            });
            host.append(badgeForm, pointsForm, awardForm, node('h3', 'admin-tool-section-title', 'Distintivos'), cardList(host));
            const lists = host.querySelectorAll('.admin-tool-list');
            const badgesList = lists[0];
            if (!data.badges.length) empty(badgesList, 'Ainda não há distintivos.');
            data.badges.forEach((item) => badgesList.append(node('article', 'admin-tool-card', `${item.name} · ${item.awards} atribuição(ões) · ${item.is_active ? 'ativo' : 'inativo'}`)));
            const leaders = node('div', 'admin-tool-list');
            (data.leaders || []).forEach((item) => leaders.append(node('article', 'admin-tool-card', `${item.display_name} · ${item.points} pontos`)));
            if (!data.leaders?.length) empty(leaders, 'Ainda não há registos de pontos.');
            host.append(node('h3', 'admin-tool-section-title', 'Pessoas reconhecidas'), leaders);
            setFooter('API ligada · reconhecimento carregado.');
        } catch (error) { showFailure(host, error, 'Não foi possível carregar o reconhecimento.'); }
    }

    async function loadPrivacy() {
        const host = moduleHost('privacy');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('privacy');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar pedidos de privacidade…');
        const list = cardList(host);
        try {
            const data = await window.ImpactaAPI.request('/admin/privacy');
            setAnalyticsData('privacy', 'Pedidos de privacidade', data.items || []);
            status.textContent = `${data.items.length} pedido(s) no histórico.`;
            if (!data.items.length) empty(list, 'Não há pedidos de privacidade registados.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', `${localizedPrivacyRequest(item.request_type)} · ${item.user_name}`), node('p', '', `${localizedStatus(item.status)} · recebido ${new Date(item.created_at).toLocaleString('pt-AO')}`), node('small', '', item.email || 'Conta encerrada'));
                const form = node('form', 'admin-tool-inline-form');
                const state = selectField('Estado', 'status', [['reviewing', 'Em análise'], ['waiting_user', 'À espera do utilizador'], ['completed', 'Concluído'], ['rejected', 'Rejeitado']]);
                state.control.value = item.status === 'received' ? 'reviewing' : item.status;
                const notes = field('Notas da decisão', 'notes', { multiline: true, rows: 2, required: false, maxLength: 2000, placeholder: 'Notas visíveis na auditoria do pedido.' });
                notes.control.value = item.notes || '';
                const save = node('button', 'admin-action-button admin-action-hide', 'Actualizar pedido de privacidade'); save.type = 'submit';
                form.append(state.label, notes.label, save);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                saveStatus.classList.remove('is-warning');
                if (!form.reportValidity()) {
                    const invalidControl = [...form.elements].find((control) => control.willValidate && !control.checkValidity());
                    saveStatus.textContent = invalidControl === image.control
                        ? 'Escolhe a imagem obrigatória antes de guardar.'
                        : invalidControl === publishAt.control
                            ? 'Indica uma data e hora de publicação válidas.'
                            : 'Revê os campos assinalados antes de guardar.';
                    saveStatus.classList.add('is-warning');
                    invalidControl?.focus();
                    return;
                }
                save.disabled = true;
                    try { await window.ImpactaAPI.request(`/admin/privacy/${encodeURIComponent(item.id)}/status`, 'POST', { status: state.control.value, notes: notes.control.value }); await loadPrivacy(); }
                    catch (error) { status.textContent = readableError(error, 'Não foi possível atualizar o pedido.'); status.classList.add('is-warning'); }
                    finally { save.disabled = false; }
                });
                card.append(form); list.append(card);
            });
            setFooter('API ligada · pedidos de privacidade carregados.');
        } catch (error) { status.textContent = readableError(error, 'Não foi possível carregar os pedidos.'); status.classList.add('is-warning'); setAnalyticsUnavailable('privacy', 'Os pedidos de privacidade estão restritos ou indisponíveis.'); }
    }

    async function loadAudit() {
        const host = moduleHost('audit');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('audit');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar registo de auditoria…');
        const list = cardList(host);
        try {
            const data = await window.ImpactaAPI.request('/admin/audit?limit=100');
            setAnalyticsData('audit', 'Eventos de auditoria carregados', data.items || []);
            status.textContent = `${data.items.length} evento(s) mais recentes.`;
            if (!data.items.length) empty(list, 'Ainda não há eventos de auditoria.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', auditActionLabel(item.action_code)), node('p', '', `${item.actor_name || 'Conta encerrada'} · ${auditTargetLabel(item.target_type, item.target_id)}`), node('small', '', `${new Date(item.occurred_at).toLocaleString('pt-AO')}${item.reason ? ` · ${auditReasonLabel(item.reason)}` : ''}`));
                list.append(card);
            });
            setFooter('API ligada · auditoria carregada.');
        } catch (error) { status.textContent = readableError(error, 'Não foi possível carregar a auditoria.'); status.classList.add('is-warning'); setAnalyticsUnavailable('audit', 'O registo de auditoria está restrito ou indisponível.'); }
    }

    async function loadSecurity() {
        const host = moduleHost('security');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('security');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar as tuas sessões…');
        const list = cardList(host);
        try {
            const data = await window.ImpactaAPI.request('/admin/security/sessions');
            setAnalyticsData('security', 'Sessões desta conta', data.items || []);
            status.textContent = `${data.items.length} sessão(ões) ativas na tua conta.`;
            if (!data.items.length) empty(list, 'Não há sessões ativas.');
            data.items.forEach((item) => {
                const card = node('article', 'admin-tool-card');
                card.append(node('strong', '', item.is_current ? 'Esta sessão' : 'Outra sessão'), node('p', '', `${item.user_agent || 'Dispositivo não identificado'} · ${item.ip_address || 'IP indisponível'}`), node('small', '', `Última actividade: ${new Date(item.last_seen_at).toLocaleString('pt-AO')}`));
                if (!item.is_current) {
                    const revoke = actionButton('Revogar sessão', async () => {
                        revoke.disabled = true;
                        try { await window.ImpactaAPI.request(`/admin/security/sessions/${encodeURIComponent(item.id)}/revoke`, 'POST', {}); await loadSecurity(); }
                        catch (error) { status.textContent = readableError(error, 'Não foi possível revogar a sessão.'); status.classList.add('is-warning'); }
                        finally { revoke.disabled = false; }
                    }, 'admin-action-button admin-action-remove');
                    card.append(revoke);
                }
                list.append(card);
            });
            host.append(node('h3', 'admin-security-signals-title', 'Inscrições automáticas sinalizadas'));
            host.append(node('p', 'admin-security-signals-copy', 'São sinais para análise, não prova de fraude. As redes aparecem parcialmente ocultas e nenhuma conta é suspensa por partilhar um IP.'));
            const signalStatus = statusNode(host, 'A consultar sinais recentes…');
            const signalList = cardList(host);
            try {
                const signalData = await window.ImpactaAPI.request('/admin/security/registration-signals');
                const signals = Array.isArray(signalData.items) ? signalData.items : [];
                setAnalyticsData('security', 'Sinais recentes de registo', signals);
                signalStatus.textContent = `${signals.length} rede(s) com tentativas sinalizadas nos últimos ${signalData.windowDays ?? 30} dias.`;
                if (!signals.length) empty(signalList, 'Não há tentativas sinalizadas neste período.');
                signals.forEach((item) => {
                    const card = node('article', 'admin-tool-card');
                    const heading = node('div', 'admin-tool-card-heading');
                    heading.append(node('strong', '', item.network_prefix || 'Rede não identificada'), node('span', 'admin-tool-pill', 'Sinal para análise'));
                    card.append(heading);
                    card.append(node('p', '', `${item.attempts} formulário(s) automáticos detectados.`));
                    card.append(node('small', '', `Última detecção: ${new Date(item.last_seen).toLocaleString('pt-AO')}`));
                    signalList.append(card);
                });
            } catch (error) {
                signalStatus.textContent = readableError(error, 'Não foi possível consultar os sinais de inscrição.');
                signalStatus.classList.add('is-warning');
                setAnalyticsUnavailable('security', 'Os sinais de registo estão restritos ou indisponíveis.');
            }
            setFooter('API ligada · sessões da tua conta carregadas.');
        } catch (error) { status.textContent = readableError(error, 'Não foi possível carregar as sessões.'); status.classList.add('is-warning'); setAnalyticsUnavailable('security', 'As sessões administrativas estão restritas ou indisponíveis.'); }
    }

    async function appendMaintenanceControls(host) {
        const form = formShell('Disponibilidade da plataforma');
        form.append(node('p', 'admin-tool-description', 'O modo de manutenção bloqueia os serviços públicos e mantém a área administrativa disponível.'));
        const mode = selectField('Acesso público', 'enabled', [['false', 'Site disponível'], ['true', 'Modo de manutenção']]);
        const message = field('Mensagem para visitantes (máximo 300 caracteres)', 'message', { multiline: true, rows: 3, required: false, maxLength: 300 });
        const save = node('button', 'admin-action-button', 'Guardar estado');
        save.type = 'submit';
        const status = statusNode(form, 'A carregar o estado da plataforma...');
        form.append(mode.label, message.label, save);
        host.append(form);
        try {
            const current = await window.ImpactaAPI.request('/admin/settings/maintenance');
            mode.control.value = current.enabled ? 'true' : 'false';
            message.control.value = current.message || '';
            status.textContent = current.enabled ? 'Manutenção ativa; só os serviços administrativos estão disponíveis.' : 'A plataforma está disponível ao público.';
        } catch (error) {
            status.textContent = readableError(error, 'Não foi possível carregar o estado de manutenção.');
            status.classList.add('is-warning');
            mode.control.disabled = true;
            message.control.disabled = true;
            save.disabled = true;
            return;
        }
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            save.disabled = true;
            status.classList.remove('is-warning');
            try {
                const updated = await window.ImpactaAPI.request('/admin/settings/maintenance', 'PUT', {
                    enabled: mode.control.value === 'true',
                    message: message.control.value
                });
                status.textContent = updated.enabled
                    ? 'Modo de manutenção ativado. A área pública será bloqueada em instantes.'
                    : 'Modo de manutenção desativado. A plataforma está novamente disponível.';
                setFooter(updated.enabled ? 'Manutenção ativada; a área administrativa continua disponível.' : 'A plataforma está novamente disponível.');
            } catch (error) {
                status.textContent = readableError(error, 'Não foi possível alterar o estado da plataforma.');
                status.classList.add('is-warning');
            } finally { save.disabled = false; }
        });
    }

    function appendBackupControls(host) {
        const form = formShell('Cópia de segurança da base de dados');
        form.append(node('p', 'admin-tool-description', 'Gera um ficheiro PostgreSQL restaurável e descarrega-o directamente. A operação exige MFA e fica registada na auditoria.'));
        const reason = field('Motivo do backup', 'reason', { required: true, maxLength: 240, placeholder: 'Ex.: cópia antes de uma atualização' });
        reason.control.minLength = 5;
        const create = node('button', 'admin-action-button', 'Criar e descarregar backup');
        create.type = 'submit';
        const status = statusNode(form, 'O backup só é criado quando solicitado.');
        form.append(reason.label, create);
        host.append(form);
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            create.disabled = true;
            status.classList.remove('is-warning');
            status.textContent = 'A criar o backup da base de dados...';
            try {
                const result = await window.ImpactaAPI.download('/admin/backups/export', 'POST', { reason: reason.control.value });
                const url = URL.createObjectURL(result.blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = result.filename;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 60000);
                status.textContent = 'Backup criado e descarregado com sucesso.';
                setFooter('Backup criado e registado na auditoria.');
            } catch (error) {
                status.textContent = readableError(error, 'Não foi possível criar o backup.');
                status.classList.add('is-warning');
            } finally { create.disabled = false; }
        });
    }
    async function loadSettings() {
        const host = moduleHost('settings');
        if (!host || !window.ImpactaAPI) return;
        resetAnalytics('settings');
        host.replaceChildren();
        const status = statusNode(host, 'A carregar aviso p\u00fablico...');
        try {
            const data = await window.ImpactaAPI.request('/admin/settings/homepage-notice');
            setAnalyticsData('settings', 'Estado do aviso público', [{ status: data.message ? 'Aviso activo' : 'Sem aviso activo' }]);
            setAnalyticsData('settings', 'Composição do aviso', [
                ...(data.message ? [{ status: 'Texto configurado' }] : []),
                ...(data.imageUrl ? [{ status: 'Imagem configurada' }] : [])
            ]);
            status.textContent = 'O destaque aparece na p\u00e1gina inicial, no feed e nos perfis p\u00fablicos.';
            const form = formShell('Aviso p\u00fablico da plataforma');
            const message = field('Mensagem p\u00fablica (m\u00e1ximo 240 caracteres)', 'message', { multiline: true, rows: 3, required: false, maxLength: 240 });
            message.control.value = data.message || '';
            const image = promotionImageField('Imagem do aviso (opcional)', data.imageUrl || '');
            let currentImageId = data.imageId || '';
            let removeImage = false;
            image.control.addEventListener('change', () => { if (image.control.files?.length) removeImage = false; });
            const clearImage = actionButton('Remover imagem', () => {
                image.control.value = '';
                image.setPreview('');
                removeImage = true;
            }, 'admin-refresh-button');
            const save = node('button', 'admin-action-button admin-action-hide', 'Publicar aviso'); save.type = 'submit';
            const clear = actionButton('Remover aviso', async () => {
                clear.disabled = true;
                try {
                    await window.ImpactaAPI.request('/admin/settings/homepage-notice', 'PUT', { message: '', imageId: null });
                    await removeUnusedPromotionImage(currentImageId);
                    currentImageId = '';
                    removeImage = false;
                    message.control.value = '';
                    image.control.value = '';
                    image.setPreview('');
                    status.textContent = 'Aviso e imagem removidos do destaque p\u00fablico.';
                } catch (error) { status.textContent = readableError(error, 'N\u00e3o foi poss\u00edvel remover o aviso.'); status.classList.add('is-warning'); }
                finally { clear.disabled = false; }
            }, 'admin-refresh-button');
            form.append(message.label, image.label, clearImage, save, clear);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                saveStatus.classList.remove('is-warning');
                if (!form.reportValidity()) {
                    const invalidControl = [...form.elements].find((control) => control.willValidate && !control.checkValidity());
                    saveStatus.textContent = invalidControl === image.control
                        ? 'Escolhe a imagem obrigatória antes de guardar.'
                        : invalidControl === publishAt.control
                            ? 'Indica uma data e hora de publicação válidas.'
                            : 'Revê os campos assinalados antes de guardar.';
                    saveStatus.classList.add('is-warning');
                    invalidControl?.focus();
                    return;
                }
                save.disabled = true;
                if (!message.control.value.trim()) {
                    status.textContent = 'Escreve a mensagem do aviso. Para apagar tudo, usa “Remover aviso”.';
                    status.classList.add('is-warning');
                    save.disabled = false;
                    return;
                }
                let uploaded = null;
                try {
                    uploaded = await uploadPromotionImage(image.control.files?.[0]);
                    const nextImageId = uploaded?.id ?? (removeImage ? null : currentImageId || null);
                    await window.ImpactaAPI.request('/admin/settings/homepage-notice', 'PUT', {
                        message: message.control.value,
                        imageId: nextImageId
                    });
                    if (currentImageId && currentImageId !== nextImageId) await removeUnusedPromotionImage(currentImageId);
                    currentImageId = nextImageId || '';
                    removeImage = false;
                    image.control.value = '';
                    image.setPreview(currentImageId
                        ? window.ImpactaAPI.assetUrl('/api/v1/media/' + encodeURIComponent(currentImageId))
                        : '');
                    status.textContent = 'Aviso publicado na p\u00e1gina inicial, no feed e nos perfis.';
                    setFooter('API ligada - destaque p\u00fablico atualizado.');
                } catch (error) {
                    if (uploaded?.id) await removeUnusedPromotionImage(uploaded.id);
                    status.textContent = readableError(error, 'N\u00e3o foi poss\u00edvel publicar o aviso.');
                    status.classList.add('is-warning');
                } finally { save.disabled = false; }
            });
            host.append(form);
            await appendMaintenanceControls(host);
            appendBackupControls(host);
            setFooter('API ligada - configura\u00e7\u00f5es carregadas.');
        } catch (error) { status.textContent = readableError(error, 'N\u00e3o foi poss\u00edvel carregar as configura\u00e7\u00f5es.'); status.classList.add('is-warning'); setAnalyticsUnavailable('settings', 'As configura\u00e7\u00f5es est\u00e3o restritas ou indispon\u00edveis.'); }
    }

    async function load(name) {
        const loaders = {
            overview: loadOverview,
            users: loadUsers,
            verifications: loadAccountVerifications,
            roles: loadRoles,
            communities: loadCommunities,
            projects: loadProjects,
            moderation: loadModeration,
            announcements: loadAnnouncements,
            recognition: loadRecognition,
            privacy: loadPrivacy,
            audit: loadAudit,
            security: loadSecurity,
            settings: loadSettings
        };
        if (!loaders[name]) return;
        if (!window.ImpactaAPI) {
            resetAnalytics(name);
            setAnalyticsUnavailable(name, 'A API administrativa está indisponível.');
            const host = moduleHost(name);
            if (host) {
                host.replaceChildren();
                statusNode(host, 'A API não está disponível. Atualiza a página quando o serviço estiver ativo.', 'warning');
            }
            return;
        }
        await loaders[name]();
    }

    window.ImpactaAdminModules = Object.freeze({
        load,
        resetAnalytics,
        setAnalyticsData,
        setAnalyticsUnavailable
    });
})();

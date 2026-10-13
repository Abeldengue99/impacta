(() => {
    if (window.ImpactaModal) return;

    const dialog = document.createElement('dialog');
    dialog.className = 'impacta-action-dialog';
    dialog.setAttribute('aria-labelledby', 'impacta-action-title');
    dialog.setAttribute('aria-describedby', 'impacta-action-message');

    const card = document.createElement('section');
    card.className = 'impacta-action-card';

    const header = document.createElement('header');
    header.className = 'impacta-action-header';
    const mark = document.createElement('span');
    mark.className = 'impacta-action-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'i';
    const close = document.createElement('button');
    close.className = 'impacta-action-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar janela');
    close.textContent = '×';
    header.append(mark, close);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'impacta-action-eyebrow';
    eyebrow.textContent = 'COMUNIDADE IMPACTA';
    const title = document.createElement('h2');
    title.className = 'impacta-action-title';
    title.id = 'impacta-action-title';
    const message = document.createElement('p');
    message.className = 'impacta-action-message';
    message.id = 'impacta-action-message';

    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'impacta-action-field-wrap';
    fieldWrap.hidden = true;
    const fieldLabel = document.createElement('label');
    fieldLabel.className = 'impacta-action-field-label';
    const field = document.createElement('input');
    field.className = 'impacta-action-field';
    field.autocomplete = 'off';
    fieldWrap.append(fieldLabel, field);

    const status = document.createElement('p');
    status.className = 'impacta-action-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;

    const actions = document.createElement('footer');
    actions.className = 'impacta-action-actions';
    const cancel = document.createElement('button');
    cancel.className = 'impacta-action-button impacta-action-cancel';
    cancel.type = 'button';
    const confirm = document.createElement('button');
    confirm.className = 'impacta-action-button impacta-action-confirm';
    confirm.type = 'submit';
    actions.append(cancel, confirm);

    const form = document.createElement('form');
    form.className = 'impacta-action-content';
    form.noValidate = true;
    form.append(eyebrow, title, message, fieldWrap, status, actions);
    card.append(header, form);
    dialog.append(card);
    document.body.append(dialog);

    let settleCurrent = null;
    let closingResolution = null;
    let returnFocus = null;
    let activeType = 'confirm';
    let autoCloseTimer = null;
    let queue = Promise.resolve();

    function clearAutoCloseTimer() {
        if (autoCloseTimer !== null) window.clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
    }

    function restoreFocus() {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }

    function finishCancelled() {
        if (!settleCurrent) return;
        const resolve = settleCurrent;
        settleCurrent = null;
        resolve(activeType === 'confirm' ? false : null);
    }

    function settle(value) {
        if (!settleCurrent) return;
        clearAutoCloseTimer();
        const resolve = settleCurrent;
        settleCurrent = null;
        if (dialog.open && typeof dialog.close === 'function') {
            closingResolution = { resolve, value };
            dialog.close();
        } else {
            dialog.removeAttribute('open');
            document.body.classList.remove('impacta-action-modal-open');
            restoreFocus();
            resolve(value);
        }
    }

    function open(type, options = {}) {
        clearAutoCloseTimer();
        activeType = type;
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return new Promise((resolve) => {
            settleCurrent = resolve;
            dialog.className = 'impacta-action-dialog' + (options.danger ? ' is-danger' : '')
                + (type === 'notice' ? ' is-notice' : '');
            if (type === 'notice') {
                dialog.setAttribute('role', 'status');
                dialog.setAttribute('aria-live', 'polite');
            } else {
                dialog.removeAttribute('role');
                dialog.removeAttribute('aria-live');
            }
            title.textContent = options.title || (type === 'copy' ? 'Partilhar ligação' : 'Confirmar ação');
            if (type === 'notice' && !options.title) title.textContent = 'Aviso';
            message.textContent = options.message || '';
            if (type === 'notice' && !options.message) message.textContent = 'A ação foi concluída.';
            eyebrow.textContent = options.eyebrow || 'COMUNIDADE IMPACTA';
            mark.textContent = type === 'copy' ? '↗' : type === 'confirm' ? '?' : 'i';
            if (type === 'notice') mark.textContent = options.icon || (options.danger ? '!' : '✓');
            cancel.textContent = options.cancelLabel || (type === 'alert' || type === 'copy' ? 'Fechar' : 'Cancelar');
            cancel.hidden = type === 'alert' || type === 'notice';
            confirm.hidden = type === 'notice';
            confirm.textContent = options.confirmLabel || (type === 'alert' ? 'Entendido' : type === 'copy' ? 'Copiar ligação' : type === 'prompt' ? 'Continuar' : 'Confirmar');
            confirm.classList.toggle('is-danger', Boolean(options.danger));
            fieldWrap.hidden = type !== 'prompt' && type !== 'copy';
            status.textContent = '';
            status.hidden = true;
            field.value = type === 'copy' ? String(options.text ?? '') : String(options.defaultValue ?? '');
            field.type = type === 'prompt' ? (options.inputType || 'text') : 'text';
            field.readOnly = type === 'copy' || Boolean(options.readOnly);
            field.required = type === 'prompt' && Boolean(options.required);
            field.maxLength = Number.isInteger(options.maxLength) ? options.maxLength : 2000;
            field.placeholder = options.placeholder || '';
            fieldLabel.textContent = options.inputLabel || (type === 'copy' ? 'Ligação' : 'Resposta');
            field.id = 'impacta-action-field';
            fieldLabel.htmlFor = field.id;
            confirm.disabled = false;

            if (typeof dialog.showModal === 'function') dialog.showModal();
            else {
                dialog.setAttribute('open', '');
                document.body.classList.add('impacta-action-modal-open');
            }

            window.requestAnimationFrame(() => {
                if (type === 'prompt' || type === 'copy') {
                    field.focus();
                    if (type === 'copy' || options.selectOnOpen !== false) field.select();
                } else if (type === 'confirm') {
                    cancel.focus();
                } else if (type === 'notice') {
                    close.focus();
                } else {
                    confirm.focus();
                }
            });
            if (type === 'notice') {
                const requestedDuration = Number(options.durationMs);
                const durationMs = Number.isFinite(requestedDuration)
                    ? Math.max(1200, Math.min(5000, requestedDuration))
                    : 2200;
                autoCloseTimer = window.setTimeout(() => settle(null), durationMs);
            }
        });
    }

    function enqueue(type, options) {
        const task = () => open(type, options);
        const result = queue.then(task, task);
        queue = result.then(() => undefined, () => undefined);
        return result;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (activeType === 'copy') {
            try {
                if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
                await navigator.clipboard.writeText(field.value);
                status.textContent = 'Ligação copiada. Já podes partilhá-la.';
                status.hidden = false;
                confirm.textContent = 'Copiada';
                confirm.disabled = true;
                window.setTimeout(() => settle(true), 650);
            } catch {
                field.focus();
                field.select();
                status.textContent = 'A ligação está selecionada. Copia-a com Ctrl+C ou Cmd+C; no telemóvel, mantém o dedo pressionado e escolhe Copiar.';
                status.hidden = false;
                confirm.textContent = 'Tentar copiar novamente';
            }
            return;
        }
        if (activeType === 'prompt') {
            if (field.required && !field.value.trim()) {
                status.textContent = 'Preenche este campo para continuar.';
                status.hidden = false;
                field.focus();
                return;
            }
            settle(field.value);
            return;
        }
        settle(activeType === 'confirm');
    });

    cancel.addEventListener('click', () => settle(activeType === 'confirm' ? false : null));
    close.addEventListener('click', () => settle(activeType === 'confirm' ? false : null));
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        settle(activeType === 'confirm' ? false : null);
    });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) settle(activeType === 'confirm' ? false : null);
    });
    dialog.addEventListener('close', () => {
        document.body.classList.remove('impacta-action-modal-open');
        if (closingResolution) {
            const closed = closingResolution;
            closingResolution = null;
            restoreFocus();
            closed.resolve(closed.value);
        } else {
            finishCancelled();
            restoreFocus();
        }
    });

    window.ImpactaModal = Object.freeze({
        confirm: (options) => enqueue('confirm', options),
        alert: (options) => enqueue('alert', options),
        notice: (options) => enqueue('notice', options),
        prompt: (options) => enqueue('prompt', options),
        copy: (options) => enqueue('copy', options)
    });
})();

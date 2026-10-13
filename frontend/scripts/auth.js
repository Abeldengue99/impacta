const authPost = (path, body) => window.ImpactaAPI.post(`/auth${path}`, body);

const authModal = document.querySelector('.auth-modal');
if (authModal && document.body.classList.contains('auth-modal-page')) {
    if (!authModal.open && typeof authModal.showModal === 'function') authModal.showModal();
    else if (!authModal.open) authModal.setAttribute('open', '');
    authModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        window.location.assign('index.html');
    });
}

function showAuthStatus(node, message) {
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
}

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
        const inputId = button.getAttribute('aria-controls');
        const input = inputId ? document.getElementById(inputId) : null;
        if (!(input instanceof HTMLInputElement)) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.textContent = reveal ? 'Ocultar' : 'Mostrar';
        button.setAttribute('aria-label', reveal ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe');
        button.setAttribute('aria-pressed', String(reveal));
    });
});

function authErrorMessage(error) {
    const messages = {
        too_many_requests: 'Atingiste o limite de tentativas. Aguarda antes de voltar a tentar.',
        email_delivery_unavailable: 'Não foi possível enviar o email. A configuração SMTP precisa de ser concluída.',
        auth_configuration_unavailable: 'A configuração segura da API está incompleta.',
        invalid_registration: 'Confirma o nome, o email e se as palavras-passe coincidem.',
        verification_invalid_or_expired: 'O código está incorreto ou expirou. Pede outro código.',
        invalid_credentials: 'Email ou palavra-passe incorretos.',
        session_not_persisted: 'A palavra-passe foi aceite, mas o navegador não confirmou a sessão. Atualiza a página e tenta novamente.',
        login_unavailable: 'Não foi possível iniciar sessão porque faltam permissões de autenticação na base de dados. Aplica a migração 20261009-login-rate-limit-recovery.sql como proprietário da base e tenta novamente.',
        administrative_access_unavailable: 'Não foi possível confirmar com segurança as permissões da conta. Tenta novamente mais tarde; nenhum acesso administrativo foi iniciado.',
        password_reset_invalid_or_expired: 'Este link já foi usado ou expirou. Pede um novo link.',
        password_reset_unavailable: 'Não foi possível alterar a palavra-passe. Tenta novamente.',
        email_not_verified: 'Confirma o email antes de iniciares sessão. Podes pedir outro código ao iniciar novamente o registo com o mesmo email.',
        mfa_required: 'Esta conta precisa de confirmação multifactor. Inicia novamente a sessão para proteger a área administrativa.',
        mfa_configuration_unavailable: 'A protecção multifactor ainda não está configurada no servidor. A equipa técnica deve definir a chave de encriptação MFA.',
        mfa_challenge_invalid: 'Este pedido de autenticação expirou. Inicia sessão novamente.',
        mfa_invalid_code: 'O código não está correcto ou já foi usado. Confirma a hora da app e tenta novamente.',
        mfa_already_enabled: 'A autenticação multifactor já foi activada. Inicia sessão novamente.',
        api_unavailable: 'Não foi possível contactar a API. Confirma se o backend está ativo.',
        api_timeout: 'A plataforma demorou demasiado a responder. Tenta novamente.'
    };
    return messages[error?.code] || 'Não foi possível concluir o pedido. Tenta novamente.';
}

const registerForm = document.querySelector('#register-form');
const verificationForm = document.querySelector('#verification-form');
const registrationSuccess = document.querySelector('#registration-success');

if (registerForm && verificationForm) {
    const registrationDialog = registerForm.closest('.auth-modal');
    const registrationHeading = registrationDialog?.querySelector('.auth-modal-heading h1');
    const registrationSubtitle = registrationDialog?.querySelector('.auth-modal-heading .auth-subtitle');
    const registerStatus = document.querySelector('#register-status');
    const verificationStatus = document.querySelector('#verification-status');
    const verificationEmail = verificationForm.querySelector('#verification-email');
    const codeField = verificationForm.querySelector('#verification-code');
    const verificationName = verificationForm.querySelector('#verification-name');
    const password = verificationForm.querySelector('#verification-password');
    const confirmation = verificationForm.querySelector('#verification-password-confirm');
    const registerButton = registerForm.querySelector('button[type="submit"]');
    let currentEmail = '';

    const validatePasswords = () => {
        confirmation.setCustomValidity(
            confirmation.value && confirmation.value !== password.value
                ? 'As palavras-passe n\u00e3o coincidem.'
                : ''
        );
    };

    password.addEventListener('input', validatePasswords);
    confirmation.addEventListener('input', validatePasswords);

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!registerForm.reportValidity()) return;
        registerButton.disabled = true;
        showAuthStatus(registerStatus, 'A criar a conta e a enviar o c\u00f3digo...');
        try {
            const payload = await authPost('/register', {
                displayName: registerForm.elements.displayName.value,
                email: registerForm.elements.email.value,
                companyWebsite: registerForm.elements.companyWebsite.value
            });
            currentEmail = registerForm.elements.email.value.trim();
            verificationEmail.value = currentEmail;
            verificationName.value = registerForm.elements.displayName.value.trim();
            registerForm.hidden = true;
            registerStatus.hidden = true;
            verificationForm.hidden = false;
            if (registrationHeading) registrationHeading.textContent = 'Confirmar e-mail';
            if (registrationSubtitle) registrationSubtitle.textContent = 'Introduz o código recebido e define a tua palavra-passe para ativares a conta.';
            showAuthStatus(verificationStatus, payload.message || 'Se o endereço puder ser registado, receberás um código por email.');
            codeField.focus();
        } catch (error) {
            showAuthStatus(registerStatus, authErrorMessage(error));
        } finally {
            registerButton.disabled = false;
        }
    });

    verificationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        validatePasswords();
        if (!verificationForm.reportValidity()) return;
        const submitButton = verificationForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        showAuthStatus(verificationStatus, 'A confirmar o c\u00f3digo...');
        try {
            await authPost('/verification/confirm', {
                email: verificationEmail.value,
                code: codeField.value.trim(),
                displayName: verificationName.value.trim(),
                password: password.value,
                passwordConfirmation: confirmation.value
            });
            verificationForm.hidden = true;
            registrationSuccess.hidden = false;
            if (registrationHeading) registrationHeading.textContent = 'Email confirmado.';
            if (registrationSubtitle) registrationSubtitle.textContent = 'A tua conta IMPACTA est\u00e1 ativa.';
        } catch (error) {
            showAuthStatus(verificationStatus, authErrorMessage(error));
        } finally {
            submitButton.disabled = false;
        }
    });

    document.querySelector('#resend-code').addEventListener('click', async () => {
        const resendButton = document.querySelector('#resend-code');
        resendButton.disabled = true;
        try {
            const payload = await authPost('/verification/resend', { email: currentEmail || verificationEmail.value });
            showAuthStatus(verificationStatus, payload.message || 'Se o endereço puder ser registado, receberás um novo c\u00f3digo por email.');
        } catch (error) {
            showAuthStatus(verificationStatus, authErrorMessage(error));
        } finally {
            resendButton.disabled = false;
        }
    });

    document.querySelector('#back-register').addEventListener('click', () => {
        verificationForm.hidden = true;
        registerForm.hidden = false;
        verificationStatus.hidden = true;
        if (registrationHeading) registrationHeading.textContent = 'Criar conta';
        if (registrationSubtitle) registrationSubtitle.textContent = 'Começa com o teu nome e e-mail. Depois confirmas o endereço.';
    });
}

const loginForm = document.querySelector('#login-form');
const accountDestinationModal = document.querySelector('#account-destination-modal');
const mfaLoginForm = document.querySelector('#mfa-login-form');
const mfaSetupForm = document.querySelector('#mfa-setup-form');
const mfaRecoveryPanel = document.querySelector('#mfa-recovery-panel');
let mfaChallengeToken = '';
let pendingAuthenticatedResult = null;

if (accountDestinationModal instanceof HTMLDialogElement) {
    accountDestinationModal.querySelectorAll('[data-account-destination]').forEach((choice) => {
        choice.addEventListener('click', () => {
            const destination = choice.getAttribute('data-account-destination');
            const pages = {
                profile: 'profile.html',
                admin: 'admin/index.html#overview',
                feed: 'feed.html'
            };
            if (!destination || !pages[destination]) return;
            window.location.assign(new URL(pages[destination], window.location.href));
        });
    });

    accountDestinationModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        window.location.assign(new URL('feed.html', window.location.href));
    });
}

if (loginForm) {
    const status = document.querySelector('#login-status');
    const button = loginForm.querySelector('button[type="submit"]');

    const continueToAccount = (result, session) => {
        const cachedAvatar = window.ImpactaAPI.cachedAvatarPreview();
        if (cachedAvatar && cachedAvatar.userId !== String(session.user?.id || '')) {
            window.ImpactaAPI.clearAvatarPreview();
        }
        const canEnterAdmin = result?.canEnterAdmin === true;
        if (canEnterAdmin && accountDestinationModal instanceof HTMLDialogElement) {
            const displayName = session.user?.displayName || result.user?.displayName;
            const greeting = accountDestinationModal.querySelector('#account-destination-copy');
            if (greeting && displayName) greeting.textContent = `Olá, ${displayName}. Escolhe onde queres continuar.`;
            if (status) status.hidden = true;
            if (typeof accountDestinationModal.showModal === 'function') accountDestinationModal.showModal();
            else accountDestinationModal.setAttribute('open', '');
            return;
        }
        window.location.assign(new URL('feed.html', window.location.href));
    };

    const completeAuthenticatedLogin = async (result) => {
        const session = await window.ImpactaAPI.currentSession();
        if (result?.status !== 'authenticated' || !session?.authenticated) {
            throw Object.assign(new Error('session_not_persisted'), { code: 'session_not_persisted' });
        }
        if (Array.isArray(result.recoveryCodes) && result.recoveryCodes.length > 0 && mfaRecoveryPanel) {
            pendingAuthenticatedResult = { result, session };
            loginForm.hidden = true;
            if (mfaLoginForm) mfaLoginForm.hidden = true;
            if (mfaSetupForm) mfaSetupForm.hidden = true;
            mfaRecoveryPanel.querySelector('#mfa-recovery-codes').textContent = result.recoveryCodes.join('\n');
            mfaRecoveryPanel.hidden = false;
            if (status) status.hidden = true;
            return;
        }
        continueToAccount(result, session);
    };

    const setMfaStep = (mode) => {
        loginForm.hidden = mode !== 'login';
        if (mfaLoginForm) mfaLoginForm.hidden = mode !== 'verify';
        if (mfaSetupForm) mfaSetupForm.hidden = mode !== 'setup';
        if (mfaRecoveryPanel) mfaRecoveryPanel.hidden = true;
        const heading = document.querySelector('#auth-title');
        const subtitle = document.querySelector('.auth-modal-heading .auth-subtitle');
        if (heading) heading.textContent = mode === 'setup' ? 'Protege o acesso administrativo'
            : mode === 'verify' ? 'Confirma a tua identidade' : 'Entrar';
        if (subtitle) subtitle.textContent = mode === 'setup'
            ? 'Configura a autenticação multifactor para continuares.'
            : mode === 'verify' ? 'Introduz o código da tua app autenticadora.'
                : 'Acede à tua conta para continuares a participar na comunidade.';
        if (status) status.hidden = true;
    };

    const showMfaSetup = (result) => {
        mfaChallengeToken = result.challengeToken;
        const secretField = document.querySelector('#mfa-setup-secret');
        if (secretField instanceof HTMLInputElement) secretField.value = result.secret;
        const setupCopy = mfaSetupForm?.querySelector('.mfa-auth-copy');
        if (setupCopy) {
            setupCopy.textContent = result.reason === 'recovery'
                ? 'Usaste um código de recuperação. Configura novamente a app autenticadora para substituir a chave perdida e gerar novos códigos de recuperação.'
                : 'Esta conta tem acesso administrativo. Liga uma app autenticadora para proteger a área de gestão. A chave é mostrada apenas agora.';
        }
        setMfaStep('setup');
        document.querySelector('#mfa-setup-code')?.focus();
    };

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!loginForm.reportValidity()) return;
        button.disabled = true;
        showAuthStatus(status, 'A iniciar sess\u00e3o...');
        try {
            const result = await authPost('/login', {
                email: loginForm.elements.email.value,
                password: loginForm.elements.password.value
            });
            if (result?.status === 'mfa_required' && typeof result.challengeToken === 'string') {
                mfaChallengeToken = result.challengeToken;
                setMfaStep('verify');
                document.querySelector('#mfa-login-code')?.focus();
                return;
            }
            if (result?.status === 'mfa_setup_required' && typeof result.challengeToken === 'string'
                && typeof result.secret === 'string') {
                showMfaSetup(result);
                return;
            }
            await completeAuthenticatedLogin(result);
        } catch (error) {
            showAuthStatus(status, authErrorMessage(error));
        } finally {
            button.disabled = false;
        }
    });

    if (mfaLoginForm) {
        const mfaButton = mfaLoginForm.querySelector('button[type="submit"]');
        mfaLoginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!mfaChallengeToken || !mfaLoginForm.reportValidity()) return;
            mfaButton.disabled = true;
            showAuthStatus(status, 'A confirmar o código...');
            try {
                const result = await authPost('/mfa/verify', {
                    challengeToken: mfaChallengeToken,
                    code: mfaLoginForm.elements.code.value.trim()
                });
                mfaChallengeToken = '';
                if (result?.status === 'mfa_setup_required' && typeof result.challengeToken === 'string'
                    && typeof result.secret === 'string') {
                    showMfaSetup(result);
                    return;
                }
                await completeAuthenticatedLogin(result);
            } catch (error) {
                showAuthStatus(status, authErrorMessage(error));
            } finally {
                mfaButton.disabled = false;
            }
        });
    }

    if (mfaSetupForm) {
        const setupButton = mfaSetupForm.querySelector('button[type="submit"]');
        mfaSetupForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!mfaChallengeToken || !mfaSetupForm.reportValidity()) return;
            setupButton.disabled = true;
            showAuthStatus(status, 'A activar a protecção...');
            try {
                const result = await authPost('/mfa/setup/confirm', {
                    challengeToken: mfaChallengeToken,
                    code: mfaSetupForm.elements.code.value.trim()
                });
                mfaChallengeToken = '';
                await completeAuthenticatedLogin(result);
            } catch (error) {
                showAuthStatus(status, authErrorMessage(error));
            } finally {
                setupButton.disabled = false;
            }
        });
    }

    document.querySelectorAll('[data-mfa-back]').forEach((backButton) => {
        backButton.addEventListener('click', () => {
            mfaChallengeToken = '';
            loginForm.reset();
            if (mfaLoginForm) mfaLoginForm.reset();
            if (mfaSetupForm) mfaSetupForm.reset();
            setMfaStep('login');
            document.querySelector('#email')?.focus();
        });
    });

    document.querySelector('#mfa-recovery-continue')?.addEventListener('click', () => {
        if (!pendingAuthenticatedResult) return;
        const { result, session } = pendingAuthenticatedResult;
        pendingAuthenticatedResult = null;
        continueToAccount(result, session);
    });
}

const resetRequestForm = document.querySelector('#reset-request-form');
const resetConfirmForm = document.querySelector('#reset-confirm-form');
if (resetRequestForm && resetConfirmForm) {
    const resetDialog = resetRequestForm.closest('.auth-modal');
    const resetHeading = resetDialog?.querySelector('#reset-auth-title');
    const resetSubtitle = resetDialog?.querySelector('#reset-subtitle');
    const requestStatus = document.querySelector('#reset-request-status');
    const confirmStatus = document.querySelector('#reset-confirm-status');
    const resetSuccess = document.querySelector('#reset-success');
    const hadResetParameter = window.location.search.length > 0;
    const resetToken = new URLSearchParams(window.location.search).get('token') || '';
    const validResetToken = /^[a-f0-9]{64}$/.test(resetToken);
    const resetRequestButton = resetRequestForm.querySelector('button[type="submit"]');
    const resetConfirmButton = resetConfirmForm.querySelector('button[type="submit"]');
    const newPassword = resetConfirmForm.elements.password;
    const confirmPassword = resetConfirmForm.elements.passwordConfirmation;

    window.history.replaceState(null, '', window.location.pathname);
    if (validResetToken) {
        resetRequestForm.hidden = true;
        resetConfirmForm.hidden = false;
        if (resetHeading) resetHeading.textContent = 'Definir nova palavra-passe';
        if (resetSubtitle) resetSubtitle.textContent = 'Define uma palavra-passe segura para voltares a entrar.';
    } else if (hadResetParameter) {
        showAuthStatus(requestStatus, 'O link não é válido. Podes pedir um novo abaixo.');
    }

    const validateResetPasswords = () => {
        confirmPassword.setCustomValidity(
            confirmPassword.value && confirmPassword.value !== newPassword.value
                ? 'As palavras-passe não coincidem.'
                : ''
        );
    };
    newPassword.addEventListener('input', validateResetPasswords);
    confirmPassword.addEventListener('input', validateResetPasswords);

    resetRequestForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!resetRequestForm.reportValidity()) return;
        resetRequestButton.disabled = true;
        showAuthStatus(requestStatus, 'A enviar o pedido...');
        try {
            const payload = await authPost('/password/reset/request', {
                email: resetRequestForm.elements.email.value
            });
            showAuthStatus(requestStatus, payload.message || 'Se existir uma conta ativa com este email, receberás os próximos passos.');
        } catch (error) {
            showAuthStatus(requestStatus, authErrorMessage(error));
        } finally {
            resetRequestButton.disabled = false;
        }
    });

    resetConfirmForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        validateResetPasswords();
        if (!resetConfirmForm.reportValidity()) return;
        resetConfirmButton.disabled = true;
        showAuthStatus(confirmStatus, 'A atualizar a palavra-passe...');
        try {
            await authPost('/password/reset/confirm', {
                token: resetToken,
                password: newPassword.value,
                passwordConfirmation: confirmPassword.value
            });
            resetConfirmForm.hidden = true;
            resetSuccess.hidden = false;
            if (resetHeading) resetHeading.textContent = 'Acesso recuperado';
            if (resetSubtitle) resetSubtitle.textContent = 'A tua palavra-passe do IMPACTA foi actualizada com segurança.';
        } catch (error) {
            showAuthStatus(confirmStatus, authErrorMessage(error));
        } finally {
            resetConfirmButton.disabled = false;
        }
    });
}

const authImageCarousel = document.querySelector('.auth-image-carousel');
if (authImageCarousel) {
    const authImageSlides = [...authImageCarousel.querySelectorAll('.auth-image-slide')];
    const authReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let authImageIndex = 0;
    let authCarouselTimer = null;

    const stopAuthCarousel = () => {
        if (authCarouselTimer !== null) {
            window.clearInterval(authCarouselTimer);
            authCarouselTimer = null;
        }
    };

    const startAuthCarousel = () => {
        if (authReducedMotion || document.hidden || authCarouselTimer !== null || authImageSlides.length < 2) return;
        authCarouselTimer = window.setInterval(() => {
            authImageSlides[authImageIndex].classList.remove('is-active');
            authImageIndex = (authImageIndex + 1) % authImageSlides.length;
            authImageSlides[authImageIndex].classList.add('is-active');
        }, 5600);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAuthCarousel();
        else startAuthCarousel();
    });
    startAuthCarousel();
}

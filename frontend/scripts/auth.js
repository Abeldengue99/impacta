const authPost = (path, body) => window.ImpactaAPI.post(`/auth${path}`, body);

function showAuthStatus(node, message) {
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
}

function authErrorMessage(error) {
    const messages = {
        too_many_requests: 'Atingiste o limite de tentativas. Aguarda antes de voltar a tentar.',
        email_delivery_unavailable: 'Não foi possível enviar o email. A configuração SMTP precisa de ser concluída.',
        auth_configuration_unavailable: 'A configuração segura da API está incompleta.',
        invalid_registration: 'Confirma o nome, o email e se as palavras-passe coincidem.',
        verification_invalid_or_expired: 'O código está incorreto ou expirou. Pede outro código.',
        invalid_credentials: 'Email ou palavra-passe incorretos.',
        password_reset_invalid_or_expired: 'Este link já foi usado ou expirou. Pede um novo link.',
        password_reset_unavailable: 'Não foi possível alterar a palavra-passe. Tenta novamente.',
        email_not_verified: 'Confirma o email antes de iniciares sessão. Podes pedir outro código ao iniciar novamente o registo com o mesmo email.',
        mfa_required: 'Esta conta requer autenticação multifator, ainda não ativada nesta versão.',
        api_unavailable: 'Não foi possível contactar a API. Confirma se o backend está ativo.'
    };
    return messages[error?.code] || 'Não foi possível concluir o pedido. Tenta novamente.';
}

const registerForm = document.querySelector('#register-form');
const verificationForm = document.querySelector('#verification-form');
const registrationSuccess = document.querySelector('#registration-success');

if (registerForm && verificationForm) {
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
                email: registerForm.elements.email.value
            });
            currentEmail = registerForm.elements.email.value.trim();
            verificationEmail.value = currentEmail;
            verificationName.value = registerForm.elements.displayName.value.trim();
            registerForm.hidden = true;
            registerStatus.hidden = true;
            verificationForm.hidden = false;
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
            document.querySelector('#auth-title').textContent = 'Email confirmado.';
            document.querySelector('.auth-card > .auth-subtitle').textContent = 'A tua conta IMPACTA est\u00e1 ativa.';
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
        document.querySelector('#auth-title').textContent = 'Cria a tua conta.';
    });
}

const loginForm = document.querySelector('#login-form');
if (loginForm) {
    const status = document.querySelector('#login-status');
    const button = loginForm.querySelector('button[type="submit"]');
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!loginForm.reportValidity()) return;
        button.disabled = true;
        showAuthStatus(status, 'A iniciar sess\u00e3o...');
        try {
            await authPost('/login', {
                email: loginForm.elements.email.value,
                password: loginForm.elements.password.value
            });
            window.location.assign(new URL('feed.html', window.location.href));
        } catch (error) {
            showAuthStatus(status, authErrorMessage(error));
        } finally {
            button.disabled = false;
        }
    });
}

const resetRequestForm = document.querySelector('#reset-request-form');
const resetConfirmForm = document.querySelector('#reset-confirm-form');
if (resetRequestForm && resetConfirmForm) {
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
        document.querySelector('#auth-title').textContent = 'Escolhe uma nova palavra-passe.';
        document.querySelector('#reset-subtitle').textContent = 'O link é válido por 30 minutos e só pode ser usado uma vez.';
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
            document.querySelector('#auth-title').textContent = 'Acesso recuperado.';
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

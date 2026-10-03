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
        email_not_verified: 'Confirma o email antes de iniciares sessão. Volta a criar a conta com este email para receber outro código.',
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

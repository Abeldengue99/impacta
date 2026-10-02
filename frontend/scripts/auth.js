const registerForm = document.querySelector('#register-form');

if (registerForm) {
    const password = registerForm.querySelector('#register-password');
    const confirmation = registerForm.querySelector('#confirm-password');

    const validatePasswords = () => {
        confirmation.setCustomValidity(
            confirmation.value && confirmation.value !== password.value
                ? 'As palavras-passe não coincidem.'
                : ''
        );
    };

    password.addEventListener('input', validatePasswords);
    confirmation.addEventListener('input', validatePasswords);
    registerForm.addEventListener('submit', validatePasswords);
}

const statusBox = document.querySelector('#profile-status');
const editor = document.querySelector('#profile-editor');
const publicCard = document.querySelector('#public-profile');
const profileForm = document.querySelector('#profile-form');
const profileFeedback = document.querySelector('#profile-feedback');
const avatarBox = document.querySelector('#profile-avatar');
const publicAvatar = document.querySelector('#public-avatar');
const avatarFile = document.querySelector('#avatar-file');
const removeAvatar = document.querySelector('#remove-avatar');
const profileId = new URLSearchParams(window.location.search).get('id');
let currentAvatarUrl = null;

function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => part[0]).join('').toLocaleUpperCase('pt') || 'I';
}

function setAvatar(node, url, name) {
    if (!node) return;
    node.replaceChildren();
    node.textContent = initials(name);
    if (!url) return;
    const image = document.createElement('img');
    image.crossOrigin = 'use-credentials';
    image.src = window.ImpactaAPI.assetUrl(url);
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.remove(); node.textContent = initials(name); }, { once: true });
    node.replaceChildren(image);
}

function showError(error) {
    const messages = {
        authentication_required: 'A tua sessão terminou. Entra novamente para editar o perfil.',
        csrf_validation_failed: 'A sessão de segurança expirou. Atualiza a página e tenta novamente.',
        profile_not_found: 'Este perfil não está disponível ou foi definido como privado.',
        invalid_profile: 'Confirma o nome e os limites dos campos do perfil.',
        invalid_website_url: 'Indica um endereço de site válido que comece por https://.',
        invalid_impact_area: 'A área escolhida já não está disponível. Seleciona outra.',
        invalid_skills: 'Usa até 12 competências, cada uma com no máximo 40 caracteres.',
        unsupported_avatar_type: 'Escolhe uma imagem PNG ou JPEG.',
        avatar_too_large: 'A fotografia tem de ter menos de 2 MB.',
        invalid_avatar_image: 'O ficheiro não é uma imagem válida ou excede 4096 × 4096 px.',
        api_unavailable: 'Não foi possível ligar à plataforma. Tenta novamente.'
    };
    return messages[error?.code] || 'Não foi possível concluir o pedido. Tenta novamente.';
}

function setStatus(message, isError = false) {
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.classList.toggle('is-error', isError);
    statusBox.hidden = !message;
}

function appendDetail(list, label, value) {
    if (!value) return;
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    wrapper.append(term, description);
    list.append(wrapper);
}

function renderPublicProfile(profile) {
    document.querySelector('#profile-heading').textContent = profile.displayName;
    document.querySelector('#profile-intro').textContent = 'Perfil público da comunidade IMPACTA.';
    document.querySelector('#public-name').textContent = profile.displayName;
    document.querySelector('#public-headline').textContent = profile.headline || profile.impactArea || '';
    const bio = document.querySelector('#public-bio');
    bio.textContent = profile.bio || '';
    bio.hidden = !profile.bio;
    setAvatar(publicAvatar, profile.avatarUrl, profile.displayName);
    const details = document.querySelector('#public-details');
    appendDetail(details, 'Localização', profile.location);
    appendDetail(details, 'Função', profile.occupation);
    appendDetail(details, 'Organização', profile.organization);
    appendDetail(details, 'Área de impacto', profile.impactArea);
    const skills = document.querySelector('#public-skills');
    for (const skill of profile.skills || []) {
        const tag = document.createElement('span');
        tag.className = 'profile-skill';
        tag.textContent = skill;
        skills.append(tag);
    }
    if (profile.websiteUrl) {
        const website = document.querySelector('#public-website');
        website.href = profile.websiteUrl;
        website.hidden = false;
    }
    editor.hidden = true;
    publicCard.hidden = false;
    setStatus('');
}

function populateEditor(profile, impactAreas) {
    const fields = profileForm.elements;
    fields.namedItem('displayName').value = profile.displayName || '';
    fields.namedItem('headline').value = profile.headline || '';
    fields.namedItem('bio').value = profile.bio || '';
    fields.namedItem('location').value = profile.location || '';
    fields.namedItem('occupation').value = profile.occupation || '';
    fields.namedItem('organization').value = profile.organization || '';
    fields.namedItem('websiteUrl').value = profile.websiteUrl || '';
    fields.namedItem('skills').value = (profile.skills || []).join(', ');
    fields.namedItem('isPublic').checked = Boolean(profile.isPublic);
    const impactArea = fields.namedItem('impactAreaId');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Escolhe uma área';
    impactArea.replaceChildren(placeholder);
    for (const item of impactAreas) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        impactArea.append(option);
    }
    impactArea.value = profile.impactAreaId || '';
    document.querySelector('#profile-email').textContent = `E-mail da conta: ${profile.email}`;
    document.querySelector('#bio-count').textContent = String(Array.from(profile.bio || '').length);
    setAvatar(avatarBox, profile.avatarUrl, profile.displayName);
    currentAvatarUrl = profile.avatarUrl;
    removeAvatar.hidden = !currentAvatarUrl;
    editor.hidden = false;
    setStatus('');
}

async function loadProfile() {
    setStatus('A carregar perfil…');
    try {
        if (profileId) {
            const result = await window.ImpactaAPI.request(`/profiles/${encodeURIComponent(profileId)}`);
            renderPublicProfile(result.profile);
            return;
        }
        const result = await window.ImpactaAPI.request('/profile');
        populateEditor(result.profile, result.impactAreas || []);
    } catch (error) {
        setStatus(showError(error), true);
        if (error?.code === 'authentication_required') {
            const login = document.createElement('a');
            login.className = 'button profile-login-button';
            login.href = 'login.html';
            login.textContent = 'Entrar na conta';
            statusBox.append(login);
        }
    }
}

document.querySelector('#choose-avatar').addEventListener('click', () => avatarFile.click());
avatarFile.addEventListener('change', async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        profileFeedback.textContent = file.size > 2 * 1024 * 1024
            ? 'A fotografia tem de ter menos de 2 MB.'
            : 'Escolhe uma imagem PNG ou JPEG.';
        avatarFile.value = '';
        return;
    }
    profileFeedback.textContent = 'A carregar fotografia…';
    try {
        const result = await window.ImpactaAPI.upload('/profile/avatar', file);
        currentAvatarUrl = result.avatarUrl;
        const profile = await window.ImpactaAPI.request('/profile');
        populateEditor(profile.profile, profile.impactAreas || []);
        profileFeedback.textContent = 'Fotografia atualizada.';
    } catch (error) {
        profileFeedback.textContent = showError(error);
    } finally {
        avatarFile.value = '';
    }
});

removeAvatar.addEventListener('click', async () => {
    removeAvatar.disabled = true;
    profileFeedback.textContent = 'A remover fotografia…';
    try {
        await window.ImpactaAPI.delete('/profile/avatar');
        setAvatar(avatarBox, null, profileForm.elements.namedItem('displayName').value);
        currentAvatarUrl = null;
        removeAvatar.hidden = true;
        profileFeedback.textContent = 'Fotografia removida.';
    } catch (error) {
        profileFeedback.textContent = showError(error);
    } finally {
        removeAvatar.disabled = false;
    }
});

profileForm.elements.namedItem('bio').addEventListener('input', (event) => {
    document.querySelector('#bio-count').textContent = String(Array.from(event.currentTarget.value).length);
});

profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = document.querySelector('#save-profile');
    const fields = profileForm.elements;
    const skills = fields.namedItem('skills').value.split(',').map((value) => value.trim()).filter(Boolean);
    submit.disabled = true;
    profileFeedback.textContent = 'A guardar perfil…';
    try {
        await window.ImpactaAPI.put('/profile', {
            displayName: fields.namedItem('displayName').value,
            headline: fields.namedItem('headline').value,
            bio: fields.namedItem('bio').value,
            location: fields.namedItem('location').value,
            occupation: fields.namedItem('occupation').value,
            organization: fields.namedItem('organization').value,
            websiteUrl: fields.namedItem('websiteUrl').value,
            skills,
            impactAreaId: fields.namedItem('impactAreaId').value || null,
            isPublic: fields.namedItem('isPublic').checked
        });
        profileFeedback.textContent = 'Perfil guardado.';
        await loadProfile();
    } catch (error) {
        profileFeedback.textContent = showError(error);
    } finally {
        submit.disabled = false;
    }
});

if (profileId) {
    document.querySelector('#profile-editor').hidden = true;
} else {
    document.querySelector('#public-profile').hidden = true;
}
loadProfile();

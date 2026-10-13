const assistantForm = document.querySelector('#assistant-form');
const assistantInput = document.querySelector('#assistant-input');
const assistantMessages = document.querySelector('#assistant-messages');
const assistantStatus = document.querySelector('#assistant-status');

if (assistantForm && assistantInput && assistantMessages && assistantStatus) {
    const conversation = [];
    const sendButton = assistantForm.querySelector('button[type="submit"]');
    let generativeAssistantAvailable = false;

    const localAnswers = [
        {
            terms: ['problema local', 'problema no bairro', 'bairro', 'moradores', 'municipio', 'provincia', 'cidade'],
            answer: 'Para partilhar um problema da tua zona, publica-o no feed ou numa comunidade local. Indica o bairro, município ou província e explica o impacto; não publiques moradas exactas nem dados de outras pessoas. Se ainda não existir uma comunidade da zona, podes propor uma.'
        },
        {
            terms: ['criar comunidade', 'propor comunidade', 'comunidade local', 'grupo de moradores', 'nova comunidade'],
            answer: 'Na área Comunidades, escolhe “Propor uma comunidade”. Indica o nome, o propósito e a zona aproximada. Depois da análise, as pessoas poderão pedir adesão e conversar no espaço da comunidade.'
        },
        {
            terms: ['criar projecto', 'propor projecto', 'criar projeto', 'propor projeto', 'novo projecto', 'nova iniciativa'],
            answer: 'Na área Projectos, escolhe “Propor um projecto à comunidade”. Explica o objectivo, as actividades, a zona e como outras pessoas podem participar. Depois acompanha o estado da proposta e as actualizações na própria área.'
        },
        {
            terms: ['participar num desafio', 'desafio da semana', 'desafio', 'prazo', 'inscricao'],
            answer: 'Abre o desafio, consulta o objectivo e o prazo e selecciona a opção de participação. A página mostra quando a tua participação foi recebida. Se o desafio estiver ligado a um projecto, consulta também as instruções desse projecto.'
        },
        {
            terms: ['palavra-passe', 'senha', 'entrar', 'login', 'sessao', 'acesso', 'recuperar'],
            answer: 'Para entrar, usa o teu e-mail e palavra-passe. Se te esqueceste da palavra-passe, abre “Esqueceste a palavra-passe?” no ecrã de entrada e segue o link enviado para o teu e-mail. Se a conta for nova, confirma primeiro o e-mail com o código recebido.'
        },
        {
            terms: ['criar conta', 'registo', 'cadastrar', 'cadastro', 'registar', 'conta nova'],
            answer: 'Escolhe “Criar conta”, indica o teu nome e e-mail e confirma o endereço com o código enviado. Depois define e confirma a tua palavra-passe para activares a conta.'
        },
        {
            terms: ['publicar', 'publicacao', 'partilhar', 'post', 'ideia', 'anexar', 'imagem', 'video'],
            answer: 'Abre o feed, escreve a tua ideia e selecciona uma categoria. Se quiseres, anexa uma imagem ou vídeo e escolhe “Partilhar”. Se receberes um erro, actualiza a página e tenta novamente.'
        },
        {
            terms: ['categoria', 'categorias', 'filtrar', 'filtro', 'outra categoria'],
            answer: 'Ao publicar no IMPACTA, escolhe o tema que melhor corresponde ao conteúdo. No feed, usa o filtro de publicações para ver os conteúdos daquele tema. Se nenhuma opção servir, escolhe “Outra categoria”.'
        },
        {
            terms: ['projeto', 'projecto', 'desafio', 'participar', 'comunidade', 'aderir'],
            answer: 'Abre “Projectos”, “Desafios” ou “Comunidades” no menu do feed IMPACTA. Consulta a descrição e as opções de participação. A adesão a uma comunidade depende da aprovação da pessoa responsável; um projecto ou desafio só aceita participações quando está aberto.'
        },
        {
            terms: ['notificacao', 'notificacoes', 'reacao', 'comentario', 'partilhou'],
            answer: 'Abre “Notificações” no menu do feed para consultar actividade relacionada com as tuas publicações, como reacções, comentários e partilhas.'
        },
        {
            terms: ['denuncia', 'denunciar', 'reportar', 'ocultar'],
            answer: 'Usa a opção de denúncia junto da publicação e escolhe o motivo mais adequado. A equipa de moderação analisa os relatos e pode tomar medidas conforme as regras da comunidade.'
        },
        {
            terms: ['erro', 'falha', 'nao funciona', 'não funciona', 'carregar', 'carregar categoria'],
            answer: 'Atualiza a página e tenta novamente. Se o erro continuar, confirma que a API está ativa e que as migrações necessárias foram aplicadas. Guarda o texto do erro para facilitar o diagnóstico e nunca partilhes a tua palavra-passe.'
        }
    ];

    function normalize(value) {
        return value.toLocaleLowerCase('pt').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function getLocalAnswer(question) {
        const normalized = normalize(question);
        const match = localAnswers
            .map((entry) => ({
                answer: entry.answer,
                score: entry.terms.reduce((total, term) => total + (normalized.includes(normalize(term)) ? 1 : 0), 0)
            }))
            .sort((first, second) => second.score - first.score)[0];

        return match?.score
            ? match.answer
            : 'Ainda não encontrei uma resposta específica para isso. Diz-me qual página estás a usar e o que acontece depois de clicares; não incluas palavras-passe ou outros dados sensíveis.';
    }

    function appendMessage(role, content, label) {
        const message = document.createElement('article');
        message.className = `assistant-message ${role === 'user' ? 'assistant-message-user' : 'assistant-message-bot'}`;
        const heading = document.createElement('div');
        heading.className = 'assistant-message-label';
        heading.textContent = label;
        const body = document.createElement('div');
        body.textContent = content;
        message.append(heading, body);
        assistantMessages.append(message);
        assistantMessages.scrollTop = assistantMessages.scrollHeight;
        return message;
    }

    async function sendQuestion(question) {
        const cleanQuestion = question.trim();
        if (!cleanQuestion || sendButton?.disabled) return;

        assistantInput.value = '';
        assistantInput.style.height = '';
        assistantForm.querySelectorAll('[data-assistant-question]').forEach((button) => { button.disabled = true; });
        if (sendButton) sendButton.disabled = true;
        appendMessage('user', cleanQuestion, 'Tu');
        conversation.push({ role: 'user', content: cleanQuestion });
        assistantStatus.textContent = 'A preparar uma resposta…';

        const pending = document.createElement('article');
        pending.className = 'assistant-message assistant-message-bot assistant-typing';
        pending.textContent = 'Um momento…';
        assistantMessages.append(pending);
        assistantMessages.scrollTop = assistantMessages.scrollHeight;

        let answer = '';

        if (generativeAssistantAvailable && window.ImpactaAPI?.post) {
            try {
                const response = await window.ImpactaAPI.post('/help/assistant', {
                    messages: conversation.slice(-8)
                });
                answer = typeof response.answer === 'string' ? response.answer.trim().slice(0, 1500) : '';

            } catch {
                generativeAssistantAvailable = false;
                assistantStatus.textContent = 'Vou continuar com uma resposta rápida.';
            }
        }

        if (!answer) answer = getLocalAnswer(cleanQuestion);
        pending.remove();
        appendMessage('assistant', answer, 'Assistente do IMPACTA');
        conversation.push({ role: 'assistant', content: answer });
        assistantStatus.textContent = generativeAssistantAvailable ? 'Assistente do IMPACTA disponível' : 'Ajuda rápida disponível';
        if (sendButton) sendButton.disabled = false;
        assistantForm.querySelectorAll('[data-assistant-question]').forEach((button) => { button.disabled = false; });
        assistantInput.focus();
    }

    assistantForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void sendQuestion(assistantInput.value);
    });
    assistantInput.addEventListener('input', () => {
        assistantInput.style.height = 'auto';
        assistantInput.style.height = `${Math.min(assistantInput.scrollHeight, 110)}px`;
    });
    assistantInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            assistantForm.requestSubmit();
        }
    });
    document.querySelectorAll('[data-assistant-question]').forEach((button) => {
        button.addEventListener('click', () => void sendQuestion(button.dataset.assistantQuestion || ''));
    });

    if (window.ImpactaAPI?.request) {
        window.ImpactaAPI.request('/help/assistant/status')
            .then((response) => {
                generativeAssistantAvailable = response.available === true;
                assistantStatus.textContent = generativeAssistantAvailable ? 'Assistente do IMPACTA disponível' : 'Ajuda rápida disponível';
            })
            .catch(() => {
                assistantStatus.textContent = 'Ajuda rápida disponível';
            });
    } else {
        assistantStatus.textContent = 'Respostas rápidas disponíveis';
    }
}

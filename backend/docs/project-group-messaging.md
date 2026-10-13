# Conversas de projecto

Cada projecto tem uma conversa privada para coordenar tarefas e decisões. Não há mensagens directas entre contas nem pré-visualizações públicas.

## Quem pode participar

- Pessoas inscritas no projecto.
- A pessoa responsável pelo projecto e a responsável pela comunidade associada.
- Gestores e moderadores activos da comunidade associada.

A API verifica estas permissões em cada leitura e escrita. A conversa continua disponível para consulta depois de o projecto terminar; nesse estado, deixa de aceitar mensagens.

## Privacidade e controlo

- Só texto, até 1 200 caracteres por mensagem.
- Sem recibos de leitura visíveis, estado de presença, notificações externas ou anexos.
- A contagem de mensagens por ler é opcional e pode ser silenciada por projecto.
- O histórico carrega quando a conversa é aberta e actualiza apenas enquanto a janela está aberta.
- A pessoa autora pode editar durante 15 minutos e eliminar as suas mensagens. Responsáveis podem remover mensagens de qualquer participante.
- Denúncias seguem para a fila de moderação existente. A administração vê o conteúdo apenas quando existe denúncia.
- O envio está limitado a 30 acções por hora; as denúncias a 10 por hora.

## Activação local

Aplicar `backend/database/migrations/20261013-project-group-messaging.sql` à base de dados local `Impacta` como proprietária do esquema e reiniciar a API. A migração rejeita outras bases de dados ou servidores.

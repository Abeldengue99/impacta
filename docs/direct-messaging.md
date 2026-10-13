# Mensagens privadas do IMPACTA

Esta funcionalidade acrescenta conversas individuais no cabeçalho. As conversas de comunidades e de projectos continuam nos seus espaços e mantêm as regras actuais.

## Regras de contacto

- Duas contas com uma ligação Impacta aceite reciprocamente podem iniciar uma conversa privada.
- Sem essa ligação, a primeira mensagem é um pedido: texto até 500 caracteres, sem anexos ou links. O destinatário pode aceitar, recusar, denunciar ou bloquear.
- Um pedido aceite cria a conversa e preserva a mensagem inicial como primeiro conteúdo. Aceitar não obriga a responder.
- Cada conta pode enviar até cinco pedidos por 24 horas, receber no máximo 50 pedidos pendentes e só pode voltar a contactar a mesma pessoa depois de 30 dias se o primeiro pedido não avançar. Mensagens de conversas aceites têm limite de 60 por hora.
- Cada pessoa escolhe se aceita pedidos, se só aceita novos contactos de pessoas Impacta, ou se pausa todos os novos contactos. Conversas já aceites continuam acessíveis.
- Bloquear corta leitura, envio e novos pedidos entre as contas. A lista de bloqueados permite desbloquear.
- Conversas podem ser arquivadas ou silenciadas. Silenciar retira as mensagens por ler do contador global; não apaga o histórico.
- A aplicação não expõe presença, indicador de escrita nem recibos de leitura. O marcador de leitura só actualiza a contagem privada do próprio utilizador.
- Numa conversa aceite, cada mensagem pode incluir texto até 1 200 caracteres ou uma foto/vídeo com legenda opcional. Pedidos de primeiro contacto continuam só com texto.
- Fotos até 12 MB são convertidas para WebP, redimensionadas até 1 920 px e limitadas a 4 MB depois da conversão. Vídeos até 100 MB e 60 segundos são convertidos para MP4, reduzidos até 1 280 px e limitados a 20 MB.
- Os anexos ficam em armazenamento privado. A API só os entrega depois de confirmar sessão, participação na conversa e ausência de bloqueio; o endereço da media também não é servido pela rota pública geral.
- A equipa de moderação só recebe o conteúdo de uma conversa quando uma mensagem ou pedido é denunciado. Um anexo de mensagem denunciada só pode ser consultado por quem tem permissão de moderação e MFA activos, enquanto a denúncia estiver aberta.

## Activação local

1. Aplicar `backend/database/migrations/20261013-direct-messaging.sql` como proprietário da base `Impacta`, **depois** de `20261013-project-group-messaging.sql`; depois aplicar `20261013-direct-messaging-media.sql`. As migrações têm uma guarda de ambiente local; não a remover para as aplicar noutro servidor.
2. Reiniciar o backend depois de compilar. `/api/v1/health/ready` passa a validar as tabelas, colunas e permissões do chat.
3. Abrir `frontend/pages/messages.html` com uma sessão autenticada. O atalho aparece no cabeçalho do feed e nas páginas da área autenticada.

A migração não é executada automaticamente pelo servidor. Sem ela, a prontidão responde `503` até que o esquema e as permissões estejam completos.

## Rotas principais

- `GET /api/v1/direct-messages/summary`, `/conversations`, `/requests`, `/preferences` e `/blocks`
- `POST /api/v1/direct-messages/start` inicia uma conversa ou cria um pedido conforme a relação e as preferências
- `POST /api/v1/direct-messages/requests/:id/accept|decline|cancel|report`
- `GET|POST /api/v1/direct-messages/conversations/:id/messages`; `POST .../:id/read`
- `POST /api/v1/direct-messages/conversations/:id/media` envia um anexo já convertido; `GET /api/v1/direct-messages/media/:id` entrega-o apenas aos participantes da conversa.
- `POST /api/v1/direct-messages/conversations/:id/archive|unarchive|mute|unmute`
- `POST|DELETE /api/v1/direct-messages/blocks/:userId`
- `POST /api/v1/direct-messages/messages/:id/report`

Todas as rotas privadas exigem sessão; operações de escrita exigem o token CSRF usado pelo resto da aplicação. Os IDs são validados como `bigint`, o acesso às conversas verifica participação e bloqueios, e as consultas usam parâmetros SQL.

## Limites conhecidos

As mensagens actualizam com consulta periódica enquanto a página está aberta; ainda não há WebSocket, notificações push nem encriptação ponta a ponta. A compressão de vídeo depende do FFmpeg configurado no servidor. A base de dados e o transporte da aplicação continuam responsáveis pela segurança em trânsito e em repouso, conforme a configuração do ambiente de publicação.

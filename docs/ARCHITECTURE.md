# Arquitectura

## Componentes

    Navegador
      ├── páginas HTML, CSS e JavaScript
      └── pedidos REST /api/v1
            ↓
    Apache ou Nginx
      ├── serve os ficheiros públicos do frontend
      └── proxy HTTPS → API Fastify em 127.0.0.1:3001
            ↓
    API Node.js / TypeScript
      ├── autenticação, autorização, validação e regras de negócio
      ├── armazenamento e transformação de media
      └── pool limitado de ligações
            ↓
    PostgreSQL (esquema impacta)

Em desenvolvimento, o frontend é servido pelo Apache/XAMPP e o JavaScript chama a API local na porta 3001. Em produção, o navegador usa uma origem HTTPS e o proxy encaminha /api/v1/ à API de loopback. A API não deve ser exposta directamente à rede pública.

## Frontend

O frontend usa páginas HTML independentes, folhas CSS e scripts JavaScript sem framework. frontend/scripts/api.js centraliza pedidos à API, a leitura do cookie CSRF e a escolha do endereço do backend. Os ficheiros em frontend/pages/ são as páginas; os recursos estáticos estão em frontend/assets/ e frontend/videos/.

O frontend não é compilado por um bundler. O TypeScript do backend é compilado para backend/dist/.

## API

backend/src/server.ts carrega a configuração, cria o servidor Fastify, liga-se ao PostgreSQL, aplica cabeçalhos e políticas de acesso, verifica sessões e regista os módulos de rotas.

| Módulo | Responsabilidade principal |
| --- | --- |
| auth-routes.ts | registo, confirmação, início/fim de sessão e fluxos de segurança |
| community-routes.ts | feed, comunidades, conversas, projectos, desafios e interacções |
| project-message-routes.ts | mensagens privadas limitadas aos projectos e seus participantes |
| profile-routes.ts | perfis, publicações de perfil, documentos e media |
| impactation-routes.ts | registos de impactação |
| admin-routes.ts | moderação e revisão administrativa |
| admin-console-routes.ts | operações, configurações, anúncios e segurança da administração |
| announcement-reports.ts | apoio aos fluxos de denúncia de anúncios |
| help-routes.ts | estado e interface de ajuda |
| media-processing.ts | validação e processamento de ficheiros |
| mfa.ts, email.ts | MFA e envio de e-mail |

A persistência usa consultas PostgreSQL parametrizadas através de pg. O esquema funcional está no namespace impacta. As definições iniciais e a evolução estão em backend/database/.

## Identidade, sessão e pedidos

As sessões são persistidas e revogáveis. O cookie de sessão é HttpOnly; em produção é também Secure. As operações de escrita autenticadas validam CSRF e a autorização da pessoa para o recurso. As rotas administrativas aplicam uma verificação de papel e exigem sessão com MFA confirmado.

As credenciais de palavra-passe usam scrypt da biblioteca padrão Node.js. As sessões usam tokens aleatórios e hashes armazenados, com limites temporais. A política de cookies, origens CORS e confiança em cabeçalhos do proxy depende da configuração de ambiente; revê backend/src/server.ts antes de alterar o proxy.

## Dados e media

O PostgreSQL guarda contas, sessões, publicações, projectos, desafios, comunidades, mensagens, notificações, moderação e configurações. As alterações de esquema são scripts SQL explícitos, não uma migração automática no arranque.

Em produção, IMPACTA_MEDIA_DIR deve ser absoluto, privado e fora do directório servido pelo Apache/Nginx. A API controla o acesso ao media através das respectivas rotas. FFmpeg/ffprobe podem ser usados para processar vídeo; sharp trata imagens.

## Prontidão

/api/v1/health/live indica que o processo responde. /api/v1/health/ready verifica a ligação, tabelas, colunas e privilégios necessários a partes importantes da API. Um resultado saudável não substitui uma validação funcional autenticada nem confirma certificado, SMTP, cópias de segurança, desempenho ou políticas do alojamento.
# Ligar o IMPACTA ao PostgreSQL

## Estado atual

O backend Node.js e TypeScript usa um pool limitado de ligações PostgreSQL. A aplicação não inicia sessão no PostgreSQL como superutilizador. O endpoint GET /api/v1/health/ready verifica a ligação e confirma se as tabelas principais do esquema impacta existem.

O serviço fica vinculado por padrão a 127.0.0.1:3001. A rota de prontidão não devolve nomes de utilizadores, credenciais nem dados da comunidade. A API inclui leitura pública do feed, dos desafios abertos e dos projetos ativos, além do registo, confirmação de email e início de sessão.

## Criar uma conta de aplicação

No pgAdmin, cria um Login/Group Role chamado impacta_app e define uma palavra-passe forte no próprio pgAdmin. Marca Can login. Mantém Superuser, Create roles, Create databases, Replication e Bypass RLS desativados.

Liga-te à base que contém o esquema impacta e concede apenas os privilégios base necessários à ligação:

    GRANT CONNECT ON DATABASE "Impacta" TO impacta_app;
    GRANT USAGE ON SCHEMA impacta TO impacta_app;

Confirma no pgAdmin a capitaliza��o exata do nome da base. Se aparecer como impacta em min�sculas, usa esse nome sem aspas no GRANT e em PGDATABASE. Não concedas ownership do esquema nem privilégios de superutilizador. Os privilégios de leitura e escrita para as rotas administrativas serão definidos por tabela quando essas rotas forem implementadas.

## Configurar a aplicação localmente

1. Copia .env.example para .env na raiz do projeto.
2. Confirma PGHOST e PGPORT. Para o PostgreSQL local atual, os valores são 127.0.0.1 e 5432.
3. Define PGDATABASE com o nome exato da base e PGUSER como impacta_app.
4. Preenche PGPASSWORD localmente com a palavra-passe definida no pgAdmin.
5. Mantém .env fora do Git. Nunca envies a palavra-passe por chat.
6. Para desenvolvimento local, PGSSL=false. Em produção, APP_ENV=production exige PGSSL=true e validação de certificado.
7. Executa, pela ordem indicada, `backend/database/migrations/20261003-public-read-access.sql` e `backend/database/migrations/20261003-email-verification.sql`, ligado à base `Impacta` e com uma conta proprietária. A segunda migração concede à conta da aplicação apenas as colunas necessárias para registo, confirmação, sessão e limites de tentativas.
8. Define `FRONTEND_ORIGINS` como uma lista separada por vírgulas de origens exatas do frontend, por exemplo `http://localhost,http://127.0.0.1`. Em produção esta variável é obrigatória.
9. Define `AUTH_TOKEN_PEPPER` com pelo menos 32 bytes aleatórios e mantém o mesmo valor entre reinícios.
10. Configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM_EMAIL` localmente. O Brevo usa `smtp-relay.brevo.com:587`; a senha SMTP deve ser uma chave SMTP do Brevo, e o endereço remetente deve estar autorizado na conta. Não uses uma chave API como senha SMTP.

## Iniciar e confirmar

Define `FRONTEND_BASE_URL` com o caminho base da aplicação, por exemplo, `http://localhost/Impacta`. Em produção, usa HTTPS e uma origem presente em `FRONTEND_ORIGINS`.

Antes de usar a recuperação de palavra-passe com o login `impacta_app`, executa como proprietária da base a migração `backend/database/migrations/20261009-password-reset.sql`. O link de recuperação é enviado por email, expira em 30 minutos, só pode ser usado uma vez e a palavra-passe nova revoga as sessões existentes. A API apresenta um estado de prontidão incompleto enquanto faltar a permissão dessa migração.

Para ativar publicação, comentários, apoios, denúncias, participação em desafios, adesão a projetos e comunidades, executa como proprietária `backend/database/migrations/20261009-community-interactions.sql`. Esta migração concede apenas as permissões necessárias ao `impacta_app`, cria índices usados pelas consultas do feed e habilita a renovação do prazo inativo da sessão. A prontidão da API permanece incompleta até todas as permissões estarem aplicadas.

Para remover as publicações locais fictícias do seed, executa uma vez `backend/database/migrations/20261009-remove-demo-posts.sql` como proprietária da base. O script só aceita a base local `Impacta` e elimina publicações com o marcador `[TESTE IMPACTA]` da comunidade de demonstração, associadas às contas de demonstração reservadas. Não elimina contas, comunidades nem publicações reais.

Na raiz do projeto, executa:

    npm.cmd run build
    npm.cmd start

Para carregar contas e publicações locais de demonstração no feed, segue [Dados de demonstração locais](demo-data.md). O seed é manual e exige a conta proprietária da base.

Abre http://127.0.0.1:3001/api/v1/health/ready.

- status ready confirma ligação e presença das tabelas usadas pela API pública.
- Database connected; IMPACTA schema is incomplete significa que a conta alcançou a base, mas faltam tabelas da proposta nesse banco.
- PostgreSQL connection is unavailable significa que host, porta, base, login ou palavra-passe precisam de correção. O endpoint não mostra esses valores.

## Conteúdo da comunidade

O feed e as listas de desafios/projetos consultam as tabelas `posts`, `challenges` e `projects`. Não são inseridas publicações ou contas de demonstração. Se essas tabelas não tiverem registos publicados/ativos, as listas aparecem vazias.

O registo cria a conta com estado `pending`. Um código aleatório de seis dígitos, válido por dez minutos e armazenado como HMAC, é enviado por email. Só a confirmação válida ativa a conta e atribui o papel padrão `member`. Os códigos têm limites de tentativas e os endpoints não revelam se um email já está registado.

O início de sessão usa scrypt para validar a senha e grava sessões revogáveis no PostgreSQL. Os cookies de sessão são HttpOnly; em produção também são Secure. O feed consulta publicações, desafios, projetos e comunidades no PostgreSQL. Com uma sessão ativa, é possível publicar, apoiar ou retirar apoio, comentar, denunciar uma publicação, apagar as próprias publicações, participar em desafios e aderir a projetos e comunidades públicas. Escritas exigem token CSRF, usam consultas parametrizadas e têm limites de tamanho e frequência. As funções administrativas permanecem separadas do feed.

Se o nome da base ou a conta ainda não corresponderem a estas instruções, ajusta as variáveis locais do .env. Não coloques dados secretos neste ficheiro de documentação.

# Ligar o IMPACTA ao PostgreSQL

## Estado atual

O backend Node.js e TypeScript usa um pool limitado de ligações PostgreSQL. A aplicação não inicia sessão no PostgreSQL como superutilizador. O endpoint GET /api/v1/health/ready verifica a ligação e confirma se as tabelas principais do esquema impacta existem.

O serviço fica vinculado por padrão a 127.0.0.1:3001. A rota de prontidão não devolve nomes de utilizadores, credenciais nem dados da comunidade. A API inclui leitura pública do feed, dos desafios abertos e dos projetos ativos; as rotas de escrita, autenticação e administração ainda não foram ligadas.

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
7. Executa `backend/database/migrations/20261003-public-read-access.sql` ligado à base `Impacta`. A migração dá à conta da aplicação apenas leitura das colunas necessárias para o feed público.
8. Define `FRONTEND_ORIGINS` como uma lista separada por vírgulas de origens exatas do frontend, por exemplo `http://localhost,http://127.0.0.1`. Em produção esta variável é obrigatória.

## Iniciar e confirmar

Na raiz do projeto, executa:

    npm.cmd run build
    npm.cmd start

Abre http://127.0.0.1:3001/api/v1/health/ready.

- status ready confirma ligação e presença das tabelas usadas pela API pública.
- Database connected; IMPACTA schema is incomplete significa que a conta alcançou a base, mas faltam tabelas da proposta nesse banco.
- PostgreSQL connection is unavailable significa que host, porta, base, login ou palavra-passe precisam de correção. O endpoint não mostra esses valores.

## Conteúdo da comunidade

O feed e as listas de desafios/projetos consultam as tabelas `posts`, `challenges` e `projects`. Não são inseridas publicações ou contas de demonstração. Se essas tabelas não tiverem registos publicados/ativos, as listas aparecem vazias.

O acesso atual é somente de leitura. Registo/login, criação de publicações, reações, comentários e funções administrativas dependem da implementação das rotas autenticadas e de concessões adicionais; a interface não deve fingir que essas operações foram gravadas.

Se o nome da base ou a conta ainda não corresponderem a estas instruções, ajusta as variáveis locais do .env. Não coloques dados secretos neste ficheiro de documentação.

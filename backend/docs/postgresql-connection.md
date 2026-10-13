# PostgreSQL: configuração e migrações

## Modelo de ligação

A API usa PostgreSQL através de pg, com um pool limitado e o esquema impacta. A aplicação deve autenticar-se como impacta_app, uma conta própria com privilégios mínimos; a conta proprietária do esquema serve para preparar e rever alterações SQL, não para correr a API.

O endpoint /api/v1/health/ready verifica a ligação e parte do esquema/permissões requeridos pelo código. A lista é intencionalmente uma verificação de prontidão, não uma auditoria completa de cada consulta.

## Configuração

1. Copia .env.example para .env e preenche os valores apenas na máquina/gestor de segredos.
2. Define PGHOST, PGPORT, PGDATABASE, PGUSER=impacta_app, PGPASSWORD, PGPOOL_MAX e PGSSL.
3. Em produção, PGSSL=true é obrigatório e o certificado tem de ser validado. PGSSL_CA permite indicar uma CA privada.
4. Concede à conta de aplicação apenas CONNECT, USAGE e os privilégios por tabela/coluna pedidos pelas migrações aprovadas.
5. Mantém AUTH_TOKEN_PEPPER estável e secreto. Em produção também são obrigatórios SMTP, MFA_ENCRYPTION_KEY, IMPACTA_MEDIA_DIR, FRONTEND_ORIGINS e PGPOOL_MAX.

A tabela de variáveis e os requisitos de produção estão em .env.example e deploy/README.md.

## Migrações

Não existe um executor automático nem uma tabela central de versões aplicadas. Os scripts em backend/database/migrations/ são SQL, alguns com transacção e condições específicas. Lê cada script e as pré-condições antes de o executar como proprietária do esquema; regista externamente quais foram aplicados e em que ambiente.

O inventário actual contém 42 scripts SQL, dos quais 34 têm guardas de ligação/base de dados local. Essas guardas são deliberadas. Não as removas nem contornes para executar os scripts em staging/produção. Antes de um piloto público, cria um procedimento de migração revisto, testa-o numa base isolada e valida o backup/restauro.

backend/database/proposals/impacta-v1.sql é uma proposta de esquema, não um substituto automático das migrações actuais. backend/database/seeds/impacta-demo-posts.sql insere fixtures locais explícitas, identificadas como demonstração; nunca deve ser usado com dados reais ou num ambiente público.

## Backups

A exportação iniciada na área administrativa não é um plano de recuperação suficiente. Produção precisa de backups protegidos e independentes, controlo de acesso, retenção definida, monitorização e um ensaio de restauro numa instalação isolada. Não guardar dumps neste repositório.
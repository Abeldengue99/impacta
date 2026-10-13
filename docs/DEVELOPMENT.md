# Desenvolvimento e validação

## Requisitos

- Node.js compatível com Fastify 5 e npm.
- PostgreSQL com o esquema impacta.
- Apache, XAMPP ou servidor HTTP equivalente para servir o frontend local.
- FFmpeg/ffprobe apenas se for necessário processar vídeo.

As versões resolvidas de npm estão em package-lock.json. A revisão de 13/10/2026 foi executada com Node.js 24.15.0 e npm 11.12.1.

## Instalação local (Windows/PowerShell)

Na raiz do projecto:

    npm.cmd ci
    Copy-Item .env.example .env

Edita .env localmente. Configura uma conta PostgreSQL de aplicação com privilégios limitados; não uses a conta postgres no servidor IMPACTA. A configuração inicial está em backend/docs/postgresql-connection.md.

Serve os ficheiros do projecto através do Apache/XAMPP. Confirma que o caminho público corresponde a FRONTEND_BASE_URL. Depois:

    npm.cmd run build
    npm.cmd start

A API fica por padrão em 127.0.0.1:3001. Confirma http://127.0.0.1:3001/api/v1/health/live e /api/v1/health/ready.

## Scripts npm

| Comando | Efeito |
| --- | --- |
| npm ci | instala as versões fixadas no lockfile |
| npm run build | compila TypeScript para backend/dist/ |
| npm start | inicia o backend compilado |
| npm test | executa os checks de arranque de produção e os smoke checks HTTP existentes |

backend/test/production-startup.mjs verifica alguns casos de configuração incompleta em produção. backend/test/release-smoke.mjs verifica por HTTP as rotas de vida e prontidão (por omissão em instância temporária/local; IMPACTA_SMOKE_BASE_URL permite indicar outra origem).

Estes scripts não são testes unitários abrangentes nem uma suite de ponta a ponta autenticada. Não exercitam todos os percursos com contas, papéis e migrações reais. A revisão de 13/10/2026 teve build e checks existentes aprovados; isso não certifica zero erros.

## Convenções práticas

- Mantém frontend, API, SQL e documentação nas respectivas pastas.
- Não coloques segredos, dumps, dados reais de utilizadores, logs ou media privada no Git.
- Usa consultas parametrizadas e validação server-side para qualquer escrita.
- Operações de escrita autenticadas devem manter verificação de sessão, CSRF, autorização e limites de frequência.
- Uma alteração SQL deve incluir objectivo, pré-condições, impacto e forma de validar; não executar migrações automaticamente ao iniciar o servidor.
- Actualiza a documentação do módulo e a checklist quando os requisitos de produção mudarem.
- Antes do push, executa npm.cmd run build, npm.cmd test, git diff --check e revê a lista de ficheiros staged.

## Integração contínua

Este repositório não tem workflow CI configurado actualmente. Os comandos acima têm de ser executados localmente até existir uma pipeline que os execute e publique resultados.
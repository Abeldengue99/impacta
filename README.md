# IMPACTA

A IMPACTA é uma plataforma de colaboração comunitária. Liga pessoas a ideias, projectos, desafios e comunidades para transformar necessidades locais em acções e resultados partilhados.

## O que existe no projecto

- Site público, feed autenticado, perfis, publicações com imagens/vídeos, comentários, reacções, denúncias e notificações.
- Propostas e participação em projectos e comunidades, com adesão sujeita às regras e estados definidos para cada espaço.
- Desafios associados a projectos, submissão de participações e revisão pela equipa responsável, com possibilidade de nova tentativa quando aplicável.
- Conversas de grupo privadas para membros de comunidades e participantes/responsáveis de projectos. Não há mensagens directas abertas entre quaisquer utilizadores.
- Autenticação, confirmação de e-mail, recuperação de palavra-passe, sessões revogáveis e MFA TOTP para funções administrativas.
- Área de administração com moderação, auditoria, gestão de anúncios, manutenção, segurança e exportação de cópias.
- Actualizações públicas que podem ser associadas a projectos, para comunicar actividades e resultados no feed.

A lista descreve funcionalidades presentes no código e nas migrações. Não significa que cada fluxo já tenha sido validado num ambiente público com dados reais. Ver [Estado de prontidão](SECURITY-RELEASE-CHECKLIST.md).

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Interface | HTML, CSS e JavaScript sem framework de interface |
| API | Node.js, TypeScript e Fastify 5 |
| Base de dados | PostgreSQL, através de pg |
| Sessões e segurança | Cookies HttpOnly, token CSRF, node:crypto/scrypt e MFA TOTP |
| E-mail | Nodemailer com SMTP |
| Imagens e media | sharp; FFmpeg/ffprobe opcionais para processamento de vídeo |
| Compilação | TypeScript (tsc), npm e scripts Node.js |
| Servidor web / proxy | Apache ou Nginx; HTTPS termina no proxy em produção |

As versões exactas das dependências estão registadas em package-lock.json. A revisão de 13/10/2026 foi executada com Node.js 24.15.0 e npm 11.12.1.

## Estrutura

    backend/
      database/migrations/   alterações SQL versionadas
      database/proposals/   proposta de esquema inicial
      database/seeds/       dados fictícios opcionais para desenvolvimento
      docs/                 notas técnicas de módulos específicos
      src/                  API Fastify e módulos de rotas
      test/                 verificações de arranque e smoke HTTP
    deploy/                  exemplos de Apache e Nginx
    docs/                    documentação geral
    frontend/
      assets/                ícones e recursos estáticos
      pages/                 páginas HTML
      scripts/               lógica de interface e chamadas à API
      styles/                estilos
      videos/                vídeos optimizados e posters usados pelo site

## Começar em desenvolvimento

Pré-requisitos: Node.js compatível com Fastify 5, npm, PostgreSQL e um servidor HTTP para os ficheiros do frontend (por exemplo, Apache/XAMPP).

1. Instala as dependências:

       npm.cmd ci

2. Cria a configuração local e preenche-a sem a partilhar:

       Copy-Item .env.example .env

3. Cria a base Impacta, configura a conta de aplicação impacta_app e prepara o esquema/migrações seguindo [Configuração e base de dados](backend/docs/postgresql-connection.md). Não uses o superutilizador PostgreSQL pela aplicação.

4. Serve a raiz do projecto pelo Apache, respeitando o caminho definido em FRONTEND_BASE_URL. A configuração de desenvolvimento do frontend usa a API local na porta 3001.

5. Compila e inicia a API:

       npm.cmd run build
       npm.cmd start

6. Confirma a prontidão em http://127.0.0.1:3001/api/v1/health/ready. A página pública fica no endereço HTTP servido pelo Apache.

A API não serve automaticamente as páginas HTML. No modo de desenvolvimento, frontend e API são serviços separados.

## Comandos

    npm.cmd run build   # compila backend/src para backend/dist
    npm.cmd start       # inicia backend/dist/server.js
    npm.cmd test        # arranque seguro e smoke checks HTTP

npm test não é uma suite completa de testes de interface ou de fluxos autenticados. Os seus limites e a verificação de produção estão descritos em [Desenvolvimento e validação](docs/DEVELOPMENT.md).

## Configuração e produção

- As variáveis estão documentadas, sem valores secretos, em [.env.example](.env.example).
- O ficheiro .env é local e nunca deve ser enviado ao Git.
- A API deve ficar ligada a loopback atrás de um proxy HTTPS; não exponhas a porta 3001 nem PostgreSQL à Internet.
- Produção exige TLS PostgreSQL, segredos fortes, SMTP, MFA, e uma pasta privada de media fora da raiz pública.
- Os modelos de proxy não são uma publicação: adapta-os ao domínio, certificados, firewall, caminhos e política CSP do alojamento.

Consulta [Deploy e operação](deploy/README.md), [Arquitectura](docs/ARCHITECTURE.md) e [Checklist de segurança](SECURITY-RELEASE-CHECKLIST.md). As migrações SQL actuais ainda precisam de revisão para um fluxo seguro de staging/produção. Não as executes remotamente apenas por ordem do nome do ficheiro.

## Documentação

- [Índice da documentação](docs/README.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Funcionalidades e fluxos](docs/FEATURES.md)
- [Desenvolvimento e validação](docs/DEVELOPMENT.md)
- [Base de dados](backend/docs/postgresql-connection.md)
- [Deploy e operação](deploy/README.md)
- [Checklist de segurança e lançamento](SECURITY-RELEASE-CHECKLIST.md)
- [Documentação técnica de módulos](backend/docs/)

## Estado do lançamento

O projecto ainda não deve ser considerado pronto para um piloto público até concluir os pontos pendentes da checklist, incluindo staging, migrações revistas, backup e restauro ensaiados, fluxos autenticados de ponta a ponta e testes no domínio/infraestrutura definitivos. Não existe neste repositório uma licença de distribuição publicada nem pipeline CI configurado.
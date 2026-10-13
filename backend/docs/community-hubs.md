# Comunidades, projetos e desafios

## Fluxo de publicação

- Qualquer conta autenticada pode propor uma comunidade pública. Ela fica com estado `pending` e não aparece na descoberta até ser aprovada.
- Qualquer conta autenticada pode propor um projeto. O projeto fica com estado `review`; se for associado a uma comunidade, o autor precisa ser membro ativo dela.
- Uma conta com `communities.manage` ao nível da plataforma aprova ou rejeita comunidades. Uma conta com `projects.review` ao nível da plataforma ou atribuída à comunidade aprova projetos dentro desse âmbito. A decisão fica no registo administrativo e o autor recebe uma notificação.
- Depois de um projeto ficar ativo, o seu proprietário, o proprietário/gestor da comunidade associada ou uma conta com `projects.review` pode criar desafios ligados ao projeto.
- Os desafios publicados aparecem dentro do período definido. Cada membro autenticado envia uma participação pelo formulário; a API impede participações duplicadas.
- Os membros aderem a projetos e comunidades pelos respetivos botões. A API trata cliques repetidos como adesão já existente, sem aumentar os contadores outra vez.

## Ativação local

Aplicar `backend/database/migrations/20261009-community-hubs.sql` como proprietário da base `Impacta` e reiniciar a API. A migração concede ao papel `impacta_app` apenas as colunas usadas, ativa as permissões de revisão dos papéis `platform_admin` e `super_admin`, e arquiva a comunidade de demonstração reservada sem apagar o histórico.

Para atribuir revisão a outra conta, usar a gestão de funções/permissões já existente e atribuir `communities.manage` ao nível da plataforma ou `projects.review` à plataforma/comunidade correspondente. A autorização é sempre verificada pela API.

# Documentação IMPACTA

Esta documentação acompanha o código presente no repositório. Usa o índice para encontrar a referência adequada.

## Visão geral

- [README do projecto](../README.md): propósito, tecnologias, estrutura, configuração inicial e comandos.
- [Arquitectura](ARCHITECTURE.md): relação entre frontend, API, PostgreSQL, autenticação e media.
- [Funcionalidades](FEATURES.md): módulos e fluxos implementados, com limites conhecidos.
- [Desenvolvimento e validação](DEVELOPMENT.md): instalação local, scripts e âmbito dos checks.
- [Contribuição](CONTRIBUTING.md): práticas para alterações, migrações e revisão.

## Operação

- [Ligação e configuração PostgreSQL](../backend/docs/postgresql-connection.md)
- [Deploy e proxy HTTPS](../deploy/README.md)
- [Checklist de segurança e lançamento](../SECURITY-RELEASE-CHECKLIST.md)
- [Dados fictícios locais](../backend/docs/demo-data.md)

## Referências por módulo

- [Administração: arquitectura](../backend/docs/admin-area-architecture.md)
- [Autenticação MFA administrativa](../backend/docs/admin-mfa.md)
- [Escalonamento de denúncias](../backend/docs/admin-report-escalation.md)
- [Comunidades](../backend/docs/community-hubs.md)
- [Verificação de canais públicos](../backend/docs/public-channel-verification.md)
- [Projectos, propostas e candidaturas](../backend/docs/project-proposals-and-candidatures.md)
- [Mensagens privadas de projecto](../backend/docs/project-group-messaging.md)
- [Perfis e media](../backend/docs/profile-and-media.md)
- [Limites de tentativas de início de sessão](../backend/docs/login-rate-limit.md)

Uma funcionalidade documentada no código não equivale a uma garantia de funcionamento na instalação de produção. Confirma configuração, migrações e critérios de lançamento antes de convidar utilizadores.
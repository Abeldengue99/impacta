# IMPACTA: verificações antes de abrir ao público

O código reduz riscos, mas não permite prometer ausência total de falhas. Marque cada item só depois de o confirmar no ambiente real.

## Implementado nesta revisão

- Login administrativo falha em segurança fechada se a API não conseguir confirmar as permissões da conta.
- Administradores têm de concluir MFA TOTP antes de aceder às funções administrativas; a configuração e a recuperação usam os fluxos existentes.
- Pedidos de verificação de figuras públicas e organizações exigem perfil público, contexto e uma prova HTTPS. A equipa autorizada pode aprovar, recusar e retirar o selo; cada decisão fica na auditoria.
- O mesmo endereço de e-mail não pode ser registado com variações de maiúsculas/minúsculas depois de aplicar a migração. A migração pára se encontrar endereços já duplicados.
- Há limite de processamento simultâneo de vídeos por processo. O limite pode ser configurado de 1 a 4; o valor por omissão é 1.
- Em produção, a API exige `PGPOOL_MAX`, `PGSSL=true`, MFA configurado e uma pasta `IMPACTA_MEDIA_DIR` absoluta fora da aplicação.
- A configuração Apache aplica HSTS apenas em pedidos HTTPS. A API já envia uma CSP própria para respostas da API.

## Bloqueios antes do lançamento

- [ ] Fazer cópia de segurança da base de dados e aplicar `backend/database/migrations/20261011-email-and-account-verification.sql`. Resolver duplicados de e-mail antes de repetir a migração.
- [ ] Testar MFA e códigos de recuperação com todas as contas administrativas; guardar os códigos num gestor de segredos acessível à equipa autorizada.
- [ ] Publicar apenas com HTTPS e confirmar no alojamento que Apache respeita as regras `.htaccess`; configurar a CSP do frontend para os domínios reais do frontend, API e recursos externos.
- [ ] Definir `IMPACTA_MEDIA_DIR` num volume privado, fora da pasta pública, e confirmar que ficheiros enviados não podem ser descarregados sem autorização.
- [ ] Trocar credenciais que possam ter estado acessíveis enquanto a cópia local expunha ficheiros internos; guardar novas credenciais fora do repositório.
- [ ] Executar `npm audit` num ambiente com acesso ao registo npm e corrigir ou documentar cada dependência vulnerável.
- [ ] Restaurar uma cópia de segurança numa instalação separada e confirmar o processo de recuperação.
- [ ] Executar testes de carga com o servidor, a base de dados e as dimensões de ficheiros escolhidos; medir latência, erros, CPU, memória e ligações PostgreSQL.
- [ ] Fazer revisão independente de segurança antes de convidar figuras públicas.

## Limites conhecidos

- Não há domínio nem alojamento público configurado, por isso HSTS, CSP final, TLS, armazenamento privado, auditoria npm e capacidade de produção ainda não foram verificados no ambiente real.
- A unicidade do e-mail impede duplicação do mesmo endereço, mas não prova que uma pessoa não criou contas com endereços diferentes. Não se deve recolher documento de identidade só para impor um limite sem definir primeiro uma política de privacidade e retenção.
- O limite de vídeos vale por processo Node.js. Se houver vários processos ou servidores, o limite total será maior e precisa de uma fila/limite partilhado antes de aumentar a escala.

## Revisão de prontidão para piloto (13/10/2026)

- [x] A API de produção exige AUTH_TOKEN_PEPPER com pelo menos 32 bytes e configuração explícita de SMTP; falha no arranque se estiverem ausentes.
- [x] A API de produção fica limitada a 127.0.0.1; o proxy HTTPS de exemplo sobrescreve os cabeçalhos de IP encaminhados.
- [x] A API estática usa a origem HTTPS da página em produção; a porta 3001 fica apenas para desenvolvimento HTTP.
- [x] /health/ready verifica tabelas, colunas e privilégios das mensagens de projecto, publicações ligadas a projectos e revisão de desafios.
- [x] npm test executa uma verificação HTTP de leitura para os endpoints de vida e prontidão.
- [x] Existem exemplos Nginx e Apache com HTTPS, CSP, negação de acesso a backend e ficheiros internos em deploy/.
- [ ] Não publicar até escolher o alojamento/domínio e preencher/rever o proxy, certificados, firewall, PostgreSQL TLS e variáveis secretas.
- [ ] 34 dos 42 scripts SQL inventariados têm bloqueios explícitos contra execução fora do loopback. Não os executar remotamente; aprovar um processo de migração para staging antes de preparar uma base de teste.
- [ ] Fazer backup e ensaio de restauro isolado; validar as migrações num ambiente de staging limpo.
- [ ] Fazer testes autenticados de ponta a ponta para administração, mensagens, desafios, projectos e publicação de actualizações.
- [ ] Fazer teste de carga com limites de ficheiro e utilizadores previstos; medir erros, latência, CPU, memória e ligações PostgreSQL.
- [ ] Rever a CSP e todas as páginas no domínio real; verificar imagens/vídeos e autenticação através do proxy.
- [x] npm audit completo em 13/10/2026: zero vulnerabilidades conhecidas no relatório consultado.
- [ ] Revisão independente de segurança antes de convidar utilizadores.

O proxy e os scripts desta revisão são modelos, não uma publicação. A prontidão real
depende da configuração do alojamento e de executar os itens pendentes no destino.
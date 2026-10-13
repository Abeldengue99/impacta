# Contribuir

## Alterações

1. Parte de uma branch actualizada e mantém cada alteração ligada a um comportamento observável.
2. Separa alterações de interface, API, SQL e documentação quando isso facilitar revisão.
3. Actualiza estes documentos quando mudar configuração, permissões, fluxos, endpoints ou operação.
4. Não introduzas dados reais de utilizadores em fixtures ou screenshots versionados.

## Segurança

- Nunca versionar .env, credenciais, tokens, certificados, dumps ou media privada.
- Usa .env.example apenas com nomes de variáveis e valores demonstrativos vazios.
- Mantém a API atrás de HTTPS em produção e nunca abras PostgreSQL nem a porta 3001 à Internet.
- Mantém verificações de autorização no backend; ocultar um botão no frontend não protege um recurso.
- Não enfraqueças guardas de migrações para conseguir executá-las remotamente sem uma revisão e uma cópia recuperável.

## Revisão antes de integrar

Executa npm.cmd run build, npm.cmd test e git diff --check; inspecciona todos os ficheiros staged, com atenção a media, ficheiros de ambiente e SQL. Os checks existentes não substituem testes funcionais no ambiente de destino.
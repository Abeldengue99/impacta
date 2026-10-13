# Autenticação multifactor para contas administrativas

## Preparação do servidor

1. Gera uma chave hexadecimal aleatória de 32 bytes:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

2. Guarda o resultado como `MFA_ENCRYPTION_KEY` no ficheiro `.env` do servidor ou no gestor de segredos do alojamento. Não o coloques no repositório nem o envies por mensagens. Faz uma cópia de segurança segura da chave: sem ela, as chaves TOTP guardadas não podem ser desencriptadas.
3. Executa `backend/database/migrations/20261011-admin-mfa.sql` uma vez como proprietário da base de dados, depois de aplicar o esquema base e as migrações administrativas anteriores.
4. Em produção, configura a API e o frontend para comunicarem apenas através de HTTPS antes de permitir a autenticação administrativa.

## Primeiro acesso e utilização

- A migração marca as contas com permissões administrativas para exigir MFA e termina as sessões existentes dessas contas.
- No próximo início de sessão, a pessoa confirma a palavra-passe, adiciona a chave apresentada a uma app autenticadora compatível com TOTP e confirma o código de 6 dígitos.
- São apresentados 10 códigos de recuperação uma única vez. A pessoa deve guardá-los num local seguro.
- Os códigos de recuperação são de utilização única. Se um for usado no login, a pessoa tem de ligar novamente a app autenticadora; a chave antiga e os códigos anteriores são substituídos após a confirmação do novo TOTP.
- Se a pessoa perder a app e todos os códigos de recuperação, não existe um bypass automático. A recuperação tem de passar por confirmação de identidade feita pela equipa responsável antes de qualquer intervenção na conta.

Não alteres `MFA_ENCRYPTION_KEY` depois de contas estarem inscritas, a menos que as chaves TOTP sejam primeiro desencriptadas e re-encriptadas com a nova chave.

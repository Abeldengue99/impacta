# Escalada de denúncias urgentes

Uma publicação entra na fila urgente quando existem denúncias abertas ou em revisão de pelo menos seis perfis diferentes. O registo e o aviso aos moderadores são feitos na mesma transação da sexta denúncia.

A publicação continua no feed até uma pessoa com permissão `content.moderate` decidir ocultá-la ou removê-la. A decisão exige motivo, fica em `impacta.moderation_actions` e resolve as denúncias abertas dessa publicação. Remover altera o estado público para `removed`; os registos e os ficheiros permanecem guardados para histórico e análise.

## Ativação

1. Se a migração de notificações ainda não foi aplicada, executa `20261009-community-notifications.sql`.
2. Executa `20261009-report-escalation.sql` como proprietária da base de dados `Impacta`.
3. A conta administrativa precisa de uma função `moderator` ou `platform_admin` com âmbito `platform`. A migração associa as permissões às funções existentes, mas não promove automaticamente nenhuma conta.
4. Para atribuir a função de moderador a uma conta escolhida, executa como proprietária e substitui o endereço de exemplo pelo email exato dessa conta:

```sql
INSERT INTO impacta.user_roles (user_id, role_id, scope_type, scope_id)
SELECT account.id, role.id, 'platform', NULL
FROM impacta.users AS account
CROSS JOIN impacta.roles AS role
WHERE lower(account.email) = lower('admin@example.com')
  AND account.status = 'active'
  AND role.code = 'moderator'
ON CONFLICT DO NOTHING;
```

Depois de iniciar sessão com essa conta, a ligação **Administração** aparece no feed. A fila atualiza-se automaticamente enquanto a página administrativa estiver aberta.

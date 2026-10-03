# Dados de demonstração locais

`backend/database/seeds/impacta-demo-posts.sql` é um seed opcional para experimentar o feed ligado ao PostgreSQL. A aplicação não cria estes dados automaticamente.

O seed cria três contas fictícias, uma comunidade pública local e quatro publicações marcadas com `[TESTE IMPACTA]`. Usa os endereços reservados `example.test`. Cada perfil e publicação está identificado como demonstração.

## Executar no pgAdmin

1. Abre o Query Tool ligado à base `Impacta`, no servidor local `127.0.0.1` ou `::1`.
2. Na mesma sessão do Query Tool, executa `SET impacta.enable_test_seed = 'on';`.
3. Sem fechar nem reconectar essa sessão, abre e executa `backend/database/seeds/impacta-demo-posts.sql`.
4. A última consulta mostra os três utilizadores e o número de publicações de cada um.

Executa o seed como proprietária da base, não como `impacta_app`: a conta da aplicação não tem permissões para criar utilizadores nem publicações. O script recusa outra base, ligações remotas, a ausência da opção explícita de sessão e colisões com contas ou comunidade que não sejam fixtures. Pode ser executado mais de uma vez sem duplicar registos.

As contas têm uma hash de palavra-passe deliberadamente inválida para o login IMPACTA; não podem autenticar-se. Não substituas essa hash por uma palavra-passe real. Para apagar as fixtures, usa a secção `Cleanup` no fim do próprio script, também como proprietária da base.

Para testar contas reais e confirmação por email, usa o registo normal com um endereço que controles. Estas fixtures não enviam emails nem simulam uma confirmação de conta real.

# Limites de tentativas de login

O limite principal de palavra-passe é agora isolado por conta: até 10 tentativas em 15 minutos e 30 em 24 horas. Uma autenticação concluída começa uma janela nova para essa conta. Há também um limite de origem mais alto para reduzir automatização; uma pessoa que partilhe a rede não consome o limite de palavra-passe das outras contas.

Para libertar o bloqueio local criado pelo contador antigo, executa `20261009-login-rate-limit-recovery.sql` como proprietária da base `Impacta`. A migração preserva os registos do IP de loopback, mas muda o tipo dos eventos antigos para os retirar do contador partilhado. Depois reinicia a API para carregar o limite novo.

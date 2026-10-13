# Confirmação do canal oficial

O selo confirma que a pessoa ou organização controla o canal público indicado. Não confirma, por si só, a identidade civil.

## Experiência do requerente

1. No perfil público, escolhe o tipo de conta e indica o endereço HTTPS de um canal oficial.
2. O IMPACTA gera um código aleatório, válido por 30 dias. O contexto adicional é opcional e não se pedem documentos.
3. A pessoa publica o código temporariamente nesse canal e mantém-no visível até a revisão.
4. A equipa confirma o canal por uma fonte independente, verifica o código e aprova ou recusa o pedido.
5. Depois da decisão, o código é apagado. Se expirar antes da análise, a pessoa pode gerar outro.

## Revisão administrativa

- Não tratar o URL enviado como prova de propriedade. Usá-lo como pista e confirmar o canal por uma fonte independente.
- Aprovar apenas se o código ainda estiver válido e aparecer no canal oficial confirmado.
- A interface exige confirmação explícita e um motivo de decisão; a API volta a validar código e validade dentro da transação.
- Cada decisão é registada na auditoria. A confirmação guarda o administrador e a hora, mas não conserva o código.
- Aprovações antigas sem confirmação do canal deixam de exibir o selo. O titular pode fazer o novo processo simples; a aprovação nova substitui a antiga e fica auditada.

## Activação

Aplicar `backend/database/migrations/20261011-public-channel-verification-proof.sql` à base de dados antes de reiniciar a API nova. A verificação de prontidão da API falha enquanto as colunas não existirem. Depois publicar o backend e os ficheiros do perfil e da área administrativa.

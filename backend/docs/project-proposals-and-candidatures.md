# Propostas e participação em projetos

Aplica `backend/database/migrations/20261009-project-location-and-owner-status.sql` como proprietário da base local `Impacta` depois das migrações de comunidades e projetos. A migração acrescenta os campos de localização e decisão, concede acesso mínimo à API e garante que a inscrição do dono não entra na contagem de candidaturas.

Uma proposta pode ser independente ou estar ligada a uma comunidade ativa de que a pessoa seja membro. Província, município, comuna, bairro e cidade são campos opcionais. As propostas ficam em análise até a equipa decidir. O dono acompanha o estado e o motivo de rejeição no perfil; a equipa também envia uma notificação quando decide.

Depois de aprovada, a proposta aparece na lista de projetos. Uma pessoa autenticada pode inscrever-se uma vez. A lista pública mostra apenas a quantidade de pessoas inscritas, sem devolver os nomes. O dono do projeto não é contado como candidato.

# Funcionalidades e fluxos

Este documento resume a intenção e os percursos observáveis no frontend e backend. A existência de código/rotas não prova, por si só, que a configuração de uma instalação esteja completa.

## Site e feed

- Páginas públicas de apresentação, ajuda, contacto e mentores.
- Feed com categorias, pesquisa/filtros na interface, publicações de texto e media.
- Comentários, reacções/apoios, partilha, denúncias, notificações e contadores.
- Moderação e revisão selectiva do conteúdo segundo o estado do conteúdo e as permissões administrativas.
- Publicações podem ser associadas a projectos para dar visibilidade a actualizações e resultados.

## Contas e perfis

- Registo, confirmação de e-mail, início/fim de sessão, sessão actual e recuperação de palavra-passe.
- Perfis próprios e públicos, avatar, capa, publicações, projectos e comunidades.
- Envio e consulta protegida de documentos de verificação de conta.
- Verificação de figuras públicas/canais e decisões auditáveis, quando as respectivas migrações e permissões estão aplicadas.

## Projectos e desafios

- Proposta de projectos comunitários e consulta de projectos activos.
- Adesão/participação em projectos conforme o estado e as regras do projecto.
- Responsáveis do projecto, responsáveis/moderadores da comunidade e revisores autorizados podem publicar desafios dentro do período do projecto.
- Um desafio aberto é escolhido de forma determinística como destaque semanal; a selecção renova na segunda-feira segundo o calendário de Luanda.
- Qualquer conta autenticada pode enviar uma proposta, mesmo sem ser membro do projecto. A equipa aceita ou recusa; recusas exigem motivo e podem ser reenviadas enquanto o desafio estiver aberto.
- Ao aceitar uma proposta, a pessoa entra como participante no projecto e ganha acesso à conversa privada do grupo.
- A pessoa participante envia a entrega e pode anexar até quatro imagens ou um vídeo optimizado por etapa. As evidências são privadas para a pessoa e para a equipa autorizada.
- A equipa pode confirmar a conclusão ou pedir ajustes com motivo. A conclusão não publica automaticamente a entrega nem emite certificados ou pontos.
- Depois da conclusão, a pessoa pode preparar uma actualização associada ao projecto e revê-la antes de a publicar no feed público.

## Comunidades e conversas

- Proposta de comunidades, consulta, pedidos de adesão e gestão de membros.
- Aprovação de adesão quando exigida pelo estado/configuração da comunidade.
- Conversa de grupo para membros autorizados, com leitura, envio, edição/remoção sujeita a permissões, denúncia e moderação.
- Conversa de projecto separada, acessível aos participantes e responsáveis. Não há mensagens directas abertas entre contas arbitrárias.
- Preferência para silenciar contagem/notificações de mensagens, sem alterar a autorização de acesso ao conteúdo.

## Administração e segurança

- Painéis de gestão, propostas, projectos/comunidades moderados, denúncias, análise de publicações, auditoria e segurança de sessões.
- MFA TOTP com chave de cifragem dedicada e códigos de recuperação nos fluxos administrativos.
- Anúncios e promoções, métricas, nota da página inicial e modo de manutenção.
- Exportação de cópia iniciada por administrador. Esta operação não substitui uma política externa de backups nem um ensaio de restauro.
- Limites de frequência em operações de escrita e de carregamento de ficheiros.

## O que ainda precisa de validação operacional

- As rotas e estados dependem das migrações SQL e dos privilégios da conta impacta_app.
- A conversa não foi validada aqui com múltiplas contas reais através de um alojamento HTTPS.
- A publicação de actualizações, revisão de desafios, pedidos de adesão e moderação devem ser exercitados de ponta a ponta em staging.
- A prontidão HTTP não valida e-mail entregue, UX de recuperação, conteúdo/media, recuperação de backup nem carga.
- Consulte a checklist de segurança e lançamento antes de abrir um piloto.

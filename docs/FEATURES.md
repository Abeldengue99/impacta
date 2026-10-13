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
- Responsável/moderador pode criar desafios ligados ao projecto.
- Participantes submetem respostas; a equipa do projecto pode rever, aceitar ou recusar segundo os estados implementados.
- Uma resposta recusada pode ser reenviada pelo mesmo participante; a API impede duplicação de participações activas.
- Actualizações do projecto podem ser partilhadas no feed público por quem tem permissão no projecto.

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
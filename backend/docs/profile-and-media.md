# Perfis e anexos

## Preparar a base de dados

Executa uma vez `backend/database/migrations/20261009-user-profile.sql` e depois `backend/database/migrations/20261009-post-media.sql` no Query Tool do pgAdmin, ligado à base `Impacta` como proprietário. A segunda migração concede à API acesso mínimo à relação `impacta.post_media`, já criada pela schema IMPACTA v1.

Depois instala as dependências com `npm install`, compila com `npm run build` e reinicia a API. Confirma `http://127.0.0.1:3001/api/v1/health/ready`; a verificação inclui a relação e os privilégios de anexos.

## Armazenamento e limites

Por omissão, os ficheiros ficam em `backend/storage/media`, fora da pasta pública `frontend/`. Avatares ficam diretamente nessa pasta e anexos de publicações em `posts/`. A pasta é ignorada pelo Git. Define `IMPACTA_MEDIA_DIR` para escolher outro volume com cópia de segurança. Os nomes físicos são aleatórios; a base guarda o tipo, o tamanho e o SHA-256 do ficheiro final.

Uma publicação aceita texto e até quatro imagens, ou um vídeo. Imagens PNG/JPEG/WebP podem ter até 12 MB cada; o servidor converte-as para WebP, limita a dimensão maior a 2560 px e rejeita imagens animadas ou acima dos limites de pixels. O avatar aceita PNG/JPEG até 2 MB e gera WebP até 1024 px. O processamento remove metadados de localização e da câmara.

Vídeos MP4 podem ter até 100 MB, 90 segundos e resolução 4K de entrada. A API converte para MP4/H.264, limita o lado maior a 1920 px, usa CRF 23 e remove metadados. O limite do ficheiro convertido é 50 MB. A conversão é com perdas para reduzir o tamanho; o objetivo é manter uma qualidade visual alta, mas a qualidade final depende do vídeo enviado e não pode ser idêntica ao original em todos os casos.

## Requisito de vídeo no Windows

O servidor precisa de `ffmpeg` e `ffprobe`. O IMPACTA usa os executáveis disponíveis no `PATH`, deteta instalações do pacote Gyan/FFmpeg através do WinGet no Windows ou aceita os caminhos absolutos `IMPACTA_FFMPEG_PATH` e `IMPACTA_FFPROBE_PATH` no `.env`. Sem estes executáveis, imagens e perfis continuam disponíveis, mas o upload de vídeo responde com `video_processor_unavailable`.

## Visibilidade e limpeza

O endpoint de media só entrega anexos ligados a publicações ativas e públicas; o acesso a avatares privados continua limitado ao dono autenticado. Vídeos suportam pedidos HTTP `Range` para permitir avançar e recuar durante a reprodução. Os uploads ainda não associados a uma publicação são apagados após 24 horas; a API faz essa limpeza no arranque e a cada seis horas. A página de perfil mostra as publicações próprias e, quando o perfil é público, as publicações públicas da pessoa com carregamento paginado.

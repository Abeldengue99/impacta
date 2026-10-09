# Perfil e fotografia

## Aplicar a migração

Executa uma vez `backend/database/migrations/20261009-user-profile.sql` no Query Tool do pgAdmin, ligado à base `Impacta` e com o proprietário da base. A migração acrescenta campos ao perfil, configura permissões mínimas para `impacta_app` e permite servir fotografias de perfil.

Depois da migração, recompila a API (`npm run build`) e reinicia o processo que já está a usar a porta 3001. A verificação `/api/v1/health/ready` confirma as tabelas e permissões necessárias.

## Armazenamento de fotografias

As fotografias ficam por omissão em `backend/storage/media`, fora de `frontend/`. O `.gitignore` exclui essa pasta. Para escolher outro diretório, define `IMPACTA_MEDIA_DIR` no ambiente da API.

A API aceita apenas PNG/JPEG, limita o ficheiro a 2 MB e as dimensões a 4096 × 4096 px. Remove blocos de metadados PNG e segmentos EXIF/XMP/Photoshop/comentários comuns do JPEG antes de guardar. O nome físico é aleatório; a base guarda o tipo, tamanho e SHA-256 da imagem guardada. SVG e outros formatos são rejeitados. Os perfis são editáveis apenas pela própria sessão e começam privados. Só aparecem no feed ou na página pública depois de a pessoa ativar a opção de visibilidade.

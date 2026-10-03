-- Dados fictícios locais do IMPACTA. A aplicação não os insere automaticamente.
-- Executa apenas num PostgreSQL local e como proprietária da base.
-- Na mesma sessão do Query Tool do pgAdmin, executa primeiro:
--   SET impacta.enable_test_seed = 'on';
-- Depois executa este ficheiro na base "Impacta".
-- As contas têm hashes inválidas e não podem iniciar sessão.

BEGIN;

DO $seed_guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR current_setting('impacta.enable_test_seed', true) IS DISTINCT FROM 'on'
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Seed bloqueado: usa a base local Impacta após definir impacta.enable_test_seed=on';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('ana.demo@example.test', '[TESTE] Ana Matondo'),
            ('bruno.demo@example.test', '[TESTE] Bruno Cossa'),
            ('carla.demo@example.test', '[TESTE] Carla Domingos')
        ) AS expected(email, display_name)
        JOIN impacta.users AS existing ON lower(existing.email) = expected.email
        WHERE existing.display_name IS DISTINCT FROM expected.display_name
           OR existing.status IS DISTINCT FROM 'active'
           OR existing.email_verified_at IS NULL
           OR existing.password_hash IS DISTINCT FROM '!fixture-login-disabled!'
    ) THEN
        RAISE EXCEPTION 'Um email reservado já pertence a uma conta não fictícia; nada foi inserido';
    END IF;

    IF EXISTS (
        SELECT 1 FROM impacta.communities
        WHERE slug = 'impacta-demo-comunidade'
          AND (name <> 'Comunidade de demonstração IMPACTA'
               OR status <> 'active' OR visibility <> 'public')
    ) THEN
        RAISE EXCEPTION 'O identificador reservado da comunidade já está em uso; nada foi inserido';
    END IF;
END;
$seed_guard$;

INSERT INTO impacta.users (email, password_hash, display_name, status, email_verified_at)
VALUES
    ('ana.demo@example.test', '!fixture-login-disabled!', '[TESTE] Ana Matondo', 'active', now()),
    ('bruno.demo@example.test', '!fixture-login-disabled!', '[TESTE] Bruno Cossa', 'active', now()),
    ('carla.demo@example.test', '!fixture-login-disabled!', '[TESTE] Carla Domingos', 'active', now())
ON CONFLICT DO NOTHING;

INSERT INTO impacta.user_profiles (user_id, bio, location)
SELECT user_account.id,
       'Perfil de demonstração. Dados fictícios para testar o feed.',
       'Luanda (demonstração)'
FROM impacta.users AS user_account
WHERE lower(user_account.email) IN ('ana.demo@example.test', 'bruno.demo@example.test', 'carla.demo@example.test')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO impacta.user_roles (user_id, role_id, scope_type)
SELECT user_account.id, role.id, 'platform'
FROM impacta.users AS user_account
CROSS JOIN impacta.roles AS role
WHERE lower(user_account.email) IN ('ana.demo@example.test', 'bruno.demo@example.test', 'carla.demo@example.test')
  AND role.code = 'member'
ON CONFLICT (user_id, role_id) WHERE scope_type = 'platform' DO NOTHING;

INSERT INTO impacta.communities (owner_user_id, name, slug, description, status, visibility)
SELECT user_account.id,
       'Comunidade de demonstração IMPACTA',
       'impacta-demo-comunidade',
       'Espaço com publicações fictícias para validar o feed local.',
       'active',
       'public'
FROM impacta.users AS user_account
WHERE lower(user_account.email) = 'ana.demo@example.test'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO impacta.community_members (community_id, user_id, membership_role, status)
SELECT community.id, user_account.id, 'member', 'active'
FROM impacta.communities AS community
CROSS JOIN impacta.users AS user_account
WHERE community.slug = 'impacta-demo-comunidade'
  AND lower(user_account.email) IN ('ana.demo@example.test', 'bruno.demo@example.test', 'carla.demo@example.test')
ON CONFLICT (community_id, user_id) DO NOTHING;

INSERT INTO impacta.posts (author_user_id, community_id, body, status)
SELECT user_account.id, community.id, post.body, 'published'
FROM (VALUES
    ('ana.demo@example.test', '[TESTE IMPACTA] Ana: Estamos a organizar uma pequena biblioteca comunitária. Que livros gostarias de encontrar?'),
    ('bruno.demo@example.test', '[TESTE IMPACTA] Bruno: Posso ajudar estudantes com noções básicas de programação aos sábados. Quem se junta?'),
    ('carla.demo@example.test', '[TESTE IMPACTA] Carla: A nossa primeira recolha de materiais escolares começa esta semana. Partilha esta iniciativa com a comunidade.'),
    ('ana.demo@example.test', '[TESTE IMPACTA] Ana: Obrigada a todos pelas ideias. Vamos transformar as sugestões em próximos passos e acompanhar o progresso aqui.')
) AS post(author_email, body)
JOIN impacta.users AS user_account ON lower(user_account.email) = post.author_email
JOIN impacta.communities AS community ON community.slug = 'impacta-demo-comunidade'
WHERE NOT EXISTS (
    SELECT 1 FROM impacta.posts AS existing
    WHERE existing.community_id = community.id AND existing.body = post.body
);

COMMIT;

SELECT user_account.display_name, user_account.email, community.name AS community,
       count(post.id)::int AS demo_posts
FROM impacta.users AS user_account
JOIN impacta.community_members AS membership ON membership.user_id = user_account.id
JOIN impacta.communities AS community ON community.id = membership.community_id
LEFT JOIN impacta.posts AS post ON post.author_user_id = user_account.id
                                 AND post.community_id = community.id
                                 AND post.body LIKE '[TESTE IMPACTA] %'
WHERE lower(user_account.email) IN ('ana.demo@example.test', 'bruno.demo@example.test', 'carla.demo@example.test')
  AND community.slug = 'impacta-demo-comunidade'
GROUP BY user_account.id, user_account.display_name, user_account.email, community.name
ORDER BY user_account.display_name;

-- Cleanup, if needed, as the database owner:
-- BEGIN;
-- DELETE FROM impacta.posts
-- WHERE body LIKE '[TESTE IMPACTA] %'
--   AND community_id = (SELECT id FROM impacta.communities WHERE slug = 'impacta-demo-comunidade');
-- DELETE FROM impacta.communities WHERE slug = 'impacta-demo-comunidade';
-- DELETE FROM impacta.users WHERE lower(email) IN (
--   'ana.demo@example.test', 'bruno.demo@example.test', 'carla.demo@example.test'
-- );
-- COMMIT;

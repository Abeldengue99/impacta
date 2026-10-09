-- Remove only the four reserved IMPACTA demo publications, if they were seeded.
-- Run as the database owner in pgAdmin against the local "Impacta" database.
-- No real user, community or publication is deleted by this script.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Cleanup bloqueado: executa apenas na base local Impacta';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM impacta.users AS account
        WHERE lower(account.email) IN (
            'ana.demo@example.test',
            'bruno.demo@example.test',
            'carla.demo@example.test'
        )
          AND (account.password_hash IS DISTINCT FROM '!fixture-login-disabled!'
               OR account.display_name NOT LIKE '[TESTE] %'
               OR account.status <> 'active')
    ) THEN
        RAISE EXCEPTION 'Cleanup bloqueado: uma conta de demonstração reservada já não corresponde ao seed original';
    END IF;
END;
$guard$;

DO $cleanup$
DECLARE
    removed_count bigint;
BEGIN
    DELETE FROM impacta.posts AS post
    USING impacta.communities AS community, impacta.users AS account
    WHERE post.community_id = community.id
      AND post.author_user_id = account.id
      AND community.slug = 'impacta-demo-comunidade'
      AND community.name = 'Comunidade de demonstração IMPACTA'
      AND lower(account.email) IN (
          'ana.demo@example.test',
          'bruno.demo@example.test',
          'carla.demo@example.test'
      )
      AND account.password_hash = '!fixture-login-disabled!'
      AND post.body LIKE '[TESTE IMPACTA] %';

    GET DIAGNOSTICS removed_count = ROW_COUNT;
    RAISE NOTICE 'Publicações de demonstração removidas: %', removed_count;
END;
$cleanup$;

COMMIT;

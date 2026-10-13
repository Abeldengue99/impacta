-- Atribui acesso administrativo à conta local do fundador do IMPACTA.
-- Executa uma vez como proprietário no pgAdmin, na base local "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migração bloqueada: executa apenas na base local Impacta';
    END IF;
END;
$guard$;

DO $grant_founder_admin$
DECLARE
    founder_id bigint;
    founder_count integer;
    platform_admin_role_id bigint;
BEGIN
    SELECT count(*)::integer
    INTO founder_count
    FROM impacta.users
    WHERE lower(display_name) = lower('Abel Dengue')
      AND status = 'active';

    IF founder_count <> 1 THEN
        RAISE EXCEPTION 'Esperava uma conta ativa do fundador Abel Dengue; foram encontradas %', founder_count;
    END IF;

    SELECT id
    INTO founder_id
    FROM impacta.users
    WHERE lower(display_name) = lower('Abel Dengue')
      AND status = 'active';

    SELECT id
    INTO platform_admin_role_id
    FROM impacta.roles
    WHERE code = 'platform_admin';

    IF platform_admin_role_id IS NULL THEN
        RAISE EXCEPTION 'A função platform_admin não existe; aplica primeiro o esquema base';
    END IF;

    INSERT INTO impacta.user_roles (user_id, role_id, scope_type, scope_id)
    VALUES (founder_id, platform_admin_role_id, 'platform', NULL)
    ON CONFLICT (user_id, role_id) WHERE scope_type = 'platform' DO NOTHING;
END;
$grant_founder_admin$;

COMMIT;

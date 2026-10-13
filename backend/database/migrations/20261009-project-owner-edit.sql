-- Permite ao dono atualizar a proposta; a API volta a colocá-la em revisão.
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

GRANT SELECT (updated_at) ON impacta.projects TO impacta_app;
GRANT UPDATE (impact_area_id, title, description, status, starts_at, ends_at, updated_at,
              location_city, location_neighborhood, location_municipality,
              location_province, location_commune, reviewed_at, reviewed_by_user_id, review_reason)
    ON impacta.projects TO impacta_app;

COMMIT;

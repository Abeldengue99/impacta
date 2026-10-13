-- Localização do projeto, histórico da revisão e estado privado para o proprietário.
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

ALTER TABLE impacta.projects
    ADD COLUMN IF NOT EXISTS location_city text,
    ADD COLUMN IF NOT EXISTS location_neighborhood text,
    ADD COLUMN IF NOT EXISTS location_municipality text,
    ADD COLUMN IF NOT EXISTS location_province text,
    ADD COLUMN IF NOT EXISTS location_commune text,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reviewed_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS review_reason text;

CREATE INDEX IF NOT EXISTS projects_owner_status_created_idx
    ON impacta.projects (owner_user_id, status, created_at DESC);

INSERT INTO impacta.project_members (project_id, user_id, membership_role)
SELECT project.id, project.owner_user_id, 'owner'
FROM impacta.projects AS project
WHERE project.status = 'active' AND project.owner_user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO UPDATE SET membership_role = 'owner';

GRANT SELECT (location_city, location_neighborhood, location_municipality,
              location_province, location_commune, reviewed_at, reviewed_by_user_id, review_reason)
    ON impacta.projects TO impacta_app;
GRANT SELECT (id, owner_user_id, community_id, impact_area_id, title, description, status,
              starts_at, ends_at, created_at)
    ON impacta.projects TO impacta_app;
GRANT INSERT (location_city, location_neighborhood, location_municipality,
              location_province, location_commune)
    ON impacta.projects TO impacta_app;
GRANT UPDATE (reviewed_at, reviewed_by_user_id, review_reason) ON impacta.projects TO impacta_app;
GRANT SELECT (project_id, membership_role) ON impacta.project_members TO impacta_app;

COMMIT;

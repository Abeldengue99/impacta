-- Community proposals, project review, challenge publishing and safe retirement
-- of the reserved local demo community. Run as the database owner in "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migração bloqueada: executa apenas na base local Impacta com o esquema impacta';
    END IF;
END;
$guard$;

-- A rejected community remains in history, but is hidden from public listings.
ALTER TABLE impacta.communities DROP CONSTRAINT IF EXISTS communities_status_check;
ALTER TABLE impacta.communities
    ADD CONSTRAINT communities_status_check
    CHECK (status IN ('pending', 'active', 'suspended', 'archived', 'rejected'));

INSERT INTO impacta.permissions (code, description) VALUES
    ('communities.manage', 'Rever propostas e gerir comunidades dentro do âmbito autorizado.'),
    ('projects.review', 'Rever projetos, gerir desafios e participação dentro do âmbito autorizado.')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO impacta.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM impacta.roles AS role
CROSS JOIN impacta.permissions AS permission
WHERE role.code IN ('platform_admin', 'super_admin')
  AND permission.code IN ('communities.manage', 'projects.review')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Keep the seeded demo space out of public discovery while retaining its history.
UPDATE impacta.communities
SET status = 'archived', updated_at = now()
WHERE slug = 'impacta-demo-comunidade'
  AND name = 'Comunidade de demonstração IMPACTA'
  AND description = 'Espaço com publicações fictícias para validar o feed local.'
  AND status = 'active';

CREATE INDEX IF NOT EXISTS communities_owner_created_idx
    ON impacta.communities (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_owner_created_idx
    ON impacta.projects (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_creator_created_idx
    ON impacta.challenges (created_by_user_id, created_at DESC);

GRANT SELECT (id, name, is_active) ON impacta.impact_areas TO impacta_app;

GRANT SELECT (id, owner_user_id, impact_area_id, name, slug, description, status, visibility, created_at, updated_at)
    ON impacta.communities TO impacta_app;
GRANT INSERT (owner_user_id, impact_area_id, name, slug, description, status, visibility)
    ON impacta.communities TO impacta_app;
GRANT UPDATE (status, updated_at) ON impacta.communities TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.communities_id_seq TO impacta_app;

GRANT SELECT (id, community_id, owner_user_id, impact_area_id, title, description, status,
              starts_at, ends_at, created_at, updated_at)
    ON impacta.projects TO impacta_app;
GRANT INSERT (community_id, owner_user_id, impact_area_id, title, description, status, starts_at, ends_at)
    ON impacta.projects TO impacta_app;
GRANT UPDATE (status, updated_at) ON impacta.projects TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.projects_id_seq TO impacta_app;

GRANT SELECT (id, project_id, created_by_user_id, title, description, status, opens_at, closes_at, created_at)
    ON impacta.challenges TO impacta_app;
GRANT INSERT (project_id, created_by_user_id, title, description, status, opens_at, closes_at)
    ON impacta.challenges TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.challenges_id_seq TO impacta_app;

GRANT SELECT (community_id, user_id, membership_role, status) ON impacta.community_members TO impacta_app;
GRANT INSERT (community_id, user_id, membership_role, status) ON impacta.community_members TO impacta_app;
GRANT INSERT (project_id, user_id, membership_role) ON impacta.project_members TO impacta_app;
GRANT SELECT (project_id, user_id) ON impacta.project_members TO impacta_app;
GRANT SELECT (id, challenge_id, user_id, status) ON impacta.challenge_participations TO impacta_app;

GRANT SELECT (id, display_name, status) ON impacta.users TO impacta_app;
GRANT SELECT (id, code) ON impacta.roles TO impacta_app;
GRANT SELECT (id, code) ON impacta.permissions TO impacta_app;
GRANT SELECT (role_id, permission_id) ON impacta.role_permissions TO impacta_app;
GRANT SELECT (user_id, role_id, scope_type, scope_id) ON impacta.user_roles TO impacta_app;

GRANT INSERT (user_id, notification_type, payload) ON impacta.notifications TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.notifications_id_seq TO impacta_app;
GRANT INSERT (actor_user_id, action_code, target_type, target_id, reason)
    ON impacta.admin_audit_log TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.admin_audit_log_id_seq TO impacta_app;

COMMIT;

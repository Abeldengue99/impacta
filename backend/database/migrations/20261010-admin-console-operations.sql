-- Permissões mínimas para os módulos ativos da consola administrativa IMPACTA.
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

GRANT SELECT (id, email, display_name, status, created_at, mfa_required)
    ON impacta.users TO impacta_app;
GRANT UPDATE (status, updated_at) ON impacta.users TO impacta_app;

GRANT SELECT (id, code, name, description, is_system) ON impacta.roles TO impacta_app;
GRANT SELECT (id, code, description) ON impacta.permissions TO impacta_app;
GRANT SELECT (role_id, permission_id) ON impacta.role_permissions TO impacta_app;
GRANT SELECT (id, user_id, role_id, granted_at, scope_type, scope_id) ON impacta.user_roles TO impacta_app;
GRANT INSERT (user_id, role_id, granted_by_user_id, scope_type, scope_id) ON impacta.user_roles TO impacta_app;
GRANT DELETE ON impacta.user_roles TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.user_roles_id_seq TO impacta_app;

GRANT SELECT (id, owner_user_id, impact_area_id, name, slug, description, status, visibility, created_at, updated_at)
    ON impacta.communities TO impacta_app;
GRANT UPDATE (status, updated_at) ON impacta.communities TO impacta_app;
GRANT SELECT (community_id, user_id, status) ON impacta.community_members TO impacta_app;
GRANT SELECT (id, community_id, owner_user_id, impact_area_id, title, description, status,
              starts_at, ends_at, location_city, location_neighborhood, location_municipality,
              location_province, location_commune, created_at, updated_at, reviewed_at,
              reviewed_by_user_id, review_reason)
    ON impacta.projects TO impacta_app;
GRANT UPDATE (status, updated_at) ON impacta.projects TO impacta_app;
GRANT SELECT (project_id, user_id) ON impacta.project_members TO impacta_app;

GRANT SELECT (id, project_id, created_by_user_id, title, description, status, opens_at, closes_at, created_at)
    ON impacta.challenges TO impacta_app;
GRANT INSERT (project_id, created_by_user_id, title, description, status, opens_at, closes_at)
    ON impacta.challenges TO impacta_app;
GRANT UPDATE (status) ON impacta.challenges TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.challenges_id_seq TO impacta_app;
GRANT SELECT (id, challenge_id) ON impacta.challenge_participations TO impacta_app;

GRANT INSERT (actor_user_id, target_user_id, action_type, reason) ON impacta.moderation_actions TO impacta_app;
GRANT SELECT (id, actor_user_id, target_user_id, post_id, comment_id, action_type, reason, created_at)
    ON impacta.moderation_actions TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.moderation_actions_id_seq TO impacta_app;
GRANT SELECT (user_id) ON impacta.auth_sessions TO impacta_app;
GRANT UPDATE (revoked_at) ON impacta.auth_sessions TO impacta_app;

GRANT SELECT (id, author_user_id, title, body, status, publish_at, expires_at, created_at, updated_at)
    ON impacta.announcements TO impacta_app;
GRANT INSERT (author_user_id, title, body, status, audience, publish_at, expires_at)
    ON impacta.announcements TO impacta_app;
GRANT UPDATE (status, publish_at, updated_at) ON impacta.announcements TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.announcements_id_seq TO impacta_app;

GRANT SELECT (id, code, name, description, is_active) ON impacta.badges TO impacta_app;
GRANT INSERT (code, name, description) ON impacta.badges TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.badges_id_seq TO impacta_app;
GRANT SELECT (user_id, badge_id) ON impacta.user_badges TO impacta_app;
GRANT INSERT (user_id, badge_id, awarded_by_user_id, reason) ON impacta.user_badges TO impacta_app;
GRANT SELECT (user_id, points_delta) ON impacta.points_ledger TO impacta_app;
GRANT INSERT (user_id, actor_user_id, points_delta, reason) ON impacta.points_ledger TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.points_ledger_id_seq TO impacta_app;

GRANT SELECT (id, user_id, request_type, status, notes, created_at, due_at, assigned_to_user_id, completed_at)
    ON impacta.privacy_requests TO impacta_app;
GRANT UPDATE (status, notes, assigned_to_user_id, completed_at) ON impacta.privacy_requests TO impacta_app;

GRANT SELECT (id, actor_user_id, action_code, target_type, target_id, reason, occurred_at)
    ON impacta.admin_audit_log TO impacta_app;
GRANT INSERT (actor_user_id, action_code, target_type, target_id, reason)
    ON impacta.admin_audit_log TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.admin_audit_log_id_seq TO impacta_app;

GRANT SELECT (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at,
              absolute_expires_at, user_agent, ip_address, revoked_at)
    ON impacta.auth_sessions TO impacta_app;
GRANT UPDATE (revoked_at) ON impacta.auth_sessions TO impacta_app;

GRANT SELECT (key, value) ON impacta.platform_settings TO impacta_app;
GRANT INSERT (key, value, description, updated_by_user_id) ON impacta.platform_settings TO impacta_app;
GRANT UPDATE (value, description, updated_by_user_id, updated_at) ON impacta.platform_settings TO impacta_app;
GRANT DELETE ON impacta.platform_settings TO impacta_app;

COMMIT;

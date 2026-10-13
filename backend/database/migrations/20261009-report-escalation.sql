-- Escalate reports from six distinct profiles to the platform admin queue.
-- The post stays visible until an authorized moderator hides or removes it.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

CREATE INDEX IF NOT EXISTS content_reports_post_status_reporter_idx
    ON impacta.content_reports (post_id, status, reporter_user_id)
    WHERE post_id IS NOT NULL;

INSERT INTO impacta.permissions (code, description) VALUES
    ('reports.manage', 'Consultar a fila de denúncias urgentes da plataforma.'),
    ('content.moderate', 'Ocultar ou remover conteúdo sinalizado com motivo.')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO impacta.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM impacta.roles AS role
CROSS JOIN impacta.permissions AS permission
WHERE role.code IN ('moderator', 'platform_admin')
  AND permission.code IN ('reports.manage', 'content.moderate')
ON CONFLICT (role_id, permission_id) DO NOTHING;

GRANT SELECT (id, code) ON impacta.roles TO impacta_app;
GRANT SELECT (id, code) ON impacta.permissions TO impacta_app;
GRANT SELECT (role_id, permission_id) ON impacta.role_permissions TO impacta_app;
GRANT SELECT (user_id, role_id, scope_type, scope_id) ON impacta.user_roles TO impacta_app;
GRANT SELECT (id, display_name, status) ON impacta.users TO impacta_app;

GRANT SELECT (id, body, author_user_id, created_at, status, deleted_at)
    ON impacta.posts TO impacta_app;
GRANT UPDATE (status, deleted_at, updated_at) ON impacta.posts TO impacta_app;

GRANT SELECT (id, reporter_user_id, post_id, reason_code, details, status, created_at)
    ON impacta.content_reports TO impacta_app;
GRANT UPDATE (status, resolved_at, assigned_to_user_id) ON impacta.content_reports TO impacta_app;

GRANT INSERT (actor_user_id, post_id, action_type, reason)
    ON impacta.moderation_actions TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.moderation_actions_id_seq TO impacta_app;

GRANT SELECT (user_id, notification_type, payload, read_at)
    ON impacta.notifications TO impacta_app;
GRANT INSERT (user_id, notification_type, payload) ON impacta.notifications TO impacta_app;
GRANT UPDATE (read_at) ON impacta.notifications TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.notifications_id_seq TO impacta_app;

COMMIT;

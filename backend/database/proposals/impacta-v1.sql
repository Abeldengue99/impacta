-- IMPACTA PostgreSQL schema proposal, version 1.
-- Review before use. This script has not been executed.
-- Target: PostgreSQL 12 or newer.
-- Creates a dedicated schema. It does not create credentials or an administrator.
-- Configure application grants and secret storage separately after review.
-- Closing an account should anonymize/pseudonymize it and revoke sessions; do not
-- hard-delete it while moderation, audit, recognition, or privacy history must remain.

BEGIN;

CREATE SCHEMA impacta;
REVOKE ALL ON SCHEMA impacta FROM PUBLIC;
SET LOCAL search_path = impacta, public;

CREATE TABLE impact_areas (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(code)) > 0),
    CHECK (length(trim(name)) > 0)
);

CREATE TABLE roles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    is_system boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(code)) > 0)
);

CREATE TABLE permissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    description text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(code)) > 0)
);

CREATE TABLE role_permissions (
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text,
    password_hash text,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
    email_verified_at timestamptz,
    mfa_required boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    CHECK (email IS NULL OR (length(email) <= 320 AND position('@' in email) > 1)),
    CHECK (
        (status = 'closed' AND email IS NULL AND password_hash IS NULL AND closed_at IS NOT NULL)
        OR (status <> 'closed' AND email IS NOT NULL AND password_hash IS NOT NULL AND closed_at IS NULL)
    ),
    CHECK (length(trim(display_name)) > 0)
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_status_created_idx ON users (status, created_at DESC);

CREATE TABLE user_profiles (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bio text NOT NULL DEFAULT '',
    location text,
    avatar_media_id bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A role assignment is platform-wide or scoped to one community. Partial unique
-- indexes avoid NULL semantics in a composite primary key.
CREATE TABLE user_roles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    granted_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    scope_type text NOT NULL DEFAULT 'platform'
        CHECK (scope_type IN ('platform', 'community')),
    scope_id bigint,
    CHECK (
        (scope_type = 'platform' AND scope_id IS NULL)
        OR (scope_type = 'community' AND scope_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX user_roles_platform_unique ON user_roles (user_id, role_id)
    WHERE scope_type = 'platform';
CREATE UNIQUE INDEX user_roles_community_unique ON user_roles (user_id, role_id, scope_id)
    WHERE scope_type = 'community';
CREATE INDEX user_roles_role_idx ON user_roles (role_id, user_id);

CREATE TABLE mfa_credentials (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_totp_secret text NOT NULL,
    verified_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_recovery_codes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, code_hash)
);

CREATE TABLE auth_sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    csrf_token_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    ip_address inet,
    user_agent text,
    CHECK (idle_expires_at <= absolute_expires_at),
    CHECK (user_agent IS NULL OR length(user_agent) <= 1000)
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id, absolute_expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE auth_tokens (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose, expires_at);

CREATE TABLE auth_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    ip_address inet,
    user_agent text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    CHECK (user_agent IS NULL OR length(user_agent) <= 1000)
);
CREATE INDEX auth_events_user_time_idx ON auth_events (user_id, occurred_at DESC);
CREATE INDEX auth_events_time_idx ON auth_events (occurred_at DESC);

CREATE TABLE media (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    storage_key text NOT NULL UNIQUE,
    media_type text NOT NULL CHECK (media_type IN ('image', 'video', 'document', 'other')),
    mime_type text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    checksum_sha256 char(64) NOT NULL,
    status text NOT NULL DEFAULT 'pending_scan'
        CHECK (status IN ('pending_scan', 'available', 'quarantined', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(storage_key)) > 0)
);

ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_avatar_media_fk
    FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;

CREATE TABLE communities (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    impact_area_id bigint REFERENCES impact_areas(id) ON DELETE SET NULL,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'suspended', 'archived')),
    visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(name)) > 0),
    CHECK (length(trim(slug)) > 0)
);

ALTER TABLE user_roles ADD CONSTRAINT user_roles_community_scope_fk
    FOREIGN KEY (scope_id) REFERENCES communities(id) ON DELETE CASCADE;

CREATE TABLE community_members (
    community_id bigint NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_role text NOT NULL DEFAULT 'member' CHECK (membership_role IN ('member', 'manager')),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'removed', 'blocked')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON community_members (user_id, status);

CREATE TABLE projects (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    community_id bigint REFERENCES communities(id) ON DELETE SET NULL,
    owner_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    impact_area_id bigint REFERENCES impact_areas(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'review', 'active', 'completed', 'rejected', 'archived')),
    starts_at timestamptz,
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
    CHECK (length(trim(title)) > 0)
);
CREATE INDEX projects_status_created_idx ON projects (status, created_at DESC);
CREATE INDEX projects_community_idx ON projects (community_id, status);

CREATE TABLE project_members (
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    membership_role text NOT NULL DEFAULT 'contributor'
        CHECK (membership_role IN ('owner', 'contributor')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE challenges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id bigint REFERENCES projects(id) ON DELETE SET NULL,
    created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
    opens_at timestamptz,
    closes_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at >= opens_at),
    CHECK (length(trim(title)) > 0)
);

CREATE TABLE challenge_participations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    challenge_id bigint NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submission text NOT NULL,
    status text NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'rejected', 'withdrawn')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_reason text,
    UNIQUE (challenge_id, user_id)
);

CREATE TABLE posts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    community_id bigint REFERENCES communities(id) ON DELETE SET NULL,
    project_id bigint REFERENCES projects(id) ON DELETE SET NULL,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'removed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (length(trim(body)) > 0)
);
CREATE INDEX posts_community_time_idx ON posts (community_id, created_at DESC);
CREATE INDEX posts_author_time_idx ON posts (author_user_id, created_at DESC);

CREATE TABLE post_media (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id bigint NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
    position smallint NOT NULL DEFAULT 0 CHECK (position >= 0),
    PRIMARY KEY (post_id, media_id)
);

CREATE TABLE comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    parent_comment_id bigint REFERENCES comments(id) ON DELETE CASCADE,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'removed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (length(trim(body)) > 0),
    CHECK (parent_comment_id IS NULL OR parent_comment_id <> id)
);
CREATE INDEX comments_post_time_idx ON comments (post_id, created_at);
CREATE INDEX comments_author_time_idx ON comments (author_user_id, created_at DESC);

CREATE TABLE reactions (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reaction_type text NOT NULL DEFAULT 'like' CHECK (reaction_type IN ('like', 'support', 'inspired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE content_reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    post_id bigint REFERENCES posts(id) ON DELETE RESTRICT,
    comment_id bigint REFERENCES comments(id) ON DELETE RESTRICT,
    user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
    reason_code text NOT NULL,
    details text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    assigned_to_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK (num_nonnulls(post_id, comment_id, user_id) = 1),
    CHECK (length(trim(reason_code)) > 0)
);
CREATE INDEX content_reports_queue_idx ON content_reports (status, created_at);
CREATE INDEX content_reports_assignee_idx ON content_reports (assigned_to_user_id, status);

CREATE TABLE moderation_actions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    post_id bigint REFERENCES posts(id) ON DELETE RESTRICT,
    comment_id bigint REFERENCES comments(id) ON DELETE RESTRICT,
    target_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
    action_type text NOT NULL CHECK (
        action_type IN ('hide_content', 'restore_content', 'remove_content', 'suspend_user', 'restore_user', 'warn_user')
    ),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    CHECK (num_nonnulls(post_id, comment_id, target_user_id) = 1),
    CHECK (length(trim(reason)) > 0),
    CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX moderation_actions_actor_time_idx ON moderation_actions (actor_user_id, created_at DESC);
CREATE INDEX moderation_actions_target_user_idx ON moderation_actions (target_user_id, created_at DESC);

CREATE TABLE moderation_appeals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    moderation_action_id bigint NOT NULL REFERENCES moderation_actions(id) ON DELETE RESTRICT,
    appellant_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'upheld', 'reversed')),
    appeal_text text NOT NULL,
    reviewer_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    CHECK (length(trim(appeal_text)) > 0)
);

CREATE TABLE announcements (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    author_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'published', 'expired', 'archived')),
    audience jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb
        CHECK (jsonb_typeof(audience) = 'object'),
    publish_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at),
    CHECK (length(trim(title)) > 0),
    CHECK (length(trim(body)) > 0)
);

CREATE TABLE notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE badges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(code)) > 0),
    CHECK (length(trim(name)) > 0)
);

CREATE TABLE user_badges (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    badge_id bigint NOT NULL REFERENCES badges(id) ON DELETE RESTRICT,
    awarded_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    reason text NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE points_ledger (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    points_delta integer NOT NULL CHECK (points_delta <> 0),
    reason text NOT NULL,
    source_type text NOT NULL DEFAULT 'admin_adjustment',
    source_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(reason)) > 0)
);
CREATE INDEX points_ledger_user_time_idx ON points_ledger (user_id, created_at DESC);

CREATE TABLE privacy_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_type text NOT NULL CHECK (request_type IN ('access', 'correction', 'export', 'closure')),
    status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'reviewing', 'waiting_user', 'completed', 'rejected')),
    assigned_to_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    due_at timestamptz,
    completed_at timestamptz
);
CREATE INDEX privacy_requests_queue_idx ON privacy_requests (status, due_at);

CREATE TABLE platform_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text NOT NULL DEFAULT '',
    updated_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(trim(key)) > 0)
);

CREATE TABLE admin_audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    action_code text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    reason text,
    request_id text,
    ip_address inet,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    CHECK (length(trim(action_code)) > 0),
    CHECK (length(trim(target_type)) > 0)
);
CREATE INDEX admin_audit_actor_time_idx ON admin_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit_log (target_type, target_id, occurred_at DESC);
CREATE INDEX admin_audit_time_idx ON admin_audit_log (occurred_at DESC);

CREATE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER user_profiles_touch_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER communities_touch_updated_at BEFORE UPDATE ON communities
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER posts_touch_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER comments_touch_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER announcements_touch_updated_at BEFORE UPDATE ON announcements
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO roles (code, name, description) VALUES
    ('member', 'Membro', 'Conta padrão da plataforma.'),
    ('support_agent', 'Apoio', 'Apoio limitado aos utilizadores.'),
    ('moderator', 'Moderador', 'Moderação de conteúdo, denúncias e recursos.'),
    ('community_manager', 'Gestor de comunidade', 'Gestão limitada às comunidades atribuídas.'),
    ('platform_admin', 'Administrador da plataforma', 'Operações administrativas da plataforma.'),
    ('super_admin', 'Super administrador', 'Identidade de bootstrap e emergência, sem atribuição pela interface.');

INSERT INTO permissions (code, description) VALUES
    ('admin.dashboard.read', 'Ver indicadores administrativos autorizados.'),
    ('users.read', 'Consultar dados mínimos de contas autorizadas.'),
    ('users.suspend', 'Suspender e restaurar contas com motivo.'),
    ('users.roles.manage', 'Gerir funções que o ator está autorizado a atribuir.'),
    ('communities.read', 'Consultar comunidades no âmbito autorizado.'),
    ('communities.manage', 'Gerir comunidades no âmbito autorizado.'),
    ('projects.read', 'Consultar projetos e desafios autorizados.'),
    ('projects.review', 'Rever projetos e participações autorizados.'),
    ('content.read', 'Consultar conteúdo sinalizado ou moderado.'),
    ('content.moderate', 'Ocultar, restaurar ou remover conteúdo com motivo.'),
    ('reports.manage', 'Tratar denúncias e recursos.'),
    ('announcements.manage', 'Gerir anúncios da plataforma.'),
    ('recognition.manage', 'Gerir distintivos e lançamentos de pontos.'),
    ('privacy.manage', 'Tratar pedidos de privacidade.'),
    ('audit.read', 'Pesquisar registos de auditoria autorizados.'),
    ('audit.export', 'Exportar registos de auditoria autorizados.'),
    ('admin.sessions.revoke', 'Revogar sessões de outros utilizadores.'),
    ('settings.manage', 'Alterar configurações não secretas da plataforma.');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'support_agent'
  AND p.code IN ('admin.dashboard.read', 'users.read', 'privacy.manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'moderator'
  AND p.code IN ('admin.dashboard.read', 'content.read', 'content.moderate', 'reports.manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'community_manager'
  AND p.code IN ('admin.dashboard.read', 'communities.read', 'communities.manage',
                 'projects.read', 'projects.review', 'content.read', 'content.moderate',
                 'reports.manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'platform_admin'
  AND p.code NOT IN ('admin.sessions.revoke');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'super_admin';

COMMIT;

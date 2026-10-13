BEGIN;

CREATE TABLE IF NOT EXISTS impacta.mfa_credentials (
    user_id bigint PRIMARY KEY REFERENCES impacta.users(id) ON DELETE CASCADE,
    encrypted_totp_secret text NOT NULL,
    verified_at timestamptz NOT NULL,
    last_used_step bigint NOT NULL DEFAULT -1,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE impacta.mfa_credentials
    ADD COLUMN IF NOT EXISTS last_used_step bigint NOT NULL DEFAULT -1;

CREATE TABLE IF NOT EXISTS impacta.mfa_recovery_codes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    code_hash char(64) NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS impacta.mfa_challenges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    purpose text NOT NULL CHECK (purpose IN ('login', 'setup', 'recovery_setup')),
    encrypted_totp_secret text,
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    ip_address inet,
    user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
    CHECK (expires_at > created_at),
    CHECK ((purpose IN ('setup', 'recovery_setup') AND encrypted_totp_secret IS NOT NULL)
        OR (purpose = 'login' AND encrypted_totp_secret IS NULL))
);

CREATE INDEX IF NOT EXISTS mfa_challenges_user_active_idx
    ON impacta.mfa_challenges (user_id, expires_at)
    WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_active_idx
    ON impacta.mfa_recovery_codes (user_id, created_at)
    WHERE used_at IS NULL;

ALTER TABLE impacta.auth_sessions
    ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

-- Admin permissions require MFA immediately, including sessions created before
-- this migration. Those sessions are revoked so the next login starts enrollment.
UPDATE impacta.users AS account
SET mfa_required = true
WHERE EXISTS (
    SELECT 1
    FROM impacta.user_roles AS assignment
    JOIN impacta.role_permissions AS role_permission ON role_permission.role_id = assignment.role_id
    JOIN impacta.permissions AS permission ON permission.id = role_permission.permission_id
    WHERE assignment.user_id = account.id
      AND (
          (assignment.scope_type = 'platform' AND assignment.scope_id IS NULL
           AND permission.code IN ('admin.dashboard.read', 'reports.manage', 'content.moderate',
                                   'communities.manage', 'projects.review'))
          OR (assignment.scope_type = 'community' AND permission.code = 'projects.review')
      )
);

UPDATE impacta.auth_sessions AS auth_session
SET revoked_at = now()
WHERE auth_session.revoked_at IS NULL
  AND auth_session.user_id IN (SELECT id FROM impacta.users WHERE mfa_required);

GRANT SELECT, INSERT, UPDATE, DELETE ON impacta.mfa_credentials TO impacta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON impacta.mfa_recovery_codes TO impacta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON impacta.mfa_challenges TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.mfa_recovery_codes_id_seq TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.mfa_challenges_id_seq TO impacta_app;
GRANT UPDATE (mfa_required) ON impacta.users TO impacta_app;
GRANT SELECT (mfa_verified_at) ON impacta.auth_sessions TO impacta_app;
GRANT INSERT (mfa_verified_at) ON impacta.auth_sessions TO impacta_app;

COMMIT;

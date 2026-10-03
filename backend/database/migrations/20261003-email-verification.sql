-- Least-privilege permissions for registration, email verification and login.
-- Run as the database owner in pgAdmin against the database named "Impacta".

BEGIN;

GRANT SELECT (id, email, password_hash, display_name, status, email_verified_at, mfa_required)
    ON impacta.users TO impacta_app;
GRANT INSERT (email, password_hash, display_name, status)
    ON impacta.users TO impacta_app;
GRANT UPDATE (display_name, password_hash, status, email_verified_at)
    ON impacta.users TO impacta_app;

GRANT SELECT (id, user_id, token_hash, purpose, created_at, expires_at, consumed_at)
    ON impacta.auth_tokens TO impacta_app;
GRANT INSERT (user_id, token_hash, purpose, expires_at)
    ON impacta.auth_tokens TO impacta_app;
GRANT UPDATE (consumed_at)
    ON impacta.auth_tokens TO impacta_app;

GRANT SELECT (user_id, event_type, occurred_at, ip_address)
    ON impacta.auth_events TO impacta_app;
GRANT INSERT (user_id, event_type, ip_address)
    ON impacta.auth_events TO impacta_app;

GRANT SELECT (id, code)
    ON impacta.roles TO impacta_app;
GRANT INSERT (user_id, role_id)
    ON impacta.user_roles TO impacta_app;
GRANT INSERT (user_id)
    ON impacta.user_profiles TO impacta_app;

GRANT INSERT (user_id, token_hash, csrf_token_hash, idle_expires_at,
              absolute_expires_at, ip_address, user_agent)
    ON impacta.auth_sessions TO impacta_app;
GRANT SELECT (token_hash, revoked_at)
    ON impacta.auth_sessions TO impacta_app;
GRANT UPDATE (revoked_at)
    ON impacta.auth_sessions TO impacta_app;

COMMIT;

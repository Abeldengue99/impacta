-- Least-privilege access for showing the authenticated account in the feed.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

GRANT SELECT (user_id, token_hash, revoked_at, idle_expires_at, absolute_expires_at)
    ON impacta.auth_sessions TO impacta_app;

COMMIT;

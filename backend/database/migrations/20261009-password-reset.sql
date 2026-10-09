-- Least-privilege access needed to revoke sessions after a password reset.
-- Run as the database owner in pgAdmin against the database "Impacta".

BEGIN;

GRANT SELECT (user_id) ON impacta.auth_sessions TO impacta_app;

COMMIT;

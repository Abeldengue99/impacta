-- Least-privilege access required by the API readiness check.
-- Run as the database owner in pgAdmin against the database "Impacta".

BEGIN;

GRANT SELECT (user_id) ON impacta.user_profiles TO impacta_app;

COMMIT;

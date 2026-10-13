-- Ensure the application role can create and inspect project participation rows.
-- Run once as the database owner in pgAdmin against the local "Impacta" database.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migration blocked: run only against the local Impacta database';
    END IF;
END;
$guard$;

GRANT SELECT (project_id, user_id, membership_role)
    ON impacta.project_members TO impacta_app;
GRANT INSERT (project_id, user_id, membership_role)
    ON impacta.project_members TO impacta_app;

COMMIT;

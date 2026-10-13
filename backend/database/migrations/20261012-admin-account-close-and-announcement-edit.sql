-- Admin account closure and announcement editing permissions.
-- Run as the database owner in pgAdmin against the local Impacta database.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migration blocked: run only in the local Impacta database';
    END IF;
END;
$guard$;

GRANT UPDATE (status, email, password_hash, closed_at, display_name, updated_at)
    ON impacta.users TO impacta_app;
GRANT DELETE ON impacta.user_profiles TO impacta_app;
GRANT UPDATE (title, body, placement, image_media_id, target_url,
              advertiser_name, advertiser_email, status, publish_at, expires_at, updated_at)
    ON impacta.announcements TO impacta_app;

COMMIT;
-- Add one optimized cover image reference to each profile.
-- Run once as the database owner in pgAdmin against the local "Impacta" database.

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

ALTER TABLE impacta.user_profiles
    ADD COLUMN IF NOT EXISTS cover_media_id bigint REFERENCES impacta.media(id) ON DELETE SET NULL;

GRANT SELECT (cover_media_id) ON impacta.user_profiles TO impacta_app;
GRANT UPDATE (cover_media_id) ON impacta.user_profiles TO impacta_app;

COMMIT;

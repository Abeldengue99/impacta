-- Add image and destination support to platform announcements and public promotions.
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

ALTER TABLE impacta.announcements
    ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'announcement',
    ADD COLUMN IF NOT EXISTS image_media_id bigint REFERENCES impacta.media(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS target_url text;

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'impacta.announcements'::regclass
          AND conname = 'announcements_placement_check'
    ) THEN
        ALTER TABLE impacta.announcements
            ADD CONSTRAINT announcements_placement_check
            CHECK (placement IN ('notice', 'announcement', 'advertisement'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'impacta.announcements'::regclass
          AND conname = 'announcements_target_url_check'
    ) THEN
        ALTER TABLE impacta.announcements
            ADD CONSTRAINT announcements_target_url_check
            CHECK (target_url IS NULL OR target_url ~* '^https?://[^[:space:]]+$');
    END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS announcements_public_schedule_idx
    ON impacta.announcements (status, publish_at, expires_at, created_at DESC);
CREATE INDEX IF NOT EXISTS announcements_image_media_idx
    ON impacta.announcements (image_media_id)
    WHERE image_media_id IS NOT NULL;

GRANT SELECT (id, author_user_id, title, body, placement, image_media_id, target_url,
              status, audience, publish_at, expires_at, created_at, updated_at)
    ON impacta.announcements TO impacta_app;
GRANT INSERT (author_user_id, title, body, placement, image_media_id, target_url,
              status, audience, publish_at, expires_at)
    ON impacta.announcements TO impacta_app;
GRANT UPDATE (status, publish_at, updated_at) ON impacta.announcements TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.announcements_id_seq TO impacta_app;

GRANT SELECT (id, owner_user_id, storage_key, media_type, mime_type, byte_size,
              checksum_sha256, status)
    ON impacta.media TO impacta_app;
GRANT INSERT (owner_user_id, storage_key, media_type, mime_type, byte_size,
              checksum_sha256, status)
    ON impacta.media TO impacta_app;
GRANT UPDATE (status) ON impacta.media TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.media_id_seq TO impacta_app;

GRANT SELECT (key, value) ON impacta.platform_settings TO impacta_app;
GRANT INSERT (key, value, description, updated_by_user_id) ON impacta.platform_settings TO impacta_app;
GRANT UPDATE (value, description, updated_by_user_id, updated_at) ON impacta.platform_settings TO impacta_app;

COMMIT;

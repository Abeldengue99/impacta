-- Compressed, private photo and video attachments for accepted direct conversations.
-- Apply after 20261013-direct-messaging.sql as the database owner.

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

ALTER TABLE impacta.direct_messages
    ADD COLUMN IF NOT EXISTS media_id bigint REFERENCES impacta.media(id) ON DELETE RESTRICT;

ALTER TABLE impacta.direct_messages
    ALTER COLUMN body DROP NOT NULL;

ALTER TABLE impacta.direct_messages
    DROP CONSTRAINT IF EXISTS direct_messages_body_check,
    DROP CONSTRAINT IF EXISTS direct_messages_content_check;

ALTER TABLE impacta.direct_messages
    ADD CONSTRAINT direct_messages_body_check
        CHECK (body IS NULL OR (length(btrim(body)) > 0 AND char_length(body) <= 1200)),
    ADD CONSTRAINT direct_messages_content_check
        CHECK (body IS NOT NULL OR media_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS direct_messages_media_unique_idx
    ON impacta.direct_messages (media_id)
    WHERE media_id IS NOT NULL;

GRANT SELECT (media_id) ON impacta.direct_messages TO impacta_app;
GRANT INSERT (media_id) ON impacta.direct_messages TO impacta_app;

GRANT SELECT (id, owner_user_id, storage_key, media_type, mime_type, byte_size, status)
    ON impacta.media TO impacta_app;
GRANT INSERT (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
    ON impacta.media TO impacta_app;

COMMIT;

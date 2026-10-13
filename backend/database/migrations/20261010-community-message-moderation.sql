-- Support author edits and owner/moderator removals in community conversations.
-- Apply as the database owner against the local "Impacta" database.

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

ALTER TABLE impacta.community_messages
    ADD COLUMN IF NOT EXISTS edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS edited_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS community_messages_edit_activity_idx
    ON impacta.community_messages (edited_by_user_id, edited_at DESC)
    WHERE edited_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_messages_delete_activity_idx
    ON impacta.community_messages (deleted_by_user_id, deleted_at DESC)
    WHERE deleted_by_user_id IS NOT NULL;

GRANT SELECT (edited_at, edited_by_user_id, deleted_by_user_id)
    ON impacta.community_messages TO impacta_app;
GRANT UPDATE (body, edited_at, edited_by_user_id, deleted_at, deleted_by_user_id)
    ON impacta.community_messages TO impacta_app;

COMMIT;

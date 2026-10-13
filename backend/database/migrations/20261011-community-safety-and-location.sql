-- Add optional community-area discovery and an auditable community moderation queue.
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

ALTER TABLE impacta.communities
    ADD COLUMN IF NOT EXISTS location_province text,
    ADD COLUMN IF NOT EXISTS location_municipality text,
    ADD COLUMN IF NOT EXISTS location_commune text,
    ADD COLUMN IF NOT EXISTS location_neighborhood text,
    ADD COLUMN IF NOT EXISTS location_city text;

ALTER TABLE impacta.community_messages
    ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';

-- Put existing group attachments back through review during rollout as well.
-- Otherwise content uploaded before this feature would bypass the new safeguards.
UPDATE impacta.media AS media
SET status = CASE WHEN EXISTS (
        SELECT 1 FROM impacta.community_messages AS message
        WHERE message.media_id = media.id AND message.deleted_at IS NOT NULL
    ) THEN 'quarantined' ELSE 'pending_scan' END
WHERE media.storage_key LIKE 'community-chat/%' AND media.status = 'available';

UPDATE impacta.community_messages AS message SET moderation_status = 'pending_review'
WHERE message.deleted_at IS NULL AND message.media_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM impacta.media AS media
              WHERE media.id = message.media_id AND media.storage_key LIKE 'community-chat/%'
                AND media.status = 'pending_scan');

DO $moderation_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'impacta.community_messages'::regclass
          AND conname = 'community_messages_moderation_status_check'
    ) THEN
        ALTER TABLE impacta.community_messages
            ADD CONSTRAINT community_messages_moderation_status_check
            CHECK (moderation_status IN ('approved', 'pending_review', 'removed'));
    END IF;
END;
$moderation_check$;

CREATE TABLE IF NOT EXISTS impacta.community_reports (
    id bigserial PRIMARY KEY,
    reporter_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    community_id bigint NOT NULL REFERENCES impacta.communities(id) ON DELETE CASCADE,
    message_id bigint REFERENCES impacta.community_messages(id) ON DELETE RESTRICT,
    reason_code text NOT NULL CHECK (reason_code IN (
        'adult_sexual_content', 'sexual_exploitation', 'harassment', 'hate',
        'threats_violence', 'spam_scam', 'illegal_activity', 'privacy', 'other'
    )),
    details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    assigned_to_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    reviewed_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CHECK (length(trim(reason_code)) > 0),
    CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 1000)
);

CREATE INDEX IF NOT EXISTS community_reports_queue_idx
    ON impacta.community_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS community_reports_target_idx
    ON impacta.community_reports (community_id, message_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_open_message_reporter_idx
    ON impacta.community_reports (reporter_user_id, message_id)
    WHERE reporter_user_id IS NOT NULL AND message_id IS NOT NULL AND status IN ('open', 'reviewing');
CREATE UNIQUE INDEX IF NOT EXISTS community_reports_open_group_reporter_idx
    ON impacta.community_reports (reporter_user_id, community_id)
    WHERE reporter_user_id IS NOT NULL AND message_id IS NULL AND status IN ('open', 'reviewing');

GRANT SELECT (id, location_province, location_municipality, location_commune,
              location_neighborhood, location_city)
    ON impacta.communities TO impacta_app;
GRANT INSERT (location_province, location_municipality, location_commune,
              location_neighborhood, location_city)
    ON impacta.communities TO impacta_app;
GRANT SELECT (moderation_status) ON impacta.community_messages TO impacta_app;
GRANT INSERT (moderation_status) ON impacta.community_messages TO impacta_app;
GRANT UPDATE (moderation_status) ON impacta.community_messages TO impacta_app;

GRANT SELECT (id, reporter_user_id, community_id, message_id, reason_code, details,
              status, assigned_to_user_id, reviewed_by_user_id, decision_reason,
              created_at, resolved_at)
    ON impacta.community_reports TO impacta_app;
GRANT INSERT (reporter_user_id, community_id, message_id, reason_code, details)
    ON impacta.community_reports TO impacta_app;
GRANT UPDATE (status, assigned_to_user_id, reviewed_by_user_id, decision_reason, resolved_at)
    ON impacta.community_reports TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.community_reports_id_seq TO impacta_app;

COMMIT;

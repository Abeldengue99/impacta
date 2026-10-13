-- Per-community unread message cursors and project activity notifications.
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

CREATE TABLE IF NOT EXISTS impacta.community_message_reads (
    community_id bigint NOT NULL REFERENCES impacta.communities(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    last_read_message_id bigint NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

-- Existing active members have already had access to the current conversation history.
INSERT INTO impacta.community_message_reads (community_id, user_id, last_read_message_id)
SELECT member.community_id, member.user_id, COALESCE(max(message.id), 0)
FROM impacta.community_members AS member
LEFT JOIN impacta.community_messages AS message
  ON message.community_id = member.community_id
 AND message.deleted_at IS NULL AND message.moderation_status = 'approved'
WHERE member.status = 'active'
GROUP BY member.community_id, member.user_id
ON CONFLICT (community_id, user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS notifications_project_activity_unread_idx
    ON impacta.notifications (user_id, (payload->>'project_id'), created_at DESC)
    WHERE read_at IS NULL
      AND notification_type IN ('project_member_joined', 'project_challenge_created', 'project_challenge_submission');

GRANT SELECT (community_id, user_id, last_read_message_id, updated_at),
      INSERT (community_id, user_id, last_read_message_id, updated_at),
      UPDATE (last_read_message_id, updated_at)
    ON impacta.community_message_reads TO impacta_app;

COMMIT;

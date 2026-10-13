-- Complete the challenge lifecycle: private evidence, delivery review and completion.
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

ALTER TABLE impacta.challenge_participations
    ADD COLUMN IF NOT EXISTS delivery_submission text,
    ADD COLUMN IF NOT EXISTS delivery_submitted_at timestamptz,
    ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE impacta.challenge_participations
    DROP CONSTRAINT IF EXISTS challenge_participations_status_check;

ALTER TABLE impacta.challenge_participations
    ADD CONSTRAINT challenge_participations_status_check
    CHECK (status IN ('submitted', 'approved', 'delivery_submitted', 'changes_requested',
                      'completed', 'rejected', 'withdrawn'));

ALTER TABLE impacta.challenge_participations
    DROP CONSTRAINT IF EXISTS challenge_participations_delivery_check,
    DROP CONSTRAINT IF EXISTS challenge_participations_completed_at_check,
    ADD CONSTRAINT challenge_participations_delivery_check
        CHECK (delivery_submission IS NULL OR
               (length(btrim(delivery_submission)) > 0 AND char_length(delivery_submission) <= 3000)),
    ADD CONSTRAINT challenge_participations_completed_at_check
        CHECK ((status = 'completed' AND completed_at IS NOT NULL)
               OR (status <> 'completed' AND completed_at IS NULL));

ALTER TABLE impacta.challenge_participations
    DROP CONSTRAINT IF EXISTS challenge_participations_delivery_state_check;
ALTER TABLE impacta.challenge_participations
    ADD CONSTRAINT challenge_participations_delivery_state_check
    CHECK (status NOT IN ('delivery_submitted', 'changes_requested', 'completed')
           OR (delivery_submission IS NOT NULL AND delivery_submitted_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS impacta.challenge_participation_media (
    participation_id bigint NOT NULL REFERENCES impacta.challenge_participations(id) ON DELETE CASCADE,
    media_id bigint NOT NULL UNIQUE REFERENCES impacta.media(id) ON DELETE RESTRICT,
    stage text NOT NULL CHECK (stage IN ('proposal', 'delivery')),
    uploader_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (participation_id, media_id)
);

CREATE INDEX IF NOT EXISTS challenge_participation_media_stage_idx
    ON impacta.challenge_participation_media (participation_id, stage, created_at);

CREATE TABLE IF NOT EXISTS impacta.challenge_weekly_highlights (
    week_start date PRIMARY KEY,
    challenge_id bigint NOT NULL REFERENCES impacta.challenges(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS impacta.notifications_project_activity_unread_idx;
CREATE INDEX notifications_project_activity_unread_idx
    ON impacta.notifications (user_id, (payload->>'project_id'), created_at DESC)
    WHERE read_at IS NULL
      AND notification_type IN (
          'project_member_joined', 'project_challenge_created', 'project_challenge_submission',
          'project_challenge_participation_reviewed', 'project_challenge_delivery'
      );

GRANT SELECT (id, challenge_id, user_id, submission, status, submitted_at,
              reviewed_by_user_id, reviewed_at, review_reason,
              delivery_submission, delivery_submitted_at, completed_at)
    ON impacta.challenge_participations TO impacta_app;
GRANT UPDATE (submission, status, submitted_at, reviewed_by_user_id, reviewed_at,
              review_reason, delivery_submission, delivery_submitted_at, completed_at)
    ON impacta.challenge_participations TO impacta_app;

GRANT SELECT (participation_id, media_id, stage, uploader_user_id, created_at),
      INSERT (participation_id, media_id, stage, uploader_user_id)
    ON impacta.challenge_participation_media TO impacta_app;
GRANT SELECT (week_start, challenge_id, assigned_at),
      INSERT (week_start, challenge_id),
      UPDATE (challenge_id, assigned_at)
    ON impacta.challenge_weekly_highlights TO impacta_app;
GRANT SELECT (id, owner_user_id, storage_key, media_type, mime_type, byte_size, status),
      INSERT (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
    ON impacta.media TO impacta_app;

COMMIT;

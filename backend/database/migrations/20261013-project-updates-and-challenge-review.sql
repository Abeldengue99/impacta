-- Link public feed posts to a project and let authorised project teams review
-- challenge participation. Apply as the database owner to the local Impacta DB.

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

ALTER TABLE impacta.posts
    ADD COLUMN IF NOT EXISTS project_id bigint REFERENCES impacta.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_project_time_idx
    ON impacta.posts (project_id, created_at DESC)
    WHERE project_id IS NOT NULL AND status = 'published' AND deleted_at IS NULL;

GRANT SELECT (project_id), INSERT (project_id)
    ON impacta.posts TO impacta_app;

GRANT SELECT (id, challenge_id, user_id, submission, status, submitted_at,
              reviewed_by_user_id, reviewed_at, review_reason)
    ON impacta.challenge_participations TO impacta_app;
GRANT UPDATE (submission, status, submitted_at, reviewed_by_user_id, reviewed_at, review_reason)
    ON impacta.challenge_participations TO impacta_app;

DROP INDEX IF EXISTS impacta.notifications_project_activity_unread_idx;
CREATE INDEX notifications_project_activity_unread_idx
    ON impacta.notifications (user_id, (payload->>'project_id'), created_at DESC)
    WHERE read_at IS NULL
      AND notification_type IN (
          'project_member_joined', 'project_challenge_created', 'project_challenge_submission',
          'project_challenge_participation_reviewed'
      );

COMMIT;

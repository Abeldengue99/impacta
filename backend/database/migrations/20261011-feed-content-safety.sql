-- Text screening, reported-comment moderation and selective review for flagged feed posts.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' OR to_regnamespace('impacta') IS NULL THEN
        RAISE EXCEPTION 'Migration blocked: run against the Impacta database';
    END IF;
END;
$guard$;

ALTER TABLE impacta.posts
    ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved';

DO $moderation_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'impacta.posts'::regclass
          AND conname = 'posts_moderation_status_check'
    ) THEN
        ALTER TABLE impacta.posts
            ADD CONSTRAINT posts_moderation_status_check
            CHECK (moderation_status IN ('approved', 'pending_review', 'removed'));
    END IF;
END;
$moderation_check$;

CREATE INDEX IF NOT EXISTS posts_moderation_review_idx
    ON impacta.posts (created_at, id)
    WHERE moderation_status = 'pending_review' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS content_reports_comment_status_idx
    ON impacta.content_reports (comment_id, status, created_at DESC)
    WHERE comment_id IS NOT NULL;

GRANT SELECT (moderation_status) ON impacta.posts TO impacta_app;
GRANT INSERT (moderation_status) ON impacta.posts TO impacta_app;
GRANT UPDATE (moderation_status) ON impacta.posts TO impacta_app;
GRANT UPDATE (status) ON impacta.media TO impacta_app;
GRANT SELECT (id, post_id, author_user_id, body, status, created_at, updated_at, deleted_at)
    ON impacta.comments TO impacta_app;
GRANT UPDATE (status, deleted_at, updated_at) ON impacta.comments TO impacta_app;
GRANT INSERT (reporter_user_id, comment_id, reason_code, details)
    ON impacta.content_reports TO impacta_app;
GRANT SELECT (id, reporter_user_id, post_id, comment_id, reason_code, details, status, created_at)
    ON impacta.content_reports TO impacta_app;
GRANT UPDATE (status, resolved_at, assigned_to_user_id) ON impacta.content_reports TO impacta_app;
GRANT INSERT (actor_user_id, comment_id, action_type, reason)
    ON impacta.moderation_actions TO impacta_app;
GRANT INSERT (actor_user_id, post_id, action_type, reason)
    ON impacta.moderation_actions TO impacta_app;

COMMIT;

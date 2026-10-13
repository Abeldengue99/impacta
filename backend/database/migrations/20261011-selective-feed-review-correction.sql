-- Run after 20261011-feed-content-safety.sql only if its earlier version
-- (which queued every existing post with media) was already applied.
-- Restores those legacy posts; do this before deploying the selective-review backend.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' OR to_regnamespace('impacta') IS NULL THEN
        RAISE EXCEPTION 'Migration blocked: run against the Impacta database';
    END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS impacta.impacta_migration_markers (
    migration_key text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

DO $correction$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM impacta.impacta_migration_markers
        WHERE migration_key = '20261011-selective-feed-review-correction'
    ) THEN
        UPDATE impacta.posts AS post
        SET moderation_status = 'approved'
        WHERE post.moderation_status = 'pending_review'
          AND post.status = 'published'
          AND post.deleted_at IS NULL
          AND EXISTS (
              SELECT 1 FROM impacta.post_media AS relation
              WHERE relation.post_id = post.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM impacta.moderation_actions AS action
              WHERE action.post_id = post.id
                AND action.action_type IN ('restore_content', 'remove_content')
          );

        INSERT INTO impacta.impacta_migration_markers (migration_key)
        VALUES ('20261011-selective-feed-review-correction');
    END IF;
END;
$correction$;

COMMIT;

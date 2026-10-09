-- Minimum database privileges for signed-in community features.
-- Run once as the database owner in pgAdmin against "Impacta".
-- The application role remains a non-owner with no schema-wide write access.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' OR to_regnamespace('impacta') IS NULL THEN
        RAISE EXCEPTION 'Migração bloqueada: executa na base Impacta que contém o esquema impacta';
    END IF;
END;
$guard$;

CREATE INDEX IF NOT EXISTS reactions_post_id_idx ON impacta.reactions (post_id);
CREATE INDEX IF NOT EXISTS challenge_participations_user_time_idx
    ON impacta.challenge_participations (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS community_members_community_status_idx
    ON impacta.community_members (community_id, status);

GRANT SELECT (csrf_token_hash) ON impacta.auth_sessions TO impacta_app;
GRANT UPDATE (last_seen_at, idle_expires_at) ON impacta.auth_sessions TO impacta_app;

GRANT SELECT (slug, description, impact_area_id) ON impacta.communities TO impacta_app;
GRANT SELECT (community_id, user_id, status) ON impacta.community_members TO impacta_app;
GRANT INSERT (community_id, user_id, status) ON impacta.community_members TO impacta_app;

GRANT INSERT (author_user_id, body) ON impacta.posts TO impacta_app;
GRANT UPDATE (status, deleted_at) ON impacta.posts TO impacta_app;

GRANT SELECT (id, body, created_at, author_user_id, post_id, status, deleted_at)
    ON impacta.comments TO impacta_app;
GRANT INSERT (post_id, author_user_id, body) ON impacta.comments TO impacta_app;

GRANT INSERT (user_id, post_id, reaction_type) ON impacta.reactions TO impacta_app;
GRANT DELETE ON impacta.reactions TO impacta_app;

GRANT SELECT (user_id, submitted_at) ON impacta.challenge_participations TO impacta_app;
GRANT INSERT (challenge_id, user_id, submission) ON impacta.challenge_participations TO impacta_app;

GRANT SELECT (user_id) ON impacta.project_members TO impacta_app;
GRANT INSERT (project_id, user_id) ON impacta.project_members TO impacta_app;

GRANT INSERT (reporter_user_id, post_id, reason_code, details)
    ON impacta.content_reports TO impacta_app;
GRANT SELECT (reporter_user_id, created_at) ON impacta.content_reports TO impacta_app;

GRANT USAGE, SELECT ON SEQUENCE
    impacta.posts_id_seq,
    impacta.comments_id_seq,
    impacta.challenge_participations_id_seq,
    impacta.content_reports_id_seq
    TO impacta_app;

COMMIT;

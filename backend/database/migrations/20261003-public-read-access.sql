-- Read-only grants for the IMPACTA public feed API.
-- Run in pgAdmin while connected to the exact database named "Impacta".
-- Create impacta_app as a LOGIN role first. Do not give it superuser rights.

BEGIN;

GRANT CONNECT ON DATABASE "Impacta" TO impacta_app;
GRANT USAGE ON SCHEMA impacta TO impacta_app;

GRANT SELECT (id, body, created_at, author_user_id, community_id, status, deleted_at)
    ON impacta.posts TO impacta_app;
GRANT SELECT (id, display_name, status)
    ON impacta.users TO impacta_app;
GRANT SELECT (id, name, status, visibility)
    ON impacta.communities TO impacta_app;
GRANT SELECT (user_id, post_id)
    ON impacta.reactions TO impacta_app;
GRANT SELECT (id, post_id, status, deleted_at)
    ON impacta.comments TO impacta_app;
GRANT SELECT (id, title, description, opens_at, closes_at, project_id, status)
    ON impacta.challenges TO impacta_app;
GRANT SELECT (id, community_id, impact_area_id, status, starts_at, ends_at,
              title, description, created_at)
    ON impacta.projects TO impacta_app;
GRANT SELECT (id, name)
    ON impacta.impact_areas TO impacta_app;
GRANT SELECT (id, challenge_id, status)
    ON impacta.challenge_participations TO impacta_app;
GRANT SELECT (project_id)
    ON impacta.project_members TO impacta_app;

COMMIT;

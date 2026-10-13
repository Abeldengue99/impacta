-- Member-only community conversations and permission for administrators to review project activity.
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

CREATE TABLE IF NOT EXISTS impacta.community_messages (
    id bigserial PRIMARY KEY,
    community_id bigint NOT NULL REFERENCES impacta.communities(id) ON DELETE CASCADE,
    author_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE RESTRICT,
    body text,
    media_id bigint REFERENCES impacta.media(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT community_messages_body_length_check
        CHECK (body IS NULL OR (length(btrim(body)) > 0 AND char_length(body) <= 2000)),
    CONSTRAINT community_messages_content_required_check
        CHECK (body IS NOT NULL OR media_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS community_messages_timeline_idx
    ON impacta.community_messages (community_id, id DESC)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS community_messages_media_unique_idx
    ON impacta.community_messages (media_id)
    WHERE media_id IS NOT NULL;

GRANT SELECT (id, community_id, author_user_id, body, media_id, created_at, deleted_at)
    ON impacta.community_messages TO impacta_app;
GRANT INSERT (community_id, author_user_id, body, media_id)
    ON impacta.community_messages TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.community_messages_id_seq TO impacta_app;

-- Group media is kept private and is only served through an endpoint that checks membership.
GRANT SELECT (id, storage_key, media_type, mime_type, status, owner_user_id, byte_size, created_at)
    ON impacta.media TO impacta_app;
GRANT INSERT (owner_user_id, storage_key, media_type, mime_type, byte_size, checksum_sha256, status)
    ON impacta.media TO impacta_app;
GRANT UPDATE (status) ON impacta.media TO impacta_app;

-- Platform reviewers can see submitted project participation details in the admin console.
GRANT SELECT (id, challenge_id, user_id, submission, submitted_at)
    ON impacta.challenge_participations TO impacta_app;
GRANT SELECT (project_id, user_id)
    ON impacta.project_members TO impacta_app;

COMMIT;

-- User mentions in posts/comments and branded profile connection requests.
-- Run once as the database owner in pgAdmin against the local database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migração bloqueada: executa apenas na base local Impacta com o esquema impacta';
    END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS impacta.content_mentions (
    actor_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    mentioned_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    post_id bigint REFERENCES impacta.posts(id) ON DELETE CASCADE,
    comment_id bigint REFERENCES impacta.comments(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_mentions_not_self CHECK (actor_user_id <> mentioned_user_id),
    CONSTRAINT content_mentions_one_target CHECK (num_nonnulls(post_id, comment_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_mentions_post_user_idx
    ON impacta.content_mentions (post_id, mentioned_user_id)
    WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_mentions_comment_user_idx
    ON impacta.content_mentions (comment_id, mentioned_user_id)
    WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_mentions_user_created_idx
    ON impacta.content_mentions (mentioned_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS impacta.impactation_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requester_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    recipient_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    CONSTRAINT impactation_requests_distinct_users CHECK (requester_user_id <> recipient_user_id),
    CONSTRAINT impactation_requests_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

-- Only one pending or accepted relationship can exist for a pair, regardless of direction.
CREATE UNIQUE INDEX IF NOT EXISTS impactation_requests_active_pair_idx
    ON impacta.impactation_requests (
        LEAST(requester_user_id, recipient_user_id),
        GREATEST(requester_user_id, recipient_user_id)
    )
    WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS impactation_requests_recipient_status_idx
    ON impacta.impactation_requests (recipient_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS impactation_requests_requester_status_idx
    ON impacta.impactation_requests (requester_user_id, status, created_at DESC);

GRANT SELECT (id, display_name, status) ON impacta.users TO impacta_app;
GRANT SELECT (user_id, is_public, headline) ON impacta.user_profiles TO impacta_app;

GRANT SELECT (actor_user_id, mentioned_user_id, post_id, comment_id, created_at)
    ON impacta.content_mentions TO impacta_app;
GRANT INSERT (actor_user_id, mentioned_user_id, post_id, comment_id)
    ON impacta.content_mentions TO impacta_app;
GRANT DELETE ON impacta.content_mentions TO impacta_app;

GRANT SELECT (id, requester_user_id, recipient_user_id, status, created_at, responded_at)
    ON impacta.impactation_requests TO impacta_app;
GRANT INSERT (requester_user_id, recipient_user_id, status)
    ON impacta.impactation_requests TO impacta_app;
GRANT UPDATE (status, responded_at) ON impacta.impactation_requests TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.impactation_requests_id_seq TO impacta_app;

COMMIT;

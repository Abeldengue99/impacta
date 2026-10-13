-- Private one-to-one messages with consent-based first-contact requests.
-- Apply after 20261013-project-group-messaging.sql as the database owner.

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

CREATE TABLE IF NOT EXISTS impacta.direct_message_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requester_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    recipient_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    CONSTRAINT direct_message_requests_distinct_users CHECK (requester_user_id <> recipient_user_id),
    CONSTRAINT direct_message_requests_body_check CHECK (length(btrim(body)) > 0 AND char_length(body) <= 500),
    CONSTRAINT direct_message_requests_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS direct_message_requests_pending_pair_idx
    ON impacta.direct_message_requests (
        LEAST(requester_user_id, recipient_user_id), GREATEST(requester_user_id, recipient_user_id)
    ) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS direct_message_requests_recipient_recent_idx
    ON impacta.direct_message_requests (recipient_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_message_requests_requester_recent_idx
    ON impacta.direct_message_requests (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_message_requests_pair_history_idx
    ON impacta.direct_message_requests (
        LEAST(requester_user_id, recipient_user_id), GREATEST(requester_user_id, recipient_user_id), created_at DESC
    );

CREATE TABLE IF NOT EXISTS impacta.direct_conversations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_a_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    user_b_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT direct_conversations_ordered_pair_check CHECK (user_a_id < user_b_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS direct_conversations_pair_idx
    ON impacta.direct_conversations (user_a_id, user_b_id);

CREATE TABLE IF NOT EXISTS impacta.direct_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id bigint NOT NULL REFERENCES impacta.direct_conversations(id) ON DELETE CASCADE,
    author_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE RESTRICT,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    deleted_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    CONSTRAINT direct_messages_body_check CHECK (length(btrim(body)) > 0 AND char_length(body) <= 1200),
    CONSTRAINT direct_messages_delete_pair_check CHECK (deleted_at IS NOT NULL OR deleted_by_user_id IS NULL)
);
CREATE INDEX IF NOT EXISTS direct_messages_timeline_idx
    ON impacta.direct_messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS direct_messages_author_recent_idx
    ON impacta.direct_messages (author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS impacta.direct_conversation_members (
    conversation_id bigint NOT NULL REFERENCES impacta.direct_conversations(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    last_read_message_id bigint NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
    archived_at timestamptz,
    muted boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS direct_conversation_members_user_idx
    ON impacta.direct_conversation_members (user_id, archived_at, conversation_id);

CREATE TABLE IF NOT EXISTS impacta.direct_message_blocks (
    blocker_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    blocked_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CONSTRAINT direct_message_blocks_distinct_users CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX IF NOT EXISTS direct_message_blocks_blocked_user_idx
    ON impacta.direct_message_blocks (blocked_user_id, blocker_user_id);

CREATE TABLE IF NOT EXISTS impacta.direct_message_preferences (
    user_id bigint PRIMARY KEY REFERENCES impacta.users(id) ON DELETE CASCADE,
    request_policy text NOT NULL DEFAULT 'requests',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT direct_message_preferences_policy_check
        CHECK (request_policy IN ('requests', 'impactas', 'none'))
);

ALTER TABLE impacta.content_reports
    ADD COLUMN IF NOT EXISTS direct_message_id bigint
        REFERENCES impacta.direct_messages(id) ON DELETE RESTRICT;
ALTER TABLE impacta.content_reports
    ADD COLUMN IF NOT EXISTS direct_message_request_id bigint
        REFERENCES impacta.direct_message_requests(id) ON DELETE RESTRICT;

DO $report_target_constraint$
DECLARE
    target_check record;
BEGIN
    FOR target_check IN
        SELECT conname
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'impacta.content_reports'::regclass
          AND contype = 'c'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%num_nonnulls%'
    LOOP
        EXECUTE format('ALTER TABLE impacta.content_reports DROP CONSTRAINT %I', target_check.conname);
    END LOOP;
END;
$report_target_constraint$;

ALTER TABLE impacta.content_reports
    ADD CONSTRAINT content_reports_one_target_check
    CHECK (num_nonnulls(post_id, comment_id, user_id, project_message_id,
                        direct_message_id, direct_message_request_id) = 1);

CREATE INDEX IF NOT EXISTS direct_message_reports_queue_idx
    ON impacta.content_reports (status, created_at DESC)
    WHERE direct_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS direct_message_reports_open_reporter_idx
    ON impacta.content_reports (reporter_user_id, direct_message_id)
    WHERE reporter_user_id IS NOT NULL AND direct_message_id IS NOT NULL
      AND status IN ('open', 'reviewing');
CREATE INDEX IF NOT EXISTS direct_message_request_reports_queue_idx
    ON impacta.content_reports (status, created_at DESC)
    WHERE direct_message_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS direct_message_request_reports_open_reporter_idx
    ON impacta.content_reports (reporter_user_id, direct_message_request_id)
    WHERE reporter_user_id IS NOT NULL AND direct_message_request_id IS NOT NULL
      AND status IN ('open', 'reviewing');

GRANT SELECT (id, requester_user_id, recipient_user_id, body, status, created_at, responded_at)
    ON impacta.direct_message_requests TO impacta_app;
GRANT INSERT (requester_user_id, recipient_user_id, body)
    ON impacta.direct_message_requests TO impacta_app;
GRANT UPDATE (status, responded_at)
    ON impacta.direct_message_requests TO impacta_app;
GRANT UPDATE (body) ON impacta.direct_message_requests TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.direct_message_requests_id_seq TO impacta_app;

GRANT SELECT (id, user_a_id, user_b_id, created_at)
    ON impacta.direct_conversations TO impacta_app;
GRANT INSERT (user_a_id, user_b_id)
    ON impacta.direct_conversations TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.direct_conversations_id_seq TO impacta_app;

GRANT SELECT (id, conversation_id, author_user_id, body, created_at, edited_at, deleted_at, deleted_by_user_id)
    ON impacta.direct_messages TO impacta_app;
GRANT INSERT (conversation_id, author_user_id, body)
    ON impacta.direct_messages TO impacta_app;
GRANT UPDATE (body, edited_at, deleted_at, deleted_by_user_id)
    ON impacta.direct_messages TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.direct_messages_id_seq TO impacta_app;

GRANT SELECT (conversation_id, user_id, last_read_message_id, archived_at, muted, updated_at)
    ON impacta.direct_conversation_members TO impacta_app;
GRANT INSERT (conversation_id, user_id)
    ON impacta.direct_conversation_members TO impacta_app;
GRANT UPDATE (last_read_message_id, archived_at, muted, updated_at)
    ON impacta.direct_conversation_members TO impacta_app;

GRANT SELECT (blocker_user_id, blocked_user_id, created_at)
    ON impacta.direct_message_blocks TO impacta_app;
GRANT INSERT (blocker_user_id, blocked_user_id)
    ON impacta.direct_message_blocks TO impacta_app;
GRANT DELETE ON impacta.direct_message_blocks TO impacta_app;

GRANT SELECT (user_id, request_policy, updated_at)
    ON impacta.direct_message_preferences TO impacta_app;
GRANT INSERT (user_id, request_policy, updated_at)
    ON impacta.direct_message_preferences TO impacta_app;
GRANT UPDATE (request_policy, updated_at)
    ON impacta.direct_message_preferences TO impacta_app;

GRANT SELECT (direct_message_id) ON impacta.content_reports TO impacta_app;
GRANT INSERT (direct_message_id) ON impacta.content_reports TO impacta_app;
GRANT UPDATE (direct_message_id) ON impacta.content_reports TO impacta_app;
GRANT SELECT (direct_message_request_id) ON impacta.content_reports TO impacta_app;
GRANT INSERT (direct_message_request_id) ON impacta.content_reports TO impacta_app;
GRANT UPDATE (direct_message_request_id) ON impacta.content_reports TO impacta_app;

COMMIT;

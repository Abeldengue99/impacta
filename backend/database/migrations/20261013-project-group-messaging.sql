-- Private, project-scoped conversations for enrolled participants; no open direct messages.
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

CREATE TABLE IF NOT EXISTS impacta.project_messages (
    id bigserial PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES impacta.projects(id) ON DELETE CASCADE,
    author_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE RESTRICT,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    edited_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    deleted_at timestamptz,
    deleted_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    CONSTRAINT project_messages_body_length_check
        CHECK (length(btrim(body)) > 0 AND char_length(body) <= 1200),
    CONSTRAINT project_messages_edit_pair_check
        CHECK (edited_at IS NOT NULL OR edited_by_user_id IS NULL),
    CONSTRAINT project_messages_delete_pair_check
        CHECK (deleted_at IS NOT NULL OR deleted_by_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS project_messages_timeline_idx
    ON impacta.project_messages (project_id, id DESC);
CREATE INDEX IF NOT EXISTS project_messages_author_recent_idx
    ON impacta.project_messages (author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS impacta.project_message_reads (
    project_id bigint NOT NULL REFERENCES impacta.projects(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    last_read_message_id bigint NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS impacta.project_message_preferences (
    project_id bigint NOT NULL REFERENCES impacta.projects(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    muted boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

ALTER TABLE impacta.content_reports
    ADD COLUMN IF NOT EXISTS project_message_id bigint
        REFERENCES impacta.project_messages(id) ON DELETE RESTRICT;

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
    DROP CONSTRAINT IF EXISTS content_reports_one_target_check;

ALTER TABLE impacta.content_reports
    ADD CONSTRAINT content_reports_one_target_check
    CHECK (num_nonnulls(post_id, comment_id, user_id, project_message_id) = 1);

CREATE INDEX IF NOT EXISTS project_message_reports_queue_idx
    ON impacta.content_reports (status, created_at DESC)
    WHERE project_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_message_reports_open_reporter_idx
    ON impacta.content_reports (reporter_user_id, project_message_id)
    WHERE reporter_user_id IS NOT NULL AND project_message_id IS NOT NULL
      AND status IN ('open', 'reviewing');

GRANT SELECT (id, project_id, author_user_id, body, created_at, edited_at, edited_by_user_id,
              deleted_at, deleted_by_user_id)
    ON impacta.project_messages TO impacta_app;
GRANT INSERT (project_id, author_user_id, body)
    ON impacta.project_messages TO impacta_app;
GRANT UPDATE (body, edited_at, edited_by_user_id, deleted_at, deleted_by_user_id)
    ON impacta.project_messages TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.project_messages_id_seq TO impacta_app;

GRANT SELECT (project_id, user_id, last_read_message_id, updated_at)
    ON impacta.project_message_reads TO impacta_app;
GRANT INSERT (project_id, user_id, last_read_message_id, updated_at)
    ON impacta.project_message_reads TO impacta_app;
GRANT UPDATE (last_read_message_id, updated_at)
    ON impacta.project_message_reads TO impacta_app;

GRANT SELECT (project_id, user_id, muted, updated_at)
    ON impacta.project_message_preferences TO impacta_app;
GRANT INSERT (project_id, user_id, muted, updated_at)
    ON impacta.project_message_preferences TO impacta_app;
GRANT UPDATE (muted, updated_at)
    ON impacta.project_message_preferences TO impacta_app;

GRANT SELECT (project_message_id) ON impacta.content_reports TO impacta_app;
GRANT INSERT (project_message_id) ON impacta.content_reports TO impacta_app;
GRANT SELECT (project_id, user_id) ON impacta.project_members TO impacta_app;

COMMIT;

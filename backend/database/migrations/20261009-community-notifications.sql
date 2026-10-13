-- In-app notices for post reactions, comments and shares.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS impacta.notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON impacta.notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS impacta.post_shares (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id bigint NOT NULL REFERENCES impacta.posts(id) ON DELETE CASCADE,
    sharer_user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    shared_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, sharer_user_id)
);

CREATE INDEX IF NOT EXISTS post_shares_user_time_idx
    ON impacta.post_shares (sharer_user_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS post_shares_post_time_idx
    ON impacta.post_shares (post_id, shared_at DESC);

GRANT SELECT (id, user_id, notification_type, payload, created_at, read_at),
      INSERT (user_id, notification_type, payload),
      UPDATE (read_at)
    ON impacta.notifications TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.notifications_id_seq TO impacta_app;

GRANT SELECT (post_id, sharer_user_id, shared_at),
      INSERT (post_id, sharer_user_id)
    ON impacta.post_shares TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.post_shares_id_seq TO impacta_app;

COMMIT;

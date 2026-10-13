-- Community owner approval for new members and temporary chat write locks.
-- Run once as the database owner in pgAdmin against the local "Impacta" database.

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

-- Community members already support the pending state; use it for join requests.
ALTER TABLE impacta.communities
    ADD COLUMN IF NOT EXISTS chat_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS community_members_pending_idx
    ON impacta.community_members (community_id, joined_at)
    WHERE status = 'pending';

GRANT SELECT (chat_locked_until) ON impacta.communities TO impacta_app;
GRANT UPDATE (chat_locked_until, updated_at) ON impacta.communities TO impacta_app;
GRANT SELECT (joined_at) ON impacta.community_members TO impacta_app;
GRANT UPDATE (status, joined_at) ON impacta.community_members TO impacta_app;

COMMIT;

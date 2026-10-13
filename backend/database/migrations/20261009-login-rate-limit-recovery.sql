-- Recover the shared loopback login counter and add a per-account attempt limit.
-- Existing events are preserved under an archived type.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Recovery bloqueada: executa apenas na base local Impacta';
    END IF;
END;
$guard$;

CREATE INDEX IF NOT EXISTS auth_events_user_type_time_idx
    ON impacta.auth_events (user_id, event_type, occurred_at DESC)
    WHERE user_id IS NOT NULL;

-- Serialize with the previous IP limiter, then preserve and clear only its
-- local loopback entries. The current API uses a new IP event type and applies
-- the stricter rolling limit to each account separately.
SELECT pg_advisory_xact_lock(
    hashtextextended('impacta:rate:login_attempt:127.0.0.1', 0)
);

DO $recovery$
DECLARE
    recovered_count bigint;
BEGIN
    UPDATE impacta.auth_events
    SET event_type = 'login_attempt_legacy_recovered'
    WHERE ip_address = '127.0.0.1'::inet
      AND event_type = 'login_attempt'
      AND occurred_at > now() - interval '24 hours';

    GET DIAGNOSTICS recovered_count = ROW_COUNT;
    RAISE NOTICE 'Tentativas locais preservadas e retiradas do bloqueio partilhado: %', recovered_count;
END;
$recovery$;

GRANT SELECT (user_id, event_type, occurred_at, ip_address)
    ON impacta.auth_events TO impacta_app;
GRANT INSERT (user_id, event_type, occurred_at, ip_address)
    ON impacta.auth_events TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.auth_events_id_seq TO impacta_app;

COMMIT;

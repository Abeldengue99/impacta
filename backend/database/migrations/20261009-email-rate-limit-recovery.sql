-- Move legacy local email verification attempts out of the new rate-limit
-- counter. The old limiter recorded both admitted and rejected requests,
-- so their outcomes cannot be reconstructed reliably. Rows are preserved.
-- Run once as the database owner in pgAdmin against the local "Impacta" DB.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Recovery bloqueada: executa apenas na base local Impacta';
    END IF;
END;
$guard$;

CREATE INDEX IF NOT EXISTS auth_events_ip_type_time_idx
    ON impacta.auth_events (ip_address, event_type, occurred_at DESC);

-- The least-privilege API account already inserts event_type and ip_address.
-- Allow it to record the exact decision time used by the rolling-window check.
GRANT INSERT (occurred_at) ON impacta.auth_events TO impacta_app;

-- Serialize recovery with the API limiter for this loopback address.
SELECT pg_advisory_xact_lock(
    hashtextextended('impacta:rate:127.0.0.1:email_code_request', 0)
);

DO $recovery$
DECLARE
    recovered_count bigint;
BEGIN
    UPDATE impacta.auth_events
    SET event_type = 'email_code_request_legacy_recovered'
    WHERE ip_address = '127.0.0.1'::inet
      AND event_type = 'email_code_request'
      AND occurred_at > now() - interval '24 hours';

    GET DIAGNOSTICS recovered_count = ROW_COUNT;
    RAISE NOTICE 'Registos locais preservados e retirados do contador: %', recovered_count;
END;
$recovery$;

COMMIT;

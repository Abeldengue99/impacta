-- Anonymous campaign analytics and advertiser details for announcement reports.
-- Run once as the database owner in pgAdmin against the local "Impacta" database.

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta'
       OR to_regnamespace('impacta') IS NULL
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet) THEN
        RAISE EXCEPTION 'Migration blocked: run only in the local Impacta database';
    END IF;
END;
$guard$;

ALTER TABLE impacta.announcements
    ADD COLUMN IF NOT EXISTS advertiser_name text,
    ADD COLUMN IF NOT EXISTS advertiser_email text;

CREATE TABLE IF NOT EXISTS impacta.announcement_metric_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    announcement_id bigint NOT NULL REFERENCES impacta.announcements(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN ('impression', 'click')),
    visitor_hash char(64) NOT NULL CHECK (visitor_hash ~ '^[a-f0-9]{64}$'),
    event_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcement_metric_campaign_day_idx
    ON impacta.announcement_metric_events (announcement_id, event_day, event_type);
CREATE INDEX IF NOT EXISTS announcement_metric_campaign_visitor_idx
    ON impacta.announcement_metric_events (announcement_id, event_type, visitor_hash);
CREATE UNIQUE INDEX IF NOT EXISTS announcement_metric_daily_impression_idx
    ON impacta.announcement_metric_events (announcement_id, event_type, visitor_hash, event_day)
    WHERE event_type = 'impression';

GRANT SELECT (advertiser_name, advertiser_email),
      INSERT (advertiser_name, advertiser_email)
    ON impacta.announcements TO impacta_app;

GRANT SELECT (id, announcement_id, event_type, visitor_hash, event_day, occurred_at),
      INSERT (announcement_id, event_type, visitor_hash, event_day)
    ON impacta.announcement_metric_events TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.announcement_metric_events_id_seq TO impacta_app;

COMMIT;

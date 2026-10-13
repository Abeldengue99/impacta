-- Least-privilege access for post attachments and profile publication history.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

GRANT SELECT (post_id, media_id, position) ON impacta.post_media TO impacta_app;
GRANT INSERT (post_id, media_id, position) ON impacta.post_media TO impacta_app;

-- The post-media rate limiter counts the owner's uploads in a rolling hour.
GRANT SELECT (created_at) ON impacta.media TO impacta_app;

COMMIT;

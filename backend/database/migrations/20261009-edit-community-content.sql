-- Allow authors to edit their own publications and comments.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

GRANT SELECT (updated_at) ON impacta.posts TO impacta_app;
GRANT UPDATE (body, category_code, updated_at) ON impacta.posts TO impacta_app;

GRANT SELECT (updated_at) ON impacta.comments TO impacta_app;
GRANT UPDATE (body, updated_at) ON impacta.comments TO impacta_app;

COMMIT;

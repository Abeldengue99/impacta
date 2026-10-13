-- Permit image-only announcements and advertisements while preserving NOT NULL storage.
-- Run as the local database owner against the Impacta database.

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

DO $constraints$
DECLARE
    constraint_row record;
    definition text;
BEGIN
    IF to_regclass('impacta.announcements') IS NULL THEN
        RAISE EXCEPTION 'impacta.announcements does not exist';
    END IF;

    FOR constraint_row IN
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'impacta.announcements'::regclass
          AND contype = 'c'
    LOOP
        definition := lower(constraint_row.definition);
        IF (definition LIKE '%title%' AND definition LIKE '%trim%' AND definition LIKE '%length%')
           OR (definition LIKE '%body%' AND definition LIKE '%trim%' AND definition LIKE '%length%') THEN
            EXECUTE format('ALTER TABLE impacta.announcements DROP CONSTRAINT %I', constraint_row.conname);
        END IF;
    END LOOP;
END;
$constraints$;

COMMIT;
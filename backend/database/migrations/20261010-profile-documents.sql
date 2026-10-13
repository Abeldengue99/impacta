-- Store one public-profile CV and one portfolio PDF per account.
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

CREATE TABLE IF NOT EXISTS impacta.profile_documents (
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    document_type text NOT NULL CHECK (document_type IN ('cv', 'portfolio')),
    storage_key text NOT NULL UNIQUE
        CHECK (storage_key ~ '^profile-documents/[a-f0-9-]{36}[.]pdf$'),
    byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, document_type)
);

GRANT SELECT (user_id, document_type, storage_key, byte_size, updated_at)
    ON impacta.profile_documents TO impacta_app;
GRANT INSERT (user_id, document_type, storage_key, byte_size)
    ON impacta.profile_documents TO impacta_app;
GRANT UPDATE (storage_key, byte_size, updated_at)
    ON impacta.profile_documents TO impacta_app;
GRANT DELETE ON impacta.profile_documents TO impacta_app;

COMMIT;

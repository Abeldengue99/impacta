BEGIN;

ALTER TABLE impacta.account_verification_requests
    ADD COLUMN IF NOT EXISTS proof_code text,
    ADD COLUMN IF NOT EXISTS proof_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS proof_confirmed_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS proof_confirmed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS account_verification_proof_code_unique_idx
    ON impacta.account_verification_requests (proof_code)
    WHERE proof_code IS NOT NULL;

DROP INDEX IF EXISTS impacta.account_verification_one_approved_per_user_idx;
CREATE UNIQUE INDEX IF NOT EXISTS account_verification_one_confirmed_per_user_idx
    ON impacta.account_verification_requests (user_id)
    WHERE status = 'approved' AND proof_confirmed_at IS NOT NULL;

GRANT SELECT, UPDATE ON impacta.account_verification_requests TO impacta_app;

COMMIT;

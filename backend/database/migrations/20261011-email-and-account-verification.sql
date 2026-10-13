BEGIN;

DO $email_duplicates$
BEGIN
    IF EXISTS (
        SELECT lower(email)
        FROM impacta.users
        WHERE email IS NOT NULL
        GROUP BY lower(email)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate email addresses exist after case normalization; resolve them before applying this migration';
    END IF;
END;
$email_duplicates$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
    ON impacta.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS impacta.account_verification_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES impacta.users(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (category IN ('public_figure', 'organization')),
    evidence_url text NOT NULL CHECK (evidence_url ~* '^https://[^[:space:]]+$'),
    request_note text NOT NULL CHECK (char_length(request_note) BETWEEN 10 AND 1500),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
    reviewed_by_user_id bigint REFERENCES impacta.users(id) ON DELETE SET NULL,
    review_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    CHECK (
        (status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
        OR (status <> 'pending' AND reviewed_at IS NOT NULL
            AND review_reason IS NOT NULL AND char_length(review_reason) BETWEEN 5 AND 1000)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS account_verification_one_pending_per_user_idx
    ON impacta.account_verification_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_verification_queue_idx
    ON impacta.account_verification_requests (created_at, id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS account_verification_one_approved_per_user_idx
    ON impacta.account_verification_requests (user_id) WHERE status = 'approved';
INSERT INTO impacta.permissions (code, description)
VALUES ('accounts.verify', 'Review and decide public identity verification requests.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO impacta.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM impacta.roles AS role
CROSS JOIN impacta.permissions AS permission
WHERE role.code IN ('platform_admin', 'super_admin')
  AND permission.code = 'accounts.verify'
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON impacta.account_verification_requests TO impacta_app;
GRANT USAGE, SELECT ON SEQUENCE impacta.account_verification_requests_id_seq TO impacta_app;
GRANT SELECT (id, display_name, status) ON impacta.users TO impacta_app;
GRANT SELECT (user_id, organization, website_url, is_public) ON impacta.user_profiles TO impacta_app;

COMMIT;

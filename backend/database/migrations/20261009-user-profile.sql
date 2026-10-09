-- Expanded IMPACTA member profiles and private avatar storage.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

ALTER TABLE impacta.user_profiles
    ADD COLUMN IF NOT EXISTS headline text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS occupation text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS website_url text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS impact_area_id bigint,
    ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

DO $constraints$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_impact_area_fk') THEN
        ALTER TABLE impacta.user_profiles
            ADD CONSTRAINT user_profiles_impact_area_fk
            FOREIGN KEY (impact_area_id) REFERENCES impacta.impact_areas(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_headline_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_headline_length CHECK (char_length(headline) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_occupation_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_occupation_length CHECK (char_length(occupation) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_organization_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_organization_length CHECK (char_length(organization) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_bio_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_bio_length CHECK (char_length(bio) <= 600);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_location_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_location_length CHECK (location IS NULL OR char_length(location) <= 120);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_website_length') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_website_length CHECK (char_length(website_url) <= 2048);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_skills_count') THEN
        ALTER TABLE impacta.user_profiles ADD CONSTRAINT user_profiles_skills_count CHECK (cardinality(skills) <= 12);
    END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS user_profiles_public_idx ON impacta.user_profiles (user_id) WHERE is_public;

GRANT SELECT (id, name, is_active) ON impacta.impact_areas TO impacta_app;
GRANT SELECT (id, display_name, status, created_at) ON impacta.users TO impacta_app;
GRANT UPDATE (display_name) ON impacta.users TO impacta_app;
GRANT SELECT (user_id, bio, location, avatar_media_id, headline, occupation,
              organization, website_url, skills, impact_area_id, is_public, updated_at)
    ON impacta.user_profiles TO impacta_app;
GRANT UPDATE (bio, location, avatar_media_id, headline, occupation,
              organization, website_url, skills, impact_area_id, is_public)
    ON impacta.user_profiles TO impacta_app;
GRANT SELECT (id, owner_user_id, storage_key, media_type, mime_type, byte_size,
              checksum_sha256, status)
    ON impacta.media TO impacta_app;
GRANT INSERT (owner_user_id, storage_key, media_type, mime_type, byte_size,
              checksum_sha256, status)
    ON impacta.media TO impacta_app;
GRANT UPDATE (status) ON impacta.media TO impacta_app;
GRANT USAGE ON SEQUENCE impacta.media_id_seq TO impacta_app;
GRANT SELECT (csrf_token_hash) ON impacta.auth_sessions TO impacta_app;

COMMIT;

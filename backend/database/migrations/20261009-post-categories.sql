-- Publication categories, feed filtering and the missing media rate-limit read.
-- Run once as the database owner in pgAdmin against the database "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migration bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS impacta.post_categories (
    code text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    sort_order smallint NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
    CHECK (char_length(trim(name)) > 0),
    CHECK (sort_order > 0)
);

INSERT INTO impacta.post_categories (code, name, description, sort_order) VALUES
    ('community', 'Comunidade', 'Ideias, pedidos e iniciativas locais.', 1),
    ('education', 'Educação', 'Aprendizagem, formação e partilha de conhecimento.', 2),
    ('health', 'Saúde e bem-estar', 'Saúde, prevenção e qualidade de vida.', 3),
    ('environment', 'Ambiente', 'Natureza, sustentabilidade e proteção ambiental.', 4),
    ('technology', 'Tecnologia e inovação', 'Soluções digitais, ciência e inovação.', 5),
    ('culture', 'Cultura e cidadania', 'Cultura, participação cívica e inclusão.', 6),
    ('employment', 'Emprego e empreendedorismo', 'Oportunidades, trabalho e criação de negócios.', 7),
    ('volunteering', 'Voluntariado', 'Ações voluntárias e mobilização comunitária.', 8),
    ('other', 'Outra categoria', 'Publicações que não se enquadram nas restantes categorias.', 9)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        is_active = true;

ALTER TABLE impacta.posts
    ADD COLUMN IF NOT EXISTS category_code text;

UPDATE impacta.posts
SET category_code = 'community'
WHERE category_code IS NULL;

ALTER TABLE impacta.posts
    ALTER COLUMN category_code SET DEFAULT 'community',
    ALTER COLUMN category_code SET NOT NULL;

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'posts_category_code_fk'
          AND conrelid = 'impacta.posts'::regclass
    ) THEN
        ALTER TABLE impacta.posts
            ADD CONSTRAINT posts_category_code_fk
            FOREIGN KEY (category_code)
            REFERENCES impacta.post_categories(code)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS posts_category_created_idx
    ON impacta.posts (category_code, created_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

GRANT SELECT (code, name, description, sort_order, is_active)
    ON impacta.post_categories TO impacta_app;
GRANT SELECT (category_code) ON impacta.posts TO impacta_app;
GRANT INSERT (category_code) ON impacta.posts TO impacta_app;

-- Upload throttling reads created_at when counting the account's recent media.
GRANT SELECT (created_at) ON impacta.media TO impacta_app;

-- Keep the application role limited to the columns used by attachment queries.
GRANT SELECT (post_id, media_id, position) ON impacta.post_media TO impacta_app;
GRANT INSERT (post_id, media_id, position) ON impacta.post_media TO impacta_app;

COMMIT;

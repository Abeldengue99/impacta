-- Expand publication themes and allow a per-post label under "other".
-- Requires 20261009-post-categories.sql.
-- Run once as the database owner in pgAdmin against "Impacta".

BEGIN;

DO $guard$
BEGIN
    IF current_database() <> 'Impacta' THEN
        RAISE EXCEPTION 'Migração bloqueada: executa apenas na base Impacta';
    END IF;
END;
$guard$;

-- Move the fallback out of the way before assigning the expanded order.
UPDATE impacta.post_categories
SET sort_order = 32767
WHERE code = 'other';

INSERT INTO impacta.post_categories (code, name, description, sort_order) VALUES
    ('community', 'Comunidade', 'Ideias, pedidos e iniciativas locais.', 1),
    ('education', 'Educação e literacia', 'Aprendizagem, formação e partilha de conhecimento.', 2),
    ('health', 'Saúde e bem-estar', 'Saúde, prevenção e qualidade de vida.', 3),
    ('environment', 'Ambiente e conservação', 'Natureza, sustentabilidade e proteção ambiental.', 4),
    ('technology', 'Tecnologia e inovação', 'Soluções digitais, ciência e inovação.', 5),
    ('culture', 'Cultura e cidadania', 'Cultura, participação cívica e inclusão.', 6),
    ('employment', 'Emprego e empreendedorismo', 'Trabalho, formação e criação de negócios.', 7),
    ('volunteering', 'Voluntariado', 'Ações voluntárias e mobilização comunitária.', 8),
    ('agriculture_food', 'Agricultura e alimentação', 'Agricultura, nutrição e segurança alimentar.', 9),
    ('water_sanitation', 'Água e saneamento', 'Acesso a água segura, higiene e saneamento.', 10),
    ('housing_services', 'Habitação e serviços básicos', 'Habitação digna, energia e serviços essenciais.', 11),
    ('inclusion_rights', 'Inclusão e direitos humanos', 'Igualdade, acessibilidade e proteção de direitos.', 12),
    ('youth_child_protection', 'Juventude e proteção da criança', 'Desenvolvimento, educação e proteção de crianças e jovens.', 13),
    ('climate_energy', 'Clima e energia limpa', 'Ação climática, energias renováveis e resiliência.', 14),
    ('humanitarian', 'Ação humanitária e emergências', 'Ajuda humanitária, prevenção e resposta a emergências.', 15),
    ('sports_wellbeing', 'Desporto e bem-estar', 'Atividade física, lazer e saúde comunitária.', 16),
    ('animal_welfare', 'Proteção animal', 'Proteção, saúde e bem-estar animal.', 17),
    ('mobility_public_services', 'Mobilidade e serviços públicos', 'Transportes, governação e acesso a serviços públicos.', 18),
    ('other', 'Outra categoria', 'Usa esta opção e acrescenta um tema próprio, se necessário.', 19)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        sort_order = EXCLUDED.sort_order,
        is_active = true;

ALTER TABLE impacta.posts
    ADD COLUMN IF NOT EXISTS custom_category text NOT NULL DEFAULT '';

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'posts_custom_category_length'
          AND conrelid = 'impacta.posts'::regclass
    ) THEN
        ALTER TABLE impacta.posts
            ADD CONSTRAINT posts_custom_category_length
            CHECK (char_length(custom_category) <= 60);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'posts_custom_category_other_only'
          AND conrelid = 'impacta.posts'::regclass
    ) THEN
        ALTER TABLE impacta.posts
            ADD CONSTRAINT posts_custom_category_other_only
            CHECK (custom_category = '' OR category_code = 'other');
    END IF;
END;
$constraints$;

GRANT SELECT (code, name, description, sort_order, is_active)
    ON impacta.post_categories TO impacta_app;
GRANT SELECT (custom_category) ON impacta.posts TO impacta_app;
GRANT INSERT (custom_category) ON impacta.posts TO impacta_app;
GRANT UPDATE (custom_category) ON impacta.posts TO impacta_app;

COMMIT;

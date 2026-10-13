-- Shared impact-area catalogue plus a per-profile custom area option.
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
    ADD COLUMN IF NOT EXISTS custom_impact_area text NOT NULL DEFAULT '';

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_profiles_custom_impact_area_length'
          AND conrelid = 'impacta.user_profiles'::regclass
    ) THEN
        ALTER TABLE impacta.user_profiles
            ADD CONSTRAINT user_profiles_custom_impact_area_length
            CHECK (char_length(custom_impact_area) <= 120);
    END IF;
END;
$constraints$;

INSERT INTO impacta.impact_areas (code, name, is_active) VALUES
    ('education', 'Educação e literacia', true),
    ('health', 'Saúde', true),
    ('mental_health', 'Saúde mental', true),
    ('food_security', 'Nutrição e segurança alimentar', true),
    ('agriculture', 'Agricultura e desenvolvimento rural', true),
    ('water_sanitation', 'Água, higiene e saneamento', true),
    ('environment', 'Ambiente e conservação', true),
    ('climate_action', 'Ação climática', true),
    ('clean_energy', 'Energia limpa', true),
    ('housing', 'Habitação digna', true),
    ('vocational_training', 'Emprego e formação profissional', true),
    ('entrepreneurship', 'Empreendedorismo', true),
    ('local_economy', 'Desenvolvimento económico local', true),
    ('social_inclusion', 'Inclusão social', true),
    ('accessibility', 'Acessibilidade e inclusão da deficiência', true),
    ('gender_equality', 'Igualdade de género', true),
    ('human_rights', 'Direitos humanos', true),
    ('child_protection', 'Proteção da criança', true),
    ('youth', 'Juventude', true),
    ('elder_support', 'Envelhecimento ativo e apoio a idosos', true),
    ('refugee_support', 'Apoio a refugiados e pessoas deslocadas', true),
    ('culture', 'Cultura e património', true),
    ('arts_creativity', 'Artes e criatividade', true),
    ('sports_wellbeing', 'Desporto e bem-estar', true),
    ('technology_innovation', 'Tecnologia e inovação', true),
    ('digital_inclusion', 'Inclusão digital', true),
    ('science_research', 'Ciência e investigação', true),
    ('community_development', 'Desenvolvimento comunitário', true),
    ('volunteering', 'Voluntariado', true),
    ('civic_participation', 'Participação cívica', true),
    ('peace_justice', 'Paz, justiça e segurança', true),
    ('mobility', 'Mobilidade e transportes', true),
    ('circular_economy', 'Economia circular e gestão de resíduos', true),
    ('animal_welfare', 'Proteção e bem-estar animal', true),
    ('emergency_response', 'Resposta a emergências e ação humanitária', true),
    ('sustainable_tourism', 'Turismo sustentável', true),
    ('financial_inclusion', 'Inclusão e educação financeira', true),
    ('communication', 'Comunicação e acesso à informação', true),
    ('ocean_conservation', 'Oceanos e zonas costeiras', true),
    ('water_resources', 'Proteção dos recursos naturais', true),
    ('public_services', 'Serviços públicos e governação', true),
    ('research_data', 'Dados e avaliação de impacto', true),
    ('migration', 'Migração e integração', true),
    ('community_safety', 'Prevenção da violência e segurança comunitária', true)
ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = true;

GRANT SELECT (id, name, is_active) ON impacta.impact_areas TO impacta_app;
GRANT SELECT (custom_impact_area) ON impacta.user_profiles TO impacta_app;
GRANT UPDATE (custom_impact_area) ON impacta.user_profiles TO impacta_app;

COMMIT;

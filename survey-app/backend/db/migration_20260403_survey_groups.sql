-- Идемпотентно для уже развёрнутых БД: группы опросов + привязка опросов.
-- Повторный запуск безопасен.

CREATE TABLE IF NOT EXISTS survey_groups (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  curator_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_survey_groups_sort ON survey_groups (sort_order, id);

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS survey_group_id INTEGER REFERENCES survey_groups (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_survey_group ON surveys (survey_group_id);

INSERT INTO survey_groups (slug, name, curator_name, sort_order) VALUES
  ('internships', 'Стажировки', 'Ирина Крулыкова', 1),
  ('school_department', 'Школьное отделение', 'Виталий Басовский', 2),
  ('extra_education', 'Доп.образование', 'Мария Бусарова', 3)
ON CONFLICT (slug) DO NOTHING;

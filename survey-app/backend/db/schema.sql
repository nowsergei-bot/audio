-- Схема опросов для Managed PostgreSQL / Neon
-- Колонка порядка: sort_order (аналог поля order из ТЗ; ORDER — зарезервировано в SQL)
-- Повторный запуск безопасен: типы и таблицы уже есть — ошибки не будет.

DO $$ BEGIN
  CREATE TYPE survey_status AS ENUM ('draft', 'published', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE question_type AS ENUM ('radio', 'checkbox', 'scale', 'text', 'rating');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS surveys (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NULL,
    status survey_status NOT NULL DEFAULT 'draft',
    access_link TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys (status);
CREATE INDEX IF NOT EXISTS idx_surveys_access_link ON surveys (access_link);

CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    type question_type NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions (survey_id);

CREATE TABLE IF NOT EXISTS responses (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    respondent_id TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (survey_id, respondent_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses (survey_id);

CREATE TABLE IF NOT EXISTS answer_values (
    id SERIAL PRIMARY KEY,
    response_id INTEGER NOT NULL REFERENCES responses (id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    value JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answer_values_response ON answer_values (response_id);
CREATE INDEX IF NOT EXISTS idx_answer_values_question ON answer_values (question_id);

CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    question_id INTEGER NULL REFERENCES questions (id) ON DELETE CASCADE,
    user_id INTEGER NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_survey ON comments (survey_id);

-- Устаревшее поле (раньше — публичная ссылка на результаты); API больше не использует
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS results_share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_surveys_results_share_token ON surveys (results_share_token)
  WHERE results_share_token IS NOT NULL;

-- Произвольные таблицы Excel (статистика с других платформ), не привязаны к вопросам опроса
CREATE TABLE IF NOT EXISTS survey_workbooks (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  sheets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_commentary TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_workbooks_survey ON survey_workbooks (survey_id);

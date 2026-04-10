-- Схема опросов для Managed PostgreSQL / Neon
-- Колонка порядка: sort_order (аналог поля order из ТЗ; ORDER — зарезервировано в SQL)
-- Повторный запуск безопасен: типы и таблицы уже есть — ошибки не будет.

DO $$ BEGIN
  CREATE TYPE survey_status AS ENUM ('draft', 'published', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE question_type AS ENUM ('radio', 'checkbox', 'scale', 'text', 'rating', 'date');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('methodist', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'methodist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS surveys (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by INTEGER NULL,
    owner_user_id INTEGER NULL REFERENCES users (id) ON DELETE SET NULL,
    status survey_status NOT NULL DEFAULT 'draft',
    access_link TEXT NOT NULL UNIQUE,
    director_token TEXT UNIQUE,
    allow_multiple_responses BOOLEAN NOT NULL DEFAULT FALSE,
    media JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_surveys_status ON surveys (status);
CREATE INDEX IF NOT EXISTS idx_surveys_access_link ON surveys (access_link);
CREATE INDEX IF NOT EXISTS idx_surveys_director_token ON surveys (director_token) WHERE director_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_owner ON surveys (owner_user_id);

-- Разделы (группы) опросов для методистов: стажировки, отделения и т.д.
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

CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '',
    type question_type NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    required BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions (survey_id);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS responses (
    id SERIAL PRIMARY KEY,
    survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    respondent_id TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_responses_survey ON responses (survey_id);
CREATE INDEX IF NOT EXISTS idx_responses_survey_respondent ON responses (survey_id, respondent_id);

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

-- Приглашения гостей по email
CREATE TABLE IF NOT EXISTS survey_invites (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invite_token TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  last_sent_at TIMESTAMPTZ NULL,
  responded_at TIMESTAMPTZ NULL,
  UNIQUE (survey_id, email)
);

CREATE INDEX IF NOT EXISTS idx_survey_invites_survey ON survey_invites (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_invites_status ON survey_invites (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_invites_token_unique ON survey_invites (invite_token)
  WHERE invite_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_survey_invites_responded ON survey_invites (survey_id, responded_at);
CREATE INDEX IF NOT EXISTS idx_survey_invites_last_sent ON survey_invites (survey_id, last_sent_at);

CREATE TABLE IF NOT EXISTS survey_invite_templates (
  survey_id INTEGER PRIMARY KEY REFERENCES surveys (id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS photo_wall_uploads (
  id SERIAL PRIMARY KEY,
  respondent_id TEXT NOT NULL UNIQUE,
  image_data TEXT,
  thumb_data TEXT,
  thumb_public_url TEXT,
  image_public_url TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_wall_status ON photo_wall_uploads (moderation_status);

-- Педагогическая аналитика (сессии, JSON-состояние)
CREATE TABLE IF NOT EXISTS pedagogical_analytics_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Без названия',
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedagogical_sessions_user_updated ON pedagogical_analytics_sessions (user_id, updated_at DESC);

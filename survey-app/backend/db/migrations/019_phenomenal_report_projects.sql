-- Проекты отчёта «феноменальные уроки»: черновик на сервере + ссылка для руководителя
CREATE TABLE IF NOT EXISTS phenomenal_report_projects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  survey_id INTEGER REFERENCES surveys (id) ON DELETE SET NULL,
  director_share_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phenomenal_report_projects_user_updated
  ON phenomenal_report_projects (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_phenomenal_report_projects_survey
  ON phenomenal_report_projects (survey_id)
  WHERE survey_id IS NOT NULL;

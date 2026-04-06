-- Сохранённые проекты Excel-аналитики (маппинг и срез) на сервере, по пользователю.

CREATE TABLE IF NOT EXISTS excel_analytics_projects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  file_name TEXT NOT NULL,
  session_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_excel_projects_user_updated ON excel_analytics_projects (user_id, updated_at DESC);

-- Сессии модуля «Педагогическая аналитика»: черновик, прогресс ИИ, согласование, отчёт.
-- Идемпотентно: повторный запуск безопасен.
-- Дубликат для удобства: та же схема в migrations/017_pedagogical_analytics_sessions.sql и в schema.sql.

CREATE TABLE IF NOT EXISTS pedagogical_analytics_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Без названия',
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedagogical_sessions_user_updated ON pedagogical_analytics_sessions (user_id, updated_at DESC);

COMMENT ON TABLE pedagogical_analytics_sessions IS 'Многошаговый workflow педагогической аналитики (состояние в state_json).';

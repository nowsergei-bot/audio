-- Приглашения по email (список гостей) для одного опроса.

CREATE TABLE IF NOT EXISTS survey_invites (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | error
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  UNIQUE (survey_id, email)
);

CREATE INDEX IF NOT EXISTS idx_survey_invites_survey ON survey_invites (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_invites_status ON survey_invites (status);


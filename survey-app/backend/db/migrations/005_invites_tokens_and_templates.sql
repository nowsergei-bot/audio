-- Invite tokens, ответившие, попытки и шаблоны писем.

ALTER TABLE survey_invites
  ADD COLUMN IF NOT EXISTS invite_token TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ NULL;

-- На старых строках выставим last_sent_at = sent_at, если sent_at есть
UPDATE survey_invites
SET last_sent_at = COALESCE(last_sent_at, sent_at)
WHERE sent_at IS NOT NULL;

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


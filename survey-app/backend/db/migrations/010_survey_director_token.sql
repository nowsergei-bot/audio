-- Секретная ссылка «для директора» (не совпадает с access_link публичной формы)
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS director_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_surveys_director_token ON surveys (director_token) WHERE director_token IS NOT NULL;

UPDATE surveys
SET director_token = replace(gen_random_uuid()::text, '-', '')
WHERE director_token IS NULL;

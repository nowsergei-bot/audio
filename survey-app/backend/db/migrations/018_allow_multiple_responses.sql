-- Повторный запуск безопасен (IF NOT EXISTS / IF EXISTS).

ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS allow_multiple_responses BOOLEAN NOT NULL DEFAULT FALSE;

-- Старое ограничение «один ответ на пару (survey_id, respondent_id)»
ALTER TABLE responses
  DROP CONSTRAINT IF EXISTS responses_survey_id_respondent_id_key;

-- На части инсталляций уникальность могла быть оформена как отдельный индекс
DROP INDEX IF EXISTS responses_survey_id_respondent_key;
DROP INDEX IF EXISTS idx_responses_survey_respondent_unique;

CREATE INDEX IF NOT EXISTS idx_responses_survey_respondent
  ON responses (survey_id, respondent_id);

-- Необязательные представления для Apache Superset / BI (удобнее, чем сырой JSONB в первых шагах).
-- Выполните в той же БД, где крутится приложение «Пульс», после основной схемы.
-- Пользователю Superset выдайте только SELECT (см. infra/superset/README.md).

CREATE OR REPLACE VIEW superset_v_surveys AS
SELECT
  id,
  title,
  status::text AS status,
  access_link,
  created_at
FROM surveys;

CREATE OR REPLACE VIEW superset_v_responses AS
SELECT
  r.id,
  r.survey_id,
  s.title AS survey_title,
  r.respondent_id,
  r.submitted_at
FROM responses r
INNER JOIN surveys s ON s.id = r.survey_id;

CREATE OR REPLACE VIEW superset_v_answer_values AS
SELECT
  av.id,
  av.response_id,
  av.question_id,
  q.text AS question_text,
  q.type::text AS question_type,
  q.survey_id,
  q.sort_order,
  av.value::text AS value_json
FROM answer_values av
INNER JOIN questions q ON q.id = av.question_id;

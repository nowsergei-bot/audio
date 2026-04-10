-- Одноразовое исправление: шкала «Общая оценка урока от 1 до 10»: значение 9 → 10
-- Контекст ответа: учитель Гринцова Н.А., класс 1В, ребёнок/родитель — Хмыз.
--
-- Сначала выполните PREVIEW ниже (раскомментируйте). Должна быть ровно одна строка.
-- Затем выполните блок UPDATE+COMMIT.
--
-- Если подзапрос найдёт больше одной строки с оценкой 9 под фильтром — PostgreSQL
-- выдаст ошибку «more than one row» (это защита от лишних правок).
--
-- psql:  psql "$PG_CONNECTION_STRING" -v ON_ERROR_STOP=1 -f fix_khmyz_1v_grintsova_lesson_rating_9_to_10.sql

-- ===================== PREVIEW (выполнить отдельно) =====================
/*
WITH rating_q AS (
  SELECT q.id AS q_id, q.survey_id, q.text AS q_text
  FROM questions q
  WHERE (q.type = 'scale' OR q.type = 'rating')
    AND q.text ILIKE '%Общая оценка урока%'
    AND (q.text ILIKE '%10%' OR q.text ILIKE '%1 до 10%')
),
matching_responses AS (
  SELECT DISTINCT r.id AS response_id, r.survey_id
  FROM responses r
  INNER JOIN rating_q rq ON rq.survey_id = r.survey_id
  WHERE
    EXISTS (
      SELECT 1
      FROM answer_values av
      WHERE av.response_id = r.id
        AND jsonb_typeof(av.value) = 'string'
        AND (av.value #>> '{}') ILIKE '%гринцов%'
    )
    AND EXISTS (
      SELECT 1
      FROM answer_values av
      WHERE av.response_id = r.id
        AND jsonb_typeof(av.value) = 'string'
        AND ((av.value #>> '{}') ILIKE '%хмыз%' OR (av.value #>> '{}') ILIKE '%khmyz%')
    )
    AND EXISTS (
      SELECT 1
      FROM answer_values av
      WHERE av.response_id = r.id
        AND jsonb_typeof(av.value) = 'string'
        AND (
          (av.value #>> '{}') ILIKE '%1в%'
          OR (av.value #>> '{}') ILIKE '%1 в%'
          OR (av.value #>> '{}') ~* '1[[:space:]]*[«"]?[вВbB]'
        )
    )
)
SELECT
  r.id AS response_id,
  r.survey_id,
  r.submitted_at,
  av.id AS answer_value_id,
  av.question_id,
  av.value AS old_value,
  rq.q_text
FROM answer_values av
INNER JOIN rating_q rq ON rq.q_id = av.question_id
INNER JOIN matching_responses mr ON mr.response_id = av.response_id AND mr.survey_id = rq.survey_id
INNER JOIN responses r ON r.id = av.response_id
WHERE av.value = to_jsonb(9)
   OR (jsonb_typeof(av.value) = 'string' AND av.value #>> '{}' = '9');
*/

-- ===================== UPDATE =====================

BEGIN;

UPDATE answer_values av
SET value = to_jsonb(10)
WHERE av.id = (
  WITH rating_q AS (
    SELECT q.id AS q_id, q.survey_id
    FROM questions q
    WHERE (q.type = 'scale' OR q.type = 'rating')
      AND q.text ILIKE '%Общая оценка урока%'
      AND (q.text ILIKE '%10%' OR q.text ILIKE '%1 до 10%')
  ),
  matching_responses AS (
    SELECT DISTINCT r.id AS response_id, r.survey_id
    FROM responses r
    INNER JOIN rating_q rq ON rq.survey_id = r.survey_id
    WHERE
      EXISTS (
        SELECT 1
        FROM answer_values av2
        WHERE av2.response_id = r.id
          AND jsonb_typeof(av2.value) = 'string'
          AND (av2.value #>> '{}') ILIKE '%гринцов%'
      )
      AND EXISTS (
        SELECT 1
        FROM answer_values av2
        WHERE av2.response_id = r.id
          AND jsonb_typeof(av2.value) = 'string'
          AND ((av2.value #>> '{}') ILIKE '%хмыз%' OR (av2.value #>> '{}') ILIKE '%khmyz%')
      )
      AND EXISTS (
        SELECT 1
        FROM answer_values av2
        WHERE av2.response_id = r.id
          AND jsonb_typeof(av2.value) = 'string'
          AND (
            (av2.value #>> '{}') ILIKE '%1в%'
            OR (av2.value #>> '{}') ILIKE '%1 в%'
            OR (av2.value #>> '{}') ~* '1[[:space:]]*[«"]?[вВbB]'
          )
      )
  )
  SELECT av3.id
  FROM answer_values av3
  INNER JOIN rating_q rq ON rq.q_id = av3.question_id
  INNER JOIN matching_responses mr ON mr.response_id = av3.response_id AND mr.survey_id = rq.survey_id
  WHERE av3.value = to_jsonb(9)
     OR (jsonb_typeof(av3.value) = 'string' AND av3.value #>> '{}' = '9')
)
RETURNING av.id, av.response_id, av.question_id, av.value AS new_value;

COMMIT;

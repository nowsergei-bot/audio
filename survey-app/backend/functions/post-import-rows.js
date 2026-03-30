const { randomUUID } = require('crypto');
const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { validatePartialImportAnswers } = require('./lib/validation');

const MAX_ROWS = 3000;

function ruValidationError(en) {
  if (!en || typeof en !== 'string') return en;
  return en
    .replace(/Question (\d+):/g, 'Вопрос $1:')
    .replace(/radio expects string/g, 'нужен текст варианта')
    .replace(/checkbox expects array/g, 'нужен список вариантов')
    .replace(/number required/g, 'нужно число')
    .replace(/out of range/g, 'вне допустимого диапазона')
    .replace(/invalid option/g, 'недопустимый вариант')
    .replace(/empty text/g, 'пустой текст')
    .replace(/too long/g, 'слишком длинный текст')
    .replace(/text required/g, 'нужен текст')
    .replace(/date required/g, 'нужна дата')
    .replace(/invalid date format/g, 'нужен формат даты ГГГГ-ММ-ДД')
    .replace(/Unknown question_id/g, 'Неизвестный вопрос')
    .replace(/No valid answers in row/g, 'В строке нет ни одного допустимого ответа');
}

async function handlePostImportRows(pool, surveyId, event) {
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Опрос не найден' });

  const body = parseBody(event);
  const rows = body?.rows;
  if (!Array.isArray(rows)) {
    return json(400, { error: 'Ожидается массив rows: каждая строка — { answers: [{ question_id, value }, ...] }' });
  }
  if (rows.length === 0) {
    return json(400, { error: 'Нет строк для импорта' });
  }
  if (rows.length > MAX_ROWS) {
    return json(400, { error: `Не более ${MAX_ROWS} строк за один импорт` });
  }

  const batchId = randomUUID();
  const rowErrors = [];
  const valid = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      const answersPayload = item?.answers;
      if (!Array.isArray(answersPayload)) {
        rowErrors.push({ row: i + 2, error: 'Нет массива answers' });
        continue;
      }

      const v = validatePartialImportAnswers(survey.questions, answersPayload);
      if (!v.ok) {
        rowErrors.push({ row: i + 2, error: ruValidationError(v.error) });
        continue;
      }
      const respondent_id = `import:${batchId}:${i}:${randomUUID().slice(0, 10)}`;
      valid.push({ i, respondent_id, answers: v.answers });
    }

    if (valid.length > 0) {
      // 1) Insert all responses in one query
      const respondentIds = valid.map((v) => v.respondent_id);
      const ins = await client.query(
        `INSERT INTO responses (survey_id, respondent_id)
         SELECT $1, x FROM unnest($2::text[]) AS x
         RETURNING id, respondent_id`,
        [surveyId, respondentIds]
      );
      const byRid = new Map(ins.rows.map((r) => [r.respondent_id, Number(r.id)]));

      // 2) Insert all answer_values in one query
      const respIds = [];
      const qIds = [];
      const valuesText = [];
      for (const v of valid) {
        const rid = byRid.get(v.respondent_id);
        if (!rid) continue;
        for (const a of v.answers) {
          respIds.push(rid);
          qIds.push(Number(a.question_id));
          valuesText.push(JSON.stringify(a.value));
        }
      }
      // Chunk to avoid oversized query/timeouts on large imports.
      const CHUNK = 4000;
      for (let off = 0; off < respIds.length; off += CHUNK) {
        const a = respIds.slice(off, off + CHUNK);
        const b = qIds.slice(off, off + CHUNK);
        const c = valuesText.slice(off, off + CHUNK);
        await client.query(
          `INSERT INTO answer_values (response_id, question_id, value)
           SELECT t.response_id, t.question_id, t.value_text::jsonb
           FROM unnest($1::int[], $2::int[], $3::text[]) AS t(response_id, question_id, value_text)`,
          [a, b, c]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const imported = valid.length;
  return json(200, {
    ok: true,
    imported,
    skipped: rows.length - imported,
    batch_id: batchId,
    errors: rowErrors.slice(0, 100),
  });
}

module.exports = { handlePostImportRows, MAX_ROWS };

const { randomUUID } = require('crypto');
const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { validatePartialImportAnswers } = require('./lib/validation');

const MAX_ROWS = 500;

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
  let imported = 0;
  const rowErrors = [];

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
      const insR = await client.query(
        `INSERT INTO responses (survey_id, respondent_id) VALUES ($1, $2) RETURNING id`,
        [surveyId, respondent_id]
      );
      const responseId = insR.rows[0].id;
      for (const a of v.answers) {
        await client.query(
          `INSERT INTO answer_values (response_id, question_id, value) VALUES ($1, $2, $3::jsonb)`,
          [responseId, a.question_id, JSON.stringify(a.value)]
        );
      }
      imported++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return json(200, {
    ok: true,
    imported,
    skipped: rows.length - imported,
    batch_id: batchId,
    errors: rowErrors.slice(0, 100),
  });
}

module.exports = { handlePostImportRows, MAX_ROWS };

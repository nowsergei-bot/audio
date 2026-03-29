const { json } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');

/**
 * Сырые ответы для выгрузки в Excel (админка).
 */
async function handleGetExportRows(pool, surveyId) {
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Опрос не найден' });

  const r = await pool.query(
    `SELECT r.id, r.respondent_id, r.created_at::text AS created_at,
            av.question_id, av.value
     FROM responses r
     LEFT JOIN answer_values av ON av.response_id = r.id
     WHERE r.survey_id = $1
     ORDER BY r.created_at ASC, r.id ASC, av.question_id ASC`,
    [surveyId]
  );

  const byResp = new Map();
  for (const row of r.rows) {
    if (!byResp.has(row.id)) {
      byResp.set(row.id, {
        respondent_id: row.respondent_id,
        created_at: row.created_at,
        answers: {},
      });
    }
    if (row.question_id != null && row.value !== undefined && row.value !== null) {
      const b = byResp.get(row.id);
      b.answers[row.question_id] = row.value;
    }
  }

  return json(200, {
    survey: { id: survey.id, title: survey.title },
    questions: survey.questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
    })),
    rows: [...byResp.values()],
  });
}

module.exports = { handleGetExportRows };

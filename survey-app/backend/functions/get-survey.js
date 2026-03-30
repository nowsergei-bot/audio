const { json } = require('./lib/http');

async function loadSurveyWithQuestions(pool, id) {
  const s = await pool.query(
    `SELECT id, title, description, created_at, created_by, status, access_link, media, owner_user_id FROM surveys WHERE id = $1`,
    [id]
  );
  if (!s.rows.length) return null;
  const q = await pool.query(
    `SELECT id, survey_id, text, type::text AS type, options, sort_order FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
    [id]
  );
  return { ...s.rows[0], questions: q.rows };
}

async function handleGetSurvey(pool, id) {
  const survey = await loadSurveyWithQuestions(pool, id);
  if (!survey) return json(404, { error: 'Not found' });
  return json(200, { survey });
}

module.exports = { handleGetSurvey, loadSurveyWithQuestions };

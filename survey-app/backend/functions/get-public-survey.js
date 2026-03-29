const { json } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');

async function handleGetPublicSurveyByLink(pool, accessLink) {
  const s = await pool.query(
    `SELECT id FROM surveys WHERE access_link = $1 AND status = 'published'`,
    [accessLink]
  );
  if (!s.rows.length) {
    return json(404, { error: 'Survey not found or not published' });
  }
  const survey = await loadSurveyWithQuestions(pool, s.rows[0].id);
  return json(200, { survey });
}

module.exports = { handleGetPublicSurveyByLink };

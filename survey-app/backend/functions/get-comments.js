const { json } = require('./lib/http');

async function handleGetComments(pool, surveyId) {
  const exists = await pool.query(`SELECT 1 FROM surveys WHERE id = $1`, [surveyId]);
  if (!exists.rows.length) return json(404, { error: 'Not found' });

  const r = await pool.query(
    `SELECT id, survey_id, question_id, user_id, text, created_at
     FROM comments
     WHERE survey_id = $1
     ORDER BY created_at ASC`,
    [surveyId]
  );
  return json(200, { comments: r.rows });
}

module.exports = { handleGetComments };

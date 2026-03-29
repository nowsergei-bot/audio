const { json, parseBody } = require('./lib/http');

async function handlePostComment(pool, surveyId, event) {
  const exists = await pool.query(`SELECT 1 FROM surveys WHERE id = $1`, [surveyId]);
  if (!exists.rows.length) return json(404, { error: 'Not found' });

  const body = parseBody(event) || {};
  const text = body.text != null ? String(body.text).trim() : '';
  if (!text) return json(400, { error: 'text is required' });
  const question_id = body.question_id != null ? Number(body.question_id) : null;
  const user_id = body.user_id != null ? Number(body.user_id) : null;

  if (question_id != null) {
    const q = await pool.query(
      `SELECT 1 FROM questions WHERE id = $1 AND survey_id = $2`,
      [question_id, surveyId]
    );
    if (!q.rows.length) {
      return json(400, { error: 'Invalid question_id for this survey' });
    }
  }

  const ins = await pool.query(
    `INSERT INTO comments (survey_id, question_id, user_id, text)
     VALUES ($1, $2, $3, $4)
     RETURNING id, survey_id, question_id, user_id, text, created_at`,
    [surveyId, question_id, user_id, text]
  );
  return json(201, { comment: ins.rows[0] });
}

module.exports = { handlePostComment };

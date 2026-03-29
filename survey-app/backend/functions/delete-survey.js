const { json } = require('./lib/http');

async function handleDeleteSurvey(pool, id) {
  const r = await pool.query(`DELETE FROM surveys WHERE id = $1 RETURNING id`, [id]);
  if (!r.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true });
}

module.exports = { handleDeleteSurvey };

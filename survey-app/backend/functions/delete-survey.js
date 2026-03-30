const { json } = require('./lib/http');

async function handleDeleteSurvey(pool, id, user) {
  const s = await pool.query(`SELECT owner_user_id FROM surveys WHERE id = $1`, [id]);
  if (!s.rows.length) return json(404, { error: 'Not found' });
  if (user && user.role !== 'admin' && Number(s.rows[0].owner_user_id || 0) !== Number(user.id || -1)) {
    return json(403, { error: 'Forbidden' });
  }
  const r = await pool.query(`DELETE FROM surveys WHERE id = $1 RETURNING id`, [id]);
  if (!r.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true });
}

module.exports = { handleDeleteSurvey };

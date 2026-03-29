const { json } = require('./lib/http');

async function handleGetSurveys(pool) {
  const r = await pool.query(
    `SELECT id, title, description, created_at, created_by, status, access_link
     FROM surveys
     ORDER BY created_at DESC`
  );
  return json(200, { surveys: r.rows });
}

module.exports = { handleGetSurveys };

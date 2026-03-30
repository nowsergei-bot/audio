const { json } = require('./lib/http');

async function handleGetSurveys(pool, user) {
  const isAdmin = user && user.role === 'admin';
  const r = isAdmin
    ? await pool.query(
        `SELECT id, title, description, created_at, created_by, status, access_link, media, owner_user_id
         FROM surveys
         ORDER BY created_at DESC`
      )
    : await pool.query(
        `SELECT id, title, description, created_at, created_by, status, access_link, media, owner_user_id
         FROM surveys
         WHERE owner_user_id = $1
         ORDER BY created_at DESC`,
        [user.id]
      );
  return json(200, { surveys: r.rows });
}

module.exports = { handleGetSurveys };

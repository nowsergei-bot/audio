const { json } = require('./http');
const { isAdminApiKey, parseBearerToken } = require('./auth');
const { tokenHash } = require('./passwords');

async function requireUser(pool, event) {
  if (isAdminApiKey(event)) {
    return { ok: true, user: { id: null, email: 'admin_api_key', role: 'admin' }, viaAdminKey: true };
  }

  const token = parseBearerToken(event);
  if (!token) return { ok: false, code: 401, error: 'Unauthorized' };

  const th = tokenHash(token);
  const r = await pool.query(
    `SELECT u.id, u.email, u.role::text AS role
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [th]
  );
  if (!r.rows.length) return { ok: false, code: 401, error: 'Unauthorized' };
  return { ok: true, user: r.rows[0], viaAdminKey: false };
}

function requireRole(user, role) {
  if (!user) return { ok: false, code: 401, error: 'Unauthorized' };
  if (user.role === 'admin') return { ok: true };
  if (user.role === role) return { ok: true };
  return { ok: false, code: 403, error: 'Forbidden' };
}

module.exports = { requireUser, requireRole, json };


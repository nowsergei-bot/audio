const { json, parseBody } = require('./lib/http');
const { verifyPassword, newSessionToken, tokenHash } = require('./lib/passwords');

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

async function handlePostAuthLogin(pool, event) {
  const body = parseBody(event) || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (!email || !email.includes('@')) return json(400, { error: 'Некорректная почта' });
  if (!password) return json(400, { error: 'Нужен пароль' });

  const u = await pool.query(
    `SELECT id, email, role::text AS role, password_hash
     FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );
  if (!u.rows.length) return json(401, { error: 'Неверная почта или пароль' });
  const user = u.rows[0];
  if (!verifyPassword(password, user.password_hash)) return json(401, { error: 'Неверная почта или пароль' });

  const token = newSessionToken();
  const th = tokenHash(token);
  const ttlDays = Number(process.env.SESSION_TTL_DAYS || 14);
  const expires = new Date(Date.now() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, th, expires.toISOString()]
  );

  return json(200, {
    token,
    user: { id: user.id, email: user.email, role: user.role },
    expires_at: expires.toISOString(),
  });
}

module.exports = { handlePostAuthLogin };


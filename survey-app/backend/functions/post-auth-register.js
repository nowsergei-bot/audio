const { json, parseBody } = require('./lib/http');
const { hashPassword } = require('./lib/passwords');

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function allowedCorporateEmail(email) {
  const list = String(process.env.CORP_EMAIL_DOMAINS || '').trim();
  if (!list) return true; // если не задано — не блокируем, чтобы не ломать dev
  const domains = list
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((d) => (d.startsWith('@') ? d : `@${d}`));
  return domains.some((d) => email.endsWith(d));
}

async function handlePostAuthRegister(pool, event) {
  const body = parseBody(event) || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const role = body.role === 'admin' ? 'admin' : 'methodist';

  if (!email || !email.includes('@')) return json(400, { error: 'Некорректная почта' });
  if (!allowedCorporateEmail(email)) {
    return json(400, { error: 'Регистрация доступна только с корпоративной почтой' });
  }
  if (password.length < 8) return json(400, { error: 'Пароль: минимум 8 символов' });

  const ph = hashPassword(password);
  try {
    const r = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3::user_role)
       RETURNING id, email, role::text AS role, created_at::text`,
      [email, ph, role]
    );
    return json(201, { user: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return json(409, { error: 'Пользователь уже существует' });
    throw e;
  }
}

module.exports = { handlePostAuthRegister };


const { json } = require('./lib/http');
const { requireUser } = require('./lib/session-auth');

async function handleGetAuthMe(pool, event) {
  const auth = await requireUser(pool, event);
  if (!auth.ok) return json(auth.code, { error: auth.error });
  /** При X-Api-Key + валидном Bearer auth.user — синтетический admin; для UI отдаём реального пользователя из сессии. */
  const user = auth.sessionUser || auth.user;
  return json(200, { user });
}

module.exports = { handleGetAuthMe };


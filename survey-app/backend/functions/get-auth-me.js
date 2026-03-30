const { json } = require('./lib/http');
const { requireUser } = require('./lib/session-auth');

async function handleGetAuthMe(pool, event) {
  const auth = await requireUser(pool, event);
  if (!auth.ok) return json(auth.code, { error: auth.error });
  return json(200, { user: auth.user });
}

module.exports = { handleGetAuthMe };


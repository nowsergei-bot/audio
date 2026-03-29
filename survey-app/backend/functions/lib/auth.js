function getHeader(event, name) {
  const target = name.toLowerCase();
  const h = event.headers || {};
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  const mh = event.multiValueHeaders || {};
  for (const [k, arr] of Object.entries(mh)) {
    if (k.toLowerCase() === target && arr && arr.length) {
      return arr[0];
    }
  }
  return '';
}

function requireApiKey(event) {
  const headers = event.headers || {};
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return { ok: false, error: 'Server misconfiguration: ADMIN_API_KEY' };
  }
  const key = String(getHeader(event, 'X-Api-Key') || getHeader(event, 'x-api-key') || '').trim();
  if (!key || key !== expected) {
    return { ok: false, error: 'Unauthorized' };
  }
  return { ok: true };
}

module.exports = { requireApiKey, getHeader };

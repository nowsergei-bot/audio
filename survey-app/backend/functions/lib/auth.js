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

function isAdminApiKey(event) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  const key = String(getHeader(event, 'X-Api-Key') || getHeader(event, 'x-api-key') || '').trim();
  return Boolean(key && key === expected);
}

function parseBearerToken(event) {
  const raw = String(getHeader(event, 'Authorization') || getHeader(event, 'authorization') || '').trim();
  if (!raw) return '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? String(m[1]).trim() : '';
}

module.exports = { isAdminApiKey, parseBearerToken, getHeader };

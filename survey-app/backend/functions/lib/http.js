const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseBody(event) {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Шлюз иногда подставляет литерал шаблона OpenAPI вместо захваченного пути. */
function isBrokenPathParam(value) {
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (s === '{proxy+}' || s === '{proxy}') return true;
  if (s.includes('{proxy')) return true;
  return false;
}

function pathFromProxyParam(raw) {
  const p = String(raw).replace(/^\/+/, '').replace(/\/$/, '');
  if (!p) return '/';
  const withApi = p.startsWith('api/') || p === 'api' ? p : `api/${p}`;
  return `/${withApi}`;
}

function normalizePath(event) {
  const params = event.pathParameters || {};
  if (params.proxy != null && String(params.proxy).length > 0 && !isBrokenPathParam(params.proxy)) {
    return pathFromProxyParam(params.proxy);
  }
  if (params.path != null && String(params.path).length > 0 && !isBrokenPathParam(params.path)) {
    return pathFromProxyParam(params.path);
  }

  let path =
    event.path ||
    event.requestContext?.http?.path ||
    event.requestContext?.path ||
    event.url ||
    '';
  if (path.includes('?')) path = path.split('?')[0];
  if (path.includes('{proxy+}') || path === '/{proxy}') {
    path = '';
  }

  const h = event.headers || {};
  if (!path && h) {
    const pick = (name) => {
      const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? String(h[key]).split('?')[0] : '';
    };
    path = pick('X-Forwarded-Path') || pick('X-Envoy-Original-Path') || '';
  }

  // Иногда шлюз добавляет префикс этапа: /$default/api/... → оставляем с /api/
  const parts = path.split('/').filter(Boolean);
  const apiAt = parts.indexOf('api');
  if (apiAt >= 0) {
    path = '/' + parts.slice(apiAt).join('/');
  }

  return path.replace(/\/$/, '') || '/';
}

function getMethod(event) {
  const m =
    event.httpMethod ||
    event.requestContext?.httpMethod ||
    event.requestContext?.http?.method ||
    event.requestContext?.requestContext?.httpMethod ||
    'GET';
  return String(m).toUpperCase();
}

module.exports = { json, parseBody, normalizePath, getMethod, CORS_HEADERS };

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
};

/** Ниже лимита ответа API Gateway (иначе часто 502 без JSON). */
const MAX_JSON_BODY_UTF16_UNITS = Math.floor(3.5 * 1024 * 1024);

function json(statusCode, body, extraHeaders = {}) {
  let raw;
  try {
    raw = JSON.stringify(body);
  } catch (err) {
    console.error('[json] stringify failed', err);
    raw = JSON.stringify({
      error: 'serialization_failed',
      message: 'Не удалось сформировать JSON-ответ (слишком большие данные).',
    });
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, ...extraHeaders },
      body: raw,
      isBase64Encoded: false,
    };
  }
  if (raw.length > MAX_JSON_BODY_UTF16_UNITS) {
    raw = JSON.stringify({
      error: 'response_too_large',
      message:
        'Ответ превышает лимит шлюза. На фотостене слишком много или слишком тяжёлые снимки — одобрите меньше или очистите стену в админке.',
    });
    return {
      statusCode: 413,
      headers: { ...CORS_HEADERS, ...extraHeaders },
      body: raw,
      isBase64Encoded: false,
    };
  }
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: raw,
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

function parseQuery(event) {
  const out = {};
  const q = event.queryStringParameters || event.query || null;
  if (q && typeof q === 'object') {
    for (const [k, v] of Object.entries(q)) out[String(k)] = v == null ? '' : String(v);
    return out;
  }
  const raw =
    (event.rawQueryString ? String(event.rawQueryString) : '') ||
    (event.requestContext?.http?.queryString ? String(event.requestContext.http.queryString) : '');
  if (!raw) return out;
  const sp = new URLSearchParams(raw);
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
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

  path = path.replace(/\/$/, '') || '/';
  // Клиент: VITE_API_BASE уже …/api + URL `/api/surveys/…` → шлюз отдаёт /api/api/… — иначе ни один маршрут не совпадает
  while (path.includes('/api/api')) {
    path = path.replace(/\/api\/api/g, '/api');
  }
  return path;
}

function getMethod(event) {
  const m =
    event.httpMethod ||
    event.requestContext?.httpMethod ||
    event.requestContext?.http?.method ||
    event.requestContext?.requestContext?.httpMethod ||
    event.requestContext?.requestContext?.http?.method ||
    'GET';
  // Без trim «POST » / перенос строки от шлюза ломает сравнение method === 'POST'
  return String(m).trim().toUpperCase();
}

module.exports = { json, parseBody, parseQuery, normalizePath, getMethod, CORS_HEADERS };

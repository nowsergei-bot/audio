/**
 * Вызов чат-модели: GigaChat (OAuth + OpenAI-совместимый /chat/completions), OpenAI/OpenRouter, YandexGPT.
 * Сообщения в формате OpenAI: { role: 'system'|'user'|'assistant', content: string }
 */

const crypto = require('crypto');
const dns = require('dns');

/** Снижает «fetch failed» в облаке, когда IPv6 маршрутизируется некорректно (undici/Node). */
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* ignore */
}

function normalizeFetchError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  const c =
    e && typeof e === 'object' && 'cause' in e && e.cause instanceof Error ? ` (${e.cause.message})` : '';
  const s = `${msg}${c}`.trim();
  return s || 'Сетевая ошибка при запросе к API';
}

/** Только GigaChat: при GIGACHAT_TLS_INSECURE=1 — не проверять сертификат (отладка; в проде по возможности не включать). */
let gigaInsecureDispatcher = null;
function gigaFetch(url, init) {
  try {
    const undici = require('undici');
    if (process.env.GIGACHAT_TLS_INSECURE === '1') {
      if (!gigaInsecureDispatcher) {
        gigaInsecureDispatcher = new undici.Agent({ connect: { rejectUnauthorized: false } });
      }
      return undici.fetch(url, { ...init, dispatcher: gigaInsecureDispatcher });
    }
    return undici.fetch(url, init);
  } catch {
    return fetch(url, init);
  }
}

function isOpenAiUnsupportedRegion(status, detail) {
  if (Number(status) !== 403) return false;
  const d = String(detail || '').toLowerCase();
  return (
    d.includes('country') ||
    d.includes('region') ||
    d.includes('territory') ||
    d.includes('not supported') ||
    d.includes('unsupported_country')
  );
}

/** Ответ провайдера по лимиту частоты / квоте (для fallback на другой API). */
function isRateLimitFailure(res) {
  if (!res || res.ok) return false;
  const st = Number(res.status);
  if (st === 429) return true;
  const d = String(res.detail || '');
  return /(^|\s)429(\s|:|$)|rate limit|too many requests|resource_exhausted|quota|лимит/i.test(d);
}

/**
 * Следующая модель в цепочке OPENAI/OpenRouter: 429, лимиты free-tier, часто 403 Forbidden у OpenRouter.
 */
function shouldTryNextOpenAiModel(res) {
  if (!res || res.ok) return false;
  const st = Number(res.status);
  if (st === 429 || st === 402) return true;
  const d = String(res.detail || '').toLowerCase();
  if (/rate limit|too many|quota|free-models|free model|credits|exhausted|resource_exhausted|лимит/i.test(d)) {
    return true;
  }
  if (st === 403) {
    if (/forbidden|free-model|credit|429|quota|limit|add\s+\d+\s+credits/i.test(d)) return true;
    const base = String(process.env.OPENAI_BASE_URL || '').toLowerCase();
    if (base.includes('openrouter')) return true;
  }
  if (st >= 500 && st < 600) return true;
  if (st === 0 && /etimedout|econnreset|timeout|fetch failed/i.test(d)) return true;
  return false;
}

/**
 * Цепочка имён моделей: явная из вызова → OPENAI_MODEL → OPENAI_MODEL_FALLBACKS (через запятую).
 */
function buildOpenAiModelChain(explicitModel) {
  const seen = new Set();
  const out = [];
  const add = (m) => {
    const s = String(m ?? '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  add(explicitModel);
  add(process.env.OPENAI_MODEL);
  const raw = String(process.env.OPENAI_MODEL_FALLBACKS || process.env.LLM_MODEL_FALLBACKS || '').trim();
  for (const part of raw.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) add(part);
  if (out.length === 0) add('gpt-4o-mini');
  return out;
}

/** Убирает BOM/пробелы — частая причина 401 при вставке ключа из консоли. */
function normalizeYandexSecret(raw) {
  let s = String(raw ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r/g, '').trim();
}

function hasYandexLlmCreds() {
  const folder = normalizeYandexSecret(process.env.YANDEX_CLOUD_FOLDER_ID || process.env.YC_FOLDER_ID);
  const key = normalizeYandexSecret(process.env.YANDEX_API_KEY || process.env.YC_API_KEY);
  const iam = normalizeYandexSecret(process.env.YANDEX_IAM_TOKEN || process.env.YC_IAM_TOKEN);
  return Boolean(folder && (key || iam));
}

function normalizeApiKey(raw) {
  let s = String(raw ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r/g, '').trim();
}

/** Ключ авторизации из кабинета GigaChat (Base64 от client_id:client_secret) или пара id+secret. */
function gigaChatAuthorizationHeader() {
  const raw = normalizeApiKey(
    process.env.GIGACHAT_CREDENTIALS || process.env.GIGACHAT_AUTHORIZATION_KEY,
  );
  if (raw) {
    if (raw.toLowerCase().startsWith('basic ')) return raw;
    return `Basic ${raw}`;
  }
  const id = normalizeApiKey(process.env.GIGACHAT_CLIENT_ID);
  const secret = normalizeApiKey(process.env.GIGACHAT_CLIENT_SECRET);
  if (id && secret) {
    return `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`;
  }
  return null;
}

function hasGigaChatCreds() {
  return Boolean(gigaChatAuthorizationHeader());
}

function gigaChatOAuthUrl() {
  return String(process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth').replace(
    /\/$/,
    '',
  );
}

function gigaChatChatBaseUrl() {
  return String(
    process.env.GIGACHAT_CHAT_BASE_URL || 'https://gigachat.devices.sberbank.ru/api/v1',
  ).replace(/\/$/, '');
}

let gigaChatTokenCache = { token: null, expiresAtMs: 0 };

async function getGigaChatAccessToken() {
  const now = Date.now();
  if (gigaChatTokenCache.token && gigaChatTokenCache.expiresAtMs > now + 10_000) {
    return { ok: true, token: gigaChatTokenCache.token };
  }
  const authHeader = gigaChatAuthorizationHeader();
  if (!authHeader) {
    return {
      ok: false,
      kind: 'no_gigachat_key',
      status: 0,
      detail: 'Нет GIGACHAT_CREDENTIALS или GIGACHAT_CLIENT_ID+GIGACHAT_CLIENT_SECRET',
    };
  }
  const rqUid = crypto.randomUUID();
  const scope = String(process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS').trim();
  let r;
  try {
    r = await gigaFetch(gigaChatOAuthUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: rqUid,
        Authorization: authHeader,
      },
      body: `scope=${encodeURIComponent(scope)}`,
    });
  } catch (e) {
    return { ok: false, kind: 'gigachat_oauth_error', status: 0, detail: normalizeFetchError(e) };
  }

  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = await r.json();
      if (typeof errBody?.message === 'string') detail = `${detail}: ${errBody.message}`;
      else if (errBody?.error) detail = `${detail}: ${JSON.stringify(errBody.error)}`;
    } catch {
      /* keep */
    }
    return { ok: false, kind: 'gigachat_oauth_error', status: r.status, detail };
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return { ok: false, kind: 'gigachat_oauth_error', status: 200, detail: normalizeFetchError(e) };
  }
  const token = data.access_token;
  if (!token || typeof token !== 'string') {
    return {
      ok: false,
      kind: 'gigachat_oauth_error',
      status: 200,
      detail: 'Пустой access_token в ответе GigaChat OAuth',
    };
  }

  let expiresAtMs = Date.now() + 25 * 60 * 1000;
  if (typeof data.expires_at === 'number') {
    expiresAtMs = data.expires_at * 1000 - 60_000;
  } else if (typeof data.expires_in === 'number') {
    expiresAtMs = Date.now() + data.expires_in * 1000 - 60_000;
  }
  gigaChatTokenCache = { token, expiresAtMs };
  return { ok: true, token };
}

/**
 * GigaChat — OAuth, затем тот же контракт, что OpenAI /chat/completions.
 * @see https://developers.sber.ru/docs/ru/gigachat/api/overview
 */
async function fetchGigaChatChat(messages, { maxTokens, temperature, jsonObject, model }) {
  const tRes = await getGigaChatAccessToken();
  if (!tRes.ok) return tRes;

  let m = String(model || process.env.GIGACHAT_MODEL || 'GigaChat').trim();
  if (!m || m === 'gpt-4o-mini' || m.startsWith('gpt-') || m.startsWith('@') || m.includes('/')) {
    m = process.env.GIGACHAT_MODEL || 'GigaChat';
  }

  const msgs = messages.map((x) => ({ ...x, content: String(x.content ?? '') }));
  if (jsonObject) {
    const sysJsonHint =
      '\n\nОтветь строго одним JSON-объектом в тексте сообщения, без markdown и без пояснений вокруг.';
    const sysIdx = msgs.findIndex((x) => x.role === 'system');
    if (sysIdx >= 0) {
      msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + sysJsonHint };
    } else {
      msgs.unshift({ role: 'system', content: 'Ты отвечаешь только валидным JSON.' + sysJsonHint });
    }
  }

  const body = {
    model: m,
    messages: msgs,
    max_tokens: Math.min(maxTokens ?? 8192, 8192),
    temperature: temperature ?? 0.25,
  };

  let r;
  try {
    r = await gigaFetch(`${gigaChatChatBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tRes.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, kind: 'gigachat_error', status: 0, detail: normalizeFetchError(e) };
  }

  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = await r.json();
      if (errBody?.error?.message) detail = `${detail}: ${errBody.error.message}`;
      else if (typeof errBody?.message === 'string') detail = `${detail}: ${errBody.message}`;
    } catch {
      /* keep */
    }
    return { ok: false, kind: 'gigachat_error', status: r.status, detail };
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return { ok: false, kind: 'gigachat_error', status: 200, detail: normalizeFetchError(e) };
  }
  const extracted = extractOpenAiStyleAssistantText(data.choices?.[0]?.message);
  if (extracted.refusal) {
    return {
      ok: false,
      kind: 'gigachat_error',
      status: 200,
      detail: `GigaChat отказался ответить: ${extracted.refusal.slice(0, 400)}`,
    };
  }
  if (!extracted.text) {
    return { ok: false, kind: 'gigachat_error', status: 200, detail: 'Пустой ответ GigaChat' };
  }
  return { ok: true, text: extracted.text };
}

function openAiBaseUrl() {
  const raw = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

/** OpenRouter рекомендует HTTP-Referer и X-Title для статистики (необязательно). */
function openRouterExtraHeaders() {
  const base = String(process.env.OPENAI_BASE_URL || '').toLowerCase();
  if (!base.includes('openrouter.ai')) return {};
  const out = {};
  const referer = String(process.env.OPENROUTER_HTTP_REFERER || process.env.PUBLIC_APP_BASE || '').trim();
  if (referer) out['HTTP-Referer'] = referer;
  const title = String(process.env.OPENROUTER_TITLE || process.env.OPENROUTER_APP_NAME || 'Pulse').trim();
  if (title) out['X-Title'] = title;
  return out;
}

/**
 * Человекочитаемое пояснение при геоблоке OpenAI.
 */
function formatGeoBlockHint(status, detail) {
  return [
    'OpenAI не обслуживает запросы из региона, где выполняется ваша Cloud Function (часто так бывает в РФ и в облаке Yandex).',
    '',
    'Что сделать:',
    '1) Подключить GigaChat API: GIGACHAT_CREDENTIALS (или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET) и при необходимости LLM_PROVIDER=gigachat — см. BACKEND_AND_API.md.',
    '2) Подключить YandexGPT: YANDEX_CLOUD_FOLDER_ID и YANDEX_API_KEY (Api-Key СА) или YANDEX_IAM_TOKEN (Bearer).',
    '3) Или направить OpenAI через прокси/Azure: OPENAI_BASE_URL=https://....../v1',
    '',
    `Технически: HTTP ${status} — ${detail}`,
  ].join('\n');
}

function toYandexMessages(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    text: String(m.content ?? ''),
  }));
}

/**
 * Текст ассистента из ответа в стиле OpenAI: content строка или массив { type, text };
 * refusal; иногда пустой content при tool_calls.
 */
function extractOpenAiStyleAssistantText(message) {
  if (!message || typeof message !== 'object') {
    return { text: '', refusal: null, hasToolCalls: false };
  }
  const ref = message.refusal;
  if (typeof ref === 'string' && ref.trim()) {
    return { text: '', refusal: ref.trim(), hasToolCalls: false };
  }
  const c = message.content;
  if (typeof c === 'string') {
    return { text: c.trim(), refusal: null, hasToolCalls: false };
  }
  if (Array.isArray(c)) {
    const parts = [];
    for (const p of c) {
      if (!p || typeof p !== 'object') continue;
      if (typeof p.text === 'string' && p.text) parts.push(p.text);
    }
    return { text: parts.join('').trim(), refusal: null, hasToolCalls: false };
  }
  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return { text: '', refusal: null, hasToolCalls };
}

async function fetchOpenAIChatOnce(messages, { model, maxTokens, temperature, jsonObject }) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return { ok: false, kind: 'no_openai_key', status: 0, detail: 'Нет OPENAI_API_KEY' };

  const url = `${openAiBaseUrl()}/chat/completions`;
  const body = {
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    max_tokens: maxTokens ?? 3500,
    temperature: temperature ?? 0.25,
  };
  if (jsonObject) body.response_format = { type: 'json_object' };

  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...openRouterExtraHeaders(),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, kind: 'openai_error', status: 0, detail: normalizeFetchError(e) };
  }

  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = await r.json();
      if (errBody?.error?.message) detail = `${detail}: ${errBody.error.message}`;
    } catch {
      /* keep */
    }
    return { ok: false, kind: 'openai_error', status: r.status, detail };
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return { ok: false, kind: 'openai_error', status: 200, detail: normalizeFetchError(e) };
  }
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const extracted = extractOpenAiStyleAssistantText(msg);
  if (extracted.refusal) {
    return {
      ok: false,
      kind: 'openai_error',
      status: 200,
      detail: `Модель отказалась ответить: ${extracted.refusal.slice(0, 400)}`,
    };
  }
  if (extracted.hasToolCalls) {
    return {
      ok: false,
      kind: 'openai_error',
      status: 200,
      detail:
        'Модель вернула вызов инструментов вместо текста. Укажите модель без function calling или другой OPENAI_MODEL.',
    };
  }
  const text = extracted.text;
  if (!text) {
    const fr = choice?.finish_reason;
    return {
      ok: false,
      kind: 'openai_error',
      status: 200,
      detail: fr ? `Пустой ответ модели (finish_reason: ${fr})` : 'Пустой ответ модели',
    };
  }
  return { ok: true, text };
}

/** Несколько моделей подряд при лимите/403 у OpenRouter и т.п. */
async function fetchOpenAIChat(messages, opts = {}) {
  const chain = buildOpenAiModelChain(opts.model);
  let last = { ok: false, kind: 'openai_error', status: 0, detail: 'Нет моделей в цепочке' };
  const errors = [];
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    const res = await fetchOpenAIChatOnce(messages, { ...opts, model: m });
    if (res.ok) return res;
    last = res;
    errors.push(`${m}: ${res.detail || res.kind || 'ошибка'}`);
    const tryNext = i < chain.length - 1 && shouldTryNextOpenAiModel(res);
    if (!tryNext) break;
  }
  if (chain.length > 1 && errors.length > 1) {
    last = {
      ...last,
      detail: `Перепробованы модели (${chain.join(' → ')}). Последняя: ${last.detail}\n---\n${errors.join('\n')}`,
    };
  }
  return last;
}

function yandexErrorDetail(status, errBody) {
  let detail = `HTTP ${status}`;
  if (!errBody || typeof errBody !== 'object') return detail;
  if (typeof errBody.message === 'string' && errBody.message.trim()) {
    detail = `${detail}: ${errBody.message}`;
  }
  const grpc = errBody.details?.[0];
  if (grpc && typeof grpc === 'object' && typeof grpc.message === 'string' && grpc.message.trim()) {
    detail = `${detail} (${grpc.message.trim()})`;
  }
  return detail;
}

async function fetchYandexGptChat(messages, { maxTokens, temperature, jsonObject }) {
  const folderId = normalizeYandexSecret(process.env.YANDEX_CLOUD_FOLDER_ID || process.env.YC_FOLDER_ID);
  const apiKey = normalizeYandexSecret(process.env.YANDEX_API_KEY || process.env.YC_API_KEY);
  const iamToken = normalizeYandexSecret(process.env.YANDEX_IAM_TOKEN || process.env.YC_IAM_TOKEN);
  if (!folderId || (!apiKey && !iamToken)) {
    return {
      ok: false,
      kind: 'no_yandex_key',
      status: 0,
      detail: 'Нет YANDEX_CLOUD_FOLDER_ID или пары YANDEX_API_KEY / YANDEX_IAM_TOKEN',
    };
  }

  const modelUri =
    normalizeYandexSecret(process.env.YANDEX_MODEL_URI) || `gpt://${folderId}/yandexgpt/latest`;

  const sysJsonHint = jsonObject
    ? '\n\nОтветь строго одним JSON-объектом в тексте сообщения, без markdown.'
    : '';

  const yandexMessages = toYandexMessages(messages).map((m, i, arr) => {
    if (m.role === 'system' && jsonObject && i === 0) {
      return { ...m, text: m.text + sysJsonHint };
    }
    return m;
  });

  const authHeaders = iamToken
    ? { Authorization: `Bearer ${iamToken}` }
    : { Authorization: `Api-Key ${apiKey}` };

  let r;
  try {
    r = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'x-folder-id': folderId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelUri,
        completionOptions: {
          stream: false,
          temperature: temperature ?? 0.25,
          maxTokens: Math.min(maxTokens ?? 3500, 8000),
        },
        messages: yandexMessages,
      }),
    });
  } catch (e) {
    return { ok: false, kind: 'yandex_error', status: 0, detail: normalizeFetchError(e) };
  }

  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = await r.json();
      detail = yandexErrorDetail(r.status, errBody);
    } catch {
      /* keep */
    }
    if (r.status === 401) {
      detail = [
        detail,
        'Ключ: секрет Api-Key сервисного аккаунта (не JSON ключа и не static access key).',
        'На каталог у СА должна быть роль ai.languageModels.user.',
        'При создании ключа scope: yc.ai.languageModels.execute (как в примерах Yandex Cloud) или yc.ai.foundationModels.execute — смотрите список scope в консоли.',
        'YANDEX_CLOUD_FOLDER_ID = ID того же каталога. Либо YANDEX_IAM_TOKEN (Bearer) вместо Api-Key.',
      ].join(' ');
    }
    return { ok: false, kind: 'yandex_error', status: r.status, detail };
  }

  let data;
  try {
    data = await r.json();
  } catch (e) {
    return { ok: false, kind: 'yandex_error', status: 200, detail: normalizeFetchError(e) };
  }
  const text =
    data.result?.alternatives?.[0]?.message?.text ?? data.result?.alternatives?.[0]?.message?.Text;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, kind: 'yandex_error', status: 200, detail: 'Пустой ответ YandexGPT' };
  }
  return { ok: true, text: text.trim() };
}

async function chatCompletion(messages, opts = {}) {
  try {
    return await runChatCompletion(messages, opts);
  } catch (e) {
    return { ok: false, kind: 'network', status: 0, detail: normalizeFetchError(e) };
  }
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ model?: string, maxTokens?: number, temperature?: number, jsonObject?: boolean }} opts
 */
async function runChatCompletion(messages, opts = {}) {
  const provider = String(process.env.LLM_PROVIDER || 'auto').trim().toLowerCase();
  const tryYandexFirst = provider === 'yandex' || provider === 'yc' || provider === 'yandexgpt';
  const tryGigaChatFirst = provider === 'gigachat' || provider === 'sber';

  if (tryGigaChatFirst) {
    if (!hasGigaChatCreds()) {
      return {
        ok: false,
        kind: 'no_key',
        detail:
          'Задано LLM_PROVIDER=gigachat, но нет GIGACHAT_CREDENTIALS (или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET).',
      };
    }
    const g = await fetchGigaChatChat(messages, opts);
    if (g.ok) return { ...g, provider: 'gigachat' };
    if (isRateLimitFailure(g) && hasYandexLlmCreds()) {
      const y = await fetchYandexGptChat(messages, opts);
      if (y.ok) return { ...y, provider: 'yandex' };
    }
    return g;
  }

  if (tryYandexFirst && hasYandexLlmCreds()) {
    const y = await fetchYandexGptChat(messages, opts);
    if (y.ok) return { ...y, provider: 'yandex' };
    return y;
  }

  if (process.env.OPENAI_API_KEY) {
    const oa = await fetchOpenAIChat(messages, opts);
    if (oa.ok) return { ...oa, provider: 'openai' };
    if (
      provider === 'auto' &&
      isOpenAiUnsupportedRegion(oa.status, oa.detail) &&
      hasYandexLlmCreds()
    ) {
      const y = await fetchYandexGptChat(messages, opts);
      if (y.ok) return { ...y, provider: 'yandex' };
      if (hasGigaChatCreds()) {
        const g = await fetchGigaChatChat(messages, opts);
        if (g.ok) return { ...g, provider: 'gigachat' };
      }
      return {
        ok: false,
        kind: 'both_failed',
        detail: `${formatGeoBlockHint(oa.status, oa.detail)}\n\nЗатем YandexGPT: ${y.detail}`,
        status: oa.status,
      };
    }
    if (provider === 'auto' && hasGigaChatCreds()) {
      const g = await fetchGigaChatChat(messages, opts);
      if (g.ok) return { ...g, provider: 'gigachat' };
    }
    /**
     * Любая неуспешная попытка OpenRouter/OpenAI после GigaChat: пробуем YandexGPT
     * (раньше Yandex вызывался только при 429 — из‑за этого при 401/5xx оставалась только эвристика на клиенте).
     */
    if (provider === 'auto' && hasYandexLlmCreds()) {
      const y = await fetchYandexGptChat(messages, opts);
      if (y.ok) return { ...y, provider: 'yandex' };
    }
    return { ...oa, provider: 'openai' };
  }

  if (hasGigaChatCreds()) {
    const g = await fetchGigaChatChat(messages, opts);
    if (g.ok) return { ...g, provider: 'gigachat' };
    if (isRateLimitFailure(g) && hasYandexLlmCreds()) {
      const y = await fetchYandexGptChat(messages, opts);
      if (y.ok) return { ...y, provider: 'yandex' };
    }
    return g;
  }

  if (hasYandexLlmCreds()) {
    const y = await fetchYandexGptChat(messages, opts);
    return y.ok ? { ...y, provider: 'yandex' } : y;
  }

  return {
    ok: false,
    kind: 'no_key',
    detail:
      'Нет ключа LLM: задайте GIGACHAT_CREDENTIALS (GigaChat API), или OPENAI_API_KEY (в т.ч. OpenRouter), или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY. См. BACKEND_AND_API.md.',
  };
}

module.exports = {
  chatCompletion,
  isOpenAiUnsupportedRegion,
  formatGeoBlockHint,
  hasYandexLlmCreds,
  hasGigaChatCreds,
  isRateLimitFailure,
};

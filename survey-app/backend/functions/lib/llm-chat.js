/**
 * Вызов чат-модели: DeepSeek (OpenAI-совместимый API), OpenAI, YandexGPT.
 * Сообщения в формате OpenAI: { role: 'system'|'user'|'assistant', content: string }
 */

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

function hasDeepSeekKey() {
  return Boolean(normalizeApiKey(process.env.DEEPSEEK_API_KEY));
}

/**
 * DeepSeek — тот же контракт, что OpenAI /chat/completions.
 * @see https://api-docs.deepseek.com/
 */
async function fetchDeepSeekChat(messages, { maxTokens, temperature, jsonObject, model }) {
  const key = normalizeApiKey(process.env.DEEPSEEK_API_KEY);
  if (!key) {
    return { ok: false, kind: 'no_deepseek_key', status: 0, detail: 'Нет DEEPSEEK_API_KEY' };
  }

  let m = String(model || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  if (!m || m === 'gpt-4o-mini' || m.startsWith('gpt-')) {
    m = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  }

  const url = 'https://api.deepseek.com/v1/chat/completions';
  const body = {
    model: m,
    messages,
    max_tokens: Math.min(maxTokens ?? 8192, 8192),
    temperature: temperature ?? 0.25,
  };
  if (jsonObject) body.response_format = { type: 'json_object' };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const errBody = await r.json();
      if (errBody?.error?.message) detail = `${detail}: ${errBody.error.message}`;
    } catch {
      /* keep */
    }
    return { ok: false, kind: 'deepseek_error', status: r.status, detail };
  }

  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, kind: 'deepseek_error', status: 200, detail: 'Пустой ответ DeepSeek' };
  }
  return { ok: true, text: text.trim() };
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
    '1) Подключить DeepSeek (из РФ): DEEPSEEK_API_KEY с platform.deepseek.com и LLM_PROVIDER=deepseek.',
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

async function fetchOpenAIChat(messages, { model, maxTokens, temperature, jsonObject }) {
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

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...openRouterExtraHeaders(),
    },
    body: JSON.stringify(body),
  });

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

  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, kind: 'openai_error', status: 200, detail: 'Пустой ответ модели' };
  }
  return { ok: true, text: text.trim() };
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

  const r = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
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

  const data = await r.json();
  const text =
    data.result?.alternatives?.[0]?.message?.text ?? data.result?.alternatives?.[0]?.message?.Text;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, kind: 'yandex_error', status: 200, detail: 'Пустой ответ YandexGPT' };
  }
  return { ok: true, text: text.trim() };
}

/**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ model?: string, maxTokens?: number, temperature?: number, jsonObject?: boolean }} opts
 */
async function chatCompletion(messages, opts = {}) {
  const provider = String(process.env.LLM_PROVIDER || 'auto').trim().toLowerCase();
  const tryYandexFirst = provider === 'yandex' || provider === 'yc' || provider === 'yandexgpt';
  const tryDeepSeekFirst = provider === 'deepseek' || provider === 'deepseek-ai';

  if (tryDeepSeekFirst) {
    if (!hasDeepSeekKey()) {
      return {
        ok: false,
        kind: 'no_key',
        detail: 'Задано LLM_PROVIDER=deepseek, но нет DEEPSEEK_API_KEY (ключ с platform.deepseek.com).',
      };
    }
    const d = await fetchDeepSeekChat(messages, opts);
    return d.ok ? { ...d, provider: 'deepseek' } : d;
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
      if (hasDeepSeekKey()) {
        const d = await fetchDeepSeekChat(messages, opts);
        if (d.ok) return { ...d, provider: 'deepseek' };
      }
      return {
        ok: false,
        kind: 'both_failed',
        detail: `${formatGeoBlockHint(oa.status, oa.detail)}\n\nЗатем YandexGPT: ${y.detail}`,
        status: oa.status,
      };
    }
    if (provider === 'auto' && hasDeepSeekKey()) {
      const d = await fetchDeepSeekChat(messages, opts);
      if (d.ok) return { ...d, provider: 'deepseek' };
    }
    return { ...oa, provider: 'openai' };
  }

  if (hasDeepSeekKey()) {
    const d = await fetchDeepSeekChat(messages, opts);
    if (d.ok) return { ...d, provider: 'deepseek' };
    return d;
  }

  if (hasYandexLlmCreds()) {
    const y = await fetchYandexGptChat(messages, opts);
    return y.ok ? { ...y, provider: 'yandex' } : y;
  }

  return {
    ok: false,
    kind: 'no_key',
    detail:
      'Нет ключа LLM: задайте DEEPSEEK_API_KEY (DeepSeek), или OPENAI_API_KEY, или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY. Для дашборда Excel: LLM_PROVIDER=deepseek и DEEPSEEK_API_KEY — см. BACKEND_AND_API.md.',
  };
}

module.exports = {
  chatCompletion,
  isOpenAiUnsupportedRegion,
  formatGeoBlockHint,
  hasYandexLlmCreds,
  hasDeepSeekKey,
};

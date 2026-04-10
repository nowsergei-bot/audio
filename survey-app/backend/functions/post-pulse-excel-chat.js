const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');
const { isTransientLlmDetail } = require('./lib/llm-transient');

function normalizeChatMessages(body) {
  const raw = body && Array.isArray(body.messages) ? body.messages : [];
  const out = [];
  for (const m of raw) {
    const role = m && (m.role === 'user' || m.role === 'assistant') ? m.role : null;
    const content = String(m?.content ?? '').trim();
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, 12000) });
  }
  return out.slice(-14);
}

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

const LLM_RATE_LIMIT_RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(res) {
  if (!res || res.ok) return false;
  const st = Number(res.status);
  if (st === 429) return true;
  const d = String(res.detail || '');
  return /(^|\s)429(\s|:|$)|rate limit|too many requests|resource_exhausted/i.test(d);
}

/**
 * Санитизация apply_filters: только известные ключи и значения из facetOptions.
 */
function sanitizeApplyFilters(applyFilters, facetOptions) {
  if (!applyFilters || typeof applyFilters !== 'object') return null;
  const out = {};
  const opts = facetOptions && typeof facetOptions === 'object' ? facetOptions : {};
  for (const [key, vals] of Object.entries(applyFilters)) {
    if (!Array.isArray(vals) || !opts[key]) continue;
    const allowed = new Set((opts[key] || []).map((x) => String(x)));
    const picked = vals.map((v) => String(v)).filter((v) => allowed.has(v));
    if (picked.length) out[key] = picked;
  }
  return Object.keys(out).length ? out : null;
}

const PULSE_NETWORK_RETRIES = 3;

async function fetchPulseReplyOnce(context, messages) {
  const facetJson = JSON.stringify(context.facetOptions || {}).slice(0, 120000);
  const labelsJson = JSON.stringify(context.facetLabels || {}).slice(0, 8000);
  const currentJson = JSON.stringify(context.currentFilters || {}).slice(0, 16000);
  const summary = truncate(context.numericSummary || '', 14000);
  const extra = truncate(context.extraContext || '', 8000);

  const system = `Ты «ПУЛЬС» — ассистент директора по наблюдениям из Excel (уроки, наставники, оценки).
Отвечай только по-русски.
Тебе передают JSON с доступными значениями фильтров (facetOptions): для каждого ключа только те значения, которые сочетаются с уже выбранными фильтрами по другим колонкам (логическая цепочка среза). Подбирай срез только из этих строк.
Текущие выбранные фильтры: currentFilters (null по ключу = все значения в этом измерении).
Краткая сводка по цифрам: numericSummary.

ОБЯЗАТЕЛЬНО ответь одним JSON-объектом со схемой:
{
  "reply": "развёрнутый ответ: что попало в выборку, средние по пунктам, по наставникам если уместно, выводы",
  "apply_filters": null | { "ключ_фильтра": ["значение1", ...] }
}
Правила для apply_filters:
- Если пользователь просит сузить выборку (например «география в 7 классах») — заполни только те ключи, которые есть в facetOptions, значениями ТОЛЬКО из списков facetOptions.
- Если нужно «все 7 классы» — включи все строки, где в названии класса есть 7 (если такие есть в facetOptions.filter_class или аналоге).
- Если срез не нужен или неясно — apply_filters: null.
- Не выдумывай значения: только из facetOptions.

Без markdown-кода вокруг JSON. Только валидный JSON.`;

  const userContextBlock = `[ДАННЫЕ ДАШБОРДА]
facetLabels: ${labelsJson}
facetOptions: ${facetJson}
currentFilters: ${currentJson}
numericSummary:
${summary}
${extra ? `\nдополнительно:\n${extra}` : ''}`;

  const apiMessages = [
    { role: 'system', content: `${system}\n\n[АКТУАЛЬНЫЕ ДАННЫЕ — на каждый запрос]\n${userContextBlock}` },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    let res = await chatCompletion(apiMessages, {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: 3500,
      temperature: 0.25,
      jsonObject: true,
    });
    for (let attempt = 0; attempt < LLM_RATE_LIMIT_RETRIES && !res.ok && isRateLimitError(res); attempt++) {
      const waitMs = 2500 * 2 ** attempt;
      await sleep(waitMs);
      res = await chatCompletion(apiMessages, {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 3500,
        temperature: 0.25,
        jsonObject: true,
      });
    }
    if (!res.ok) {
      if (res.kind === 'no_key') return { kind: 'no_key' };
      let detail =
        res.kind === 'both_failed'
          ? res.detail
          : isOpenAiUnsupportedRegion(res.status, res.detail)
            ? formatGeoBlockHint(res.status, res.detail)
            : res.detail;
      if (isRateLimitError(res)) {
        detail = [
          'Провайдер временно ограничил частоту запросов (HTTP 429). Подождите 1–2 минуты и повторите запрос; при частых обращениях проверьте тариф и квоту API.',
          '',
          String(detail || '').trim(),
        ]
          .filter(Boolean)
          .join('\n');
      }
      return { kind: 'openai_error', detail };
    }
    const parsed = tryParseLlmJsonObject(res.text);
    if (!parsed) {
      return { kind: 'openai_error', detail: 'Ответ не JSON (модель не вернула объект { reply, apply_filters })' };
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) return { kind: 'openai_error', detail: 'В JSON нет поля reply' };
    const apply = sanitizeApplyFilters(parsed.apply_filters, context.facetOptions);
    return { kind: 'ok', reply, apply_filters: apply };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function fetchPulseReply(context, messages) {
  let last;
  for (let attempt = 0; attempt < PULSE_NETWORK_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1600 * attempt);
    last = await fetchPulseReplyOnce(context, messages);
    if (last.kind === 'ok' || last.kind === 'no_key') return last;
    if (last.kind === 'openai_error') {
      if (!isTransientLlmDetail(last.detail) || attempt === PULSE_NETWORK_RETRIES - 1) return last;
    } else {
      return last;
    }
  }
  return last;
}

async function handlePostPulseExcelChat(_pool, event) {
  const body = parseBody(event) || {};
  const messages = normalizeChatMessages(body);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(400, { error: 'Нужен хотя бы один вопрос (messages заканчивается на role=user).' });
  }

  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (context.facetOptions == null || typeof context.facetOptions !== 'object') {
    return json(400, { error: 'Нужен context.facetOptions (объект; может быть пустым).' });
  }

  const llm = await fetchPulseReply(context, messages);
  if (llm.kind === 'ok') {
    return json(200, {
      source: 'llm',
      reply: llm.reply,
      apply_filters: llm.apply_filters,
    });
  }

  const lastQ = messages[messages.length - 1].content;
  const pre =
    llm.kind === 'no_key'
      ? 'ПУЛЬС недоступен: задайте GIGACHAT_CREDENTIALS (или GIGACHAT_CLIENT_ID + GIGACHAT_CLIENT_SECRET) и при необходимости LLM_PROVIDER=gigachat, или OPENAI_API_KEY, или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY. Подробнее — BACKEND_AND_API.md.\n\n'
      : `${llm.detail}\n\n`;

  return json(200, {
    source: 'error_fallback',
    reply:
      pre +
      'Пока можно сузить данные вручную в блоке «Фильтры» под дашбордом. Ваш запрос: «' +
      truncate(lastQ, 500) +
      '».',
    apply_filters: null,
  });
}

module.exports = { handlePostPulseExcelChat };

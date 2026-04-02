const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');

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

async function fetchPulseReply(context, messages) {
  const facetJson = JSON.stringify(context.facetOptions || {}).slice(0, 120000);
  const labelsJson = JSON.stringify(context.facetLabels || {}).slice(0, 8000);
  const currentJson = JSON.stringify(context.currentFilters || {}).slice(0, 16000);
  const summary = truncate(context.numericSummary || '', 14000);
  const extra = truncate(context.extraContext || '', 8000);

  const system = `Ты «ПУЛЬС» — ассистент директора по наблюдениям из Excel (уроки, наставники, оценки).
Отвечай только по-русски.
Тебе передают JSON с доступными значениями фильтров (facetOptions) — это точные строки из таблицы. Подбирай срез только из этих строк.
Текущие выбранные фильтры: currentFilters (null по ключу = все значения).
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
    const res = await chatCompletion(apiMessages, {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: 3500,
      temperature: 0.25,
      jsonObject: true,
    });
    if (!res.ok) {
      if (res.kind === 'no_key') return { kind: 'no_key' };
      const detail =
        res.kind === 'both_failed'
          ? res.detail
          : isOpenAiUnsupportedRegion(res.status, res.detail)
            ? formatGeoBlockHint(res.status, res.detail)
            : res.detail;
      return { kind: 'openai_error', detail };
    }
    let parsed;
    try {
      parsed = JSON.parse(res.text.trim());
    } catch {
      return { kind: 'openai_error', detail: 'Ответ не JSON' };
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) return { kind: 'openai_error', detail: 'В JSON нет поля reply' };
    const apply = sanitizeApplyFilters(parsed.apply_filters, context.facetOptions);
    return { kind: 'ok', reply, apply_filters: apply };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
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
      ? 'ПУЛЬС недоступен: задайте в функции OPENAI_API_KEY или пару YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY (YandexGPT из РФ). Подробнее — BACKEND_AND_API.md.\n\n'
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

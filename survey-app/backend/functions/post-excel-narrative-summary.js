const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

async function fetchNarrativeFromLlm(context) {
  const summary = truncate(context.numericSummary || '', 16000);
  const extra = truncate(context.extraContext || '', 10000);
  const labels = truncate(JSON.stringify(context.facetLabels || {}), 6000);

  const system = `Ты — аналитик для директора школы. Ниже дана **машинная сводка** по одной выборке из Excel (наблюдения за уроками, опросы, наставники).
Перепиши её **связным текстом на русском** для руководителя: 2–6 абзацев, ясный стиль, без markdown и без таблиц.

Жёсткие правила:
- **Не добавляй** факты, цифры, имена и выводы, которых нет во входном тексте.
- **Сохрани** все числовые значения и смыслы; можно сгруппировать и переформулировать.
- Не выдумывай причин и «корреляции», если их нет во входе.
- Объём сопоставим с входом или чуть больше, не более ~900 слов.

Ответь ОДНИМ JSON-объектом: {"narrative":"..."} — в narrative только готовый текст. Без markdown вокруг JSON.`;

  const userBlock = `[МАШИННАЯ СВОДКА — единственный источник фактов]
${summary}
${extra ? `\n[ДОПОЛНИТЕЛЬНО — средние по наставникам и пунктам]\n${extra}` : ''}
${labels && labels !== '{}' ? `\n[Подписи фильтров для контекста]\n${labels}` : ''}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userBlock },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 2800,
        temperature: 0.35,
        jsonObject: true,
      },
    );
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
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
    if (!narrative || narrative.length < 40) {
      return { kind: 'openai_error', detail: 'В JSON нет поля narrative или текст слишком короткий' };
    }
    return { kind: 'ok', narrative: narrative.slice(0, 12000) };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelNarrativeSummary(_pool, event) {
  const body = parseBody(event) || {};
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const numericSummary = String(context.numericSummary ?? '').trim();
  if (!numericSummary) {
    return json(400, { error: 'Нужен context.numericSummary (непустая строка).' });
  }

  const llm = await fetchNarrativeFromLlm(context);
  if (llm.kind === 'ok') {
    return json(200, { source: 'llm', narrative: llm.narrative });
  }

  return json(200, {
    source: 'fallback',
    narrative: null,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM: задайте OPENAI_API_KEY или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY (см. BACKEND_AND_API.md).'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelNarrativeSummary };

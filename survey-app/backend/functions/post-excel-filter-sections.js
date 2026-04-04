const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * @param {unknown} raw
 * @param {string[]} allowedKeysOrdered — порядок сохраняем для «прочих»
 */
function sanitizeSections(raw, allowedKeysOrdered) {
  const allowed = new Set(allowedKeysOrdered);
  const placed = new Set();
  const out = [];
  let sid = 0;
  const arr = Array.isArray(raw) ? raw : [];
  for (const sec of arr) {
    const title =
      typeof sec?.title === 'string' ? sec.title.trim().slice(0, 100).replace(/\s+/g, ' ') : '';
    const keysIn = Array.isArray(sec?.keys) ? sec.keys : [];
    const keys = [];
    for (const k of keysIn) {
      const key = String(k ?? '').trim();
      if (!key || !allowed.has(key) || placed.has(key)) continue;
      placed.add(key);
      keys.push(key);
    }
    if (!title || !keys.length) continue;
    out.push({ id: `ai-${sid}`, title, keys });
    sid += 1;
  }
  const missing = allowedKeysOrdered.filter((k) => !placed.has(k));
  if (missing.length) {
    out.push({ id: `ai-${sid}`, title: 'Прочее', keys: missing });
  }
  return out;
}

async function fetchLayoutFromLlm(columns, filterKeys) {
  const colsJson = JSON.stringify(columns).slice(0, 24000);

  const system = `Ты помогаешь строить панель фильтров для дашборда «Наблюдения из Excel» (школа: уроки, наставники, классы, предметы, опросы).
По списку колонок-фильтров с примерами значений предложи логичные РАЗДЕЛЫ (группы) для боковой панели.

Ответь ОДНИМ JSON-объектом:
{ "sections": [ { "title": "краткий заголовок раздела по-русски", "keys": ["ключ1", "ключ2"] } ] }

Правила:
- Каждый "key" в sections.keys должен быть ТОЧНО одним из переданных filterKey (строка совпадает символ в символ).
- Каждый filterKey должен встретиться ровно один раз во всех sections.keys.
- 2–6 разделов; объединяй смыслово близкие поля (например класс + параллель + предмет в один блок, если уместно).
- Заголовки разделов — понятные директору (2–5 слов).
- Без markdown, только валидный JSON.`;

  const user = `filterKeys (все обязательны в ответе, в таком порядке удобно группировать соседние): ${JSON.stringify(filterKeys)}
columns (контекст):
${colsJson}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 1200,
        temperature: 0.2,
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
    const parsed = tryParseLlmJsonObject(res.text);
    if (!parsed) {
      return { kind: 'openai_error', detail: 'Ответ не JSON' };
    }
    const sections = sanitizeSections(parsed?.sections, filterKeys);
    if (!sections.length) {
      return { kind: 'openai_error', detail: 'Пустая схема разделов' };
    }
    return { kind: 'ok', sections };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelFilterSections(_pool, event) {
  const body = parseBody(event) || {};
  const filterKeys = Array.isArray(body.filterKeys)
    ? body.filterKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];
  if (!filterKeys.length) {
    return json(400, { error: 'Нужен непустой массив filterKeys.' });
  }

  const rawCols = Array.isArray(body.columns) ? body.columns : [];
  const columns = [];
  for (const c of rawCols) {
    if (!c || typeof c !== 'object') continue;
    const filterKey = String(c.filterKey ?? c.key ?? '').trim();
    if (!filterKeys.includes(filterKey)) continue;
    const samples = Array.isArray(c.samples)
      ? c.samples.map((s) => truncate(String(s ?? ''), 120)).filter(Boolean).slice(0, 14)
      : [];
    columns.push({
      filterKey,
      role: truncate(String(c.role ?? ''), 48),
      roleLabel: truncate(String(c.roleLabel ?? ''), 80),
      header: truncate(String(c.header ?? filterKey), 120),
      samples,
    });
  }

  const llm = await fetchLayoutFromLlm(columns, filterKeys);
  if (llm.kind === 'ok') {
    return json(200, { source: 'llm', sections: llm.sections });
  }

  return json(200, {
    source: 'fallback',
    sections: null,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM — используйте стандартную группировку на клиенте или задайте DeepSeek / OpenAI / YandexGPT (см. BACKEND_AND_API.md).'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelFilterSections };

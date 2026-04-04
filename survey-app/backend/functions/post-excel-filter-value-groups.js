const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * @param {unknown} rawGroups
 * @param {string[]} allValues — эталонный список (каскадный срез)
 */
function sanitizeValueGroups(rawGroups, allValues) {
  const allowed = new Set(allValues);
  const placed = new Set();
  const out = [];
  const arr = Array.isArray(rawGroups) ? rawGroups : [];
  let sid = 0;
  for (const g of arr) {
    const label =
      typeof g?.label === 'string' ? g.label.trim().slice(0, 100).replace(/\s+/g, ' ') : '';
    const valsIn = Array.isArray(g?.values) ? g.values : [];
    const vals = [];
    for (const v of valsIn) {
      const s = String(v ?? '').trim();
      if (!s || !allowed.has(s) || placed.has(s)) continue;
      placed.add(s);
      vals.push(s);
    }
    if (!label || !vals.length) continue;
    out.push({ id: `g-${sid}`, label, values: vals });
    sid += 1;
  }
  const missing = allValues.filter((v) => !placed.has(v));
  if (missing.length) {
    out.push({ id: `g-${sid}`, label: 'Остальное', values: missing });
  }
  return out.length ? out : null;
}

async function fetchGroupsFromLlm(header, values) {
  const headerLine = truncate(header, 200);
  const listJson = JSON.stringify(values);

  const system = `Ты помогаешь директору школы разобрать список РАЗЛИЧНЫХ строк из одной колонки Excel (классы, группы, уровни, семинары).
Сгруппируй строки по смыслу для боковой панели фильтров:
- объединяй очевидные варианты одного смысла (разный регистр: 7ABE и 7abe; латиница/кириллица где очевидно);
- вынеси «семинары», «год обучения», DO/дошкольные в отдельные группы если они выбиваются;
- не объединяй разные классы без оснований.

Ответь ОДНИМ JSON:
{ "groups": [ { "label": "краткий заголовок группы на русском (2–8 слов)", "values": ["строка из входа", ...] } ] }

Каждая строка из входного массива должна встретиться РОВНО ОДИН раз в каком-то values[] — посимвольно как во входе. Не добавляй новых строк.`;

  const user = `Заголовок колонки: ${headerLine}\nЗначения (JSON-массив):\n${listJson}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 4000,
        temperature: 0.15,
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
    if (!parsed) return { kind: 'openai_error', detail: 'Ответ не JSON' };
    const groups = sanitizeValueGroups(parsed.groups, values);
    if (!groups) return { kind: 'openai_error', detail: 'Пустая группировка' };
    return { kind: 'ok', groups };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelFilterValueGroups(_pool, event) {
  const body = parseBody(event) || {};
  const filterKey = String(body.filterKey ?? '').trim();
  const header = String(body.header ?? filterKey).trim() || filterKey;
  const rawVals = Array.isArray(body.values) ? body.values : [];
  const values = [...new Set(rawVals.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, 200);

  if (!filterKey) {
    return json(400, { error: 'Нужен filterKey.' });
  }
  if (values.length < 6) {
    return json(400, { error: 'Нужно минимум 6 различных значений для смысловой группировки.' });
  }

  const llm = await fetchGroupsFromLlm(header, values);
  if (llm.kind === 'ok') {
    return json(200, { source: 'llm', filterKey, groups: llm.groups });
  }

  return json(200, {
    source: 'fallback',
    filterKey,
    groups: null,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM (DeepSeek / OpenAI / YandexGPT).'
        : truncate(llm.detail, 800),
  });
}

module.exports = { handlePostExcelFilterValueGroups };

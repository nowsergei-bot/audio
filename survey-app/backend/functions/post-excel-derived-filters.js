const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * @param {unknown} rawDims
 * @param {string[]} values
 */
function sanitizeDimensions(rawDims, values) {
  const arr = Array.isArray(rawDims) ? rawDims : [];
  const out = [];
  for (const d of arr.slice(0, 5)) {
    const title =
      typeof d?.title === 'string' ? d.title.trim().slice(0, 100).replace(/\s+/g, ' ') : '';
    const assignIn = d?.assignments && typeof d.assignments === 'object' ? d.assignments : {};
    const assignments = {};
    for (const v of values) {
      const g = assignIn[v];
      const gl = g != null ? String(g).trim().slice(0, 80).replace(/\s+/g, ' ') : '';
      assignments[v] = gl || 'Прочее';
    }
    if (!title) continue;
    out.push({ title, assignments });
  }
  return out.length ? out : null;
}

async function fetchFromLlm(sourceHeader, values) {
  const headerLine = truncate(sourceHeader, 200);
  const listJson = JSON.stringify(values);

  const system = `Ты помогаешь директору школы строить дополнительные измерения для фильтрации дашборда (уроки, анкеты, Excel).
По списку РАЗЛИЧНЫХ значений одной колонки (коды педагогов, группы, метки классов и т.д.) предложи 1–3 НОВЫХ смысловых измерения.
Примеры: для кодов педагогов — «Кафедра / блок» (иностранные языки, русский и литература, STEM…); для классов — «Ступень» (начальная / средняя).

Ответь ОДНИМ JSON:
{ "dimensions": [ { "title": "краткое название измерения на русском (2–8 слов)", "assignments": { "каждое значение из входа": "метка группы 2–6 слов на русском" } } ] }

Правила:
- Каждое значение из входного массива должно быть ключом в assignments КАЖДОГО измерения (посимвольно как во входе).
- Не добавляй ключей, которых нет во входе.
- 1–3 элемента в dimensions; заголовки не дублируй по смыслу.`;

  const user = `Заголовок исходной колонки: ${headerLine}\nЗначения (JSON-массив, все должны войти в assignments):\n${listJson}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 8000,
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
    if (!parsed) return { kind: 'openai_error', detail: 'Ответ не JSON' };
    const dimensions = sanitizeDimensions(parsed?.dimensions, values);
    if (!dimensions) return { kind: 'openai_error', detail: 'Пустая схема измерений' };
    return { kind: 'ok', dimensions };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelDerivedFilters(_pool, event) {
  const body = parseBody(event) || {};
  const sourceFilterKey = String(body.sourceFilterKey ?? '').trim();
  const sourceHeader = String(body.sourceHeader ?? sourceFilterKey).trim() || sourceFilterKey;
  const rawVals = Array.isArray(body.values) ? body.values : [];
  const values = [...new Set(rawVals.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, 220);

  if (!sourceFilterKey) {
    return json(400, { error: 'Нужен sourceFilterKey.' });
  }
  if (values.length < 4) {
    return json(400, {
      error: 'Нужно минимум 4 различных значения в колонке для смысловой группировки.',
    });
  }

  const r = await fetchFromLlm(sourceHeader, values);
  if (r.kind === 'no_key') {
    return json(503, { error: 'LLM недоступен (нет ключа).' });
  }
  if (r.kind === 'openai_error') {
    return json(502, { error: r.detail || 'Ошибка LLM' });
  }
  return json(200, { source: 'llm', dimensions: r.dimensions, hint: null });
}

module.exports = { handlePostExcelDerivedFilters };

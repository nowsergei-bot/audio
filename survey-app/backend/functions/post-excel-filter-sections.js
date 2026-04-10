const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/**
 * @param {unknown} raw
 * @param {string[]} orderedKeysAll — структурные + выбранные ИИ опросные; каждый ровно раз в sections
 */
function sanitizeSections(raw, orderedKeysAll) {
  const allowed = new Set(orderedKeysAll);
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
  const missing = orderedKeysAll.filter((k) => !placed.has(k));
  if (missing.length) {
    out.push({ id: `ai-${sid}`, title: 'Прочее', keys: missing });
  }
  return out;
}

/**
 * @param {string[]} surveyPick
 * @param {string[]} surveyCandidateKeys
 */
function normalizeSurveyPick(surveyPickRaw, surveyCandidateKeys) {
  const cand = new Set(surveyCandidateKeys);
  if (!Array.isArray(surveyPickRaw)) return [...surveyCandidateKeys];
  const seen = new Set();
  const out = [];
  for (const k of surveyPickRaw) {
    const key = String(k ?? '').trim();
    if (!key || !cand.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

async function fetchLayoutFromLlm(columns, structuralKeys, surveyCandidateKeys) {
  const colsJson = JSON.stringify(columns).slice(0, 24000);

  const system = `Ты помогаешь строить панель фильтров для дашборда «Наблюдения из Excel» (школа: уроки, наставники, опросы).

Вход: structuralKeys (обязательные фильтры — класс, предмет и т.д.), surveyCandidateKeys (кандидаты из граф опроса).
Твоя задача:
1) Выбрать surveyFilterKeys — ПОДМНОЖЕСТВО surveyCandidateKeys: только столбцы с короткими категориальными ответами (чекбоксы, шкалы, числа-коды, метки из списка).
2) ИСКЛЮЧИТЬ из surveyFilterKeys всё, что по сэмплам похоже на свободный текст: длинные абзацы, общие выводы, рекомендации учителю, комментарии «как в эссе», уникальные развёрнутые ответы.
3) Если сомневаешься — не включай столбец в surveyFilterKeys (лучше меньше фильтров, чем мусор).

Ответь ОДНИМ JSON-объектом:
{
  "surveyFilterKeys": ["__pulse_survey_col_N", ...],
  "sections": [ { "title": "краткий заголовок раздела по-русски", "keys": ["ключ1", "ключ2"] } ]
}

Правила sections:
- Объедини structuralKeys и выбранные surveyFilterKeys: множество всех ключей в sections.keys = ровно structuralKeys ∪ surveyFilterKeys (каждый ключ один раз на всю схему).
- Каждый "key" в sections.keys — ТОЧНО одна строка из этого объединения.
- 2–7 разделов; смыслово близкие поля в один блок.
- Заголовки — понятные директору (2–5 слов).
- Без markdown, только валидный JSON.`;

  const user = `structuralKeys: ${JSON.stringify(structuralKeys)}
surveyCandidateKeys: ${JSON.stringify(surveyCandidateKeys)}
columns (роль, заголовок, примеры значений):
${colsJson}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 1600,
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
    const surveyPick = normalizeSurveyPick(parsed.surveyFilterKeys, surveyCandidateKeys);
    const orderedKeysAll = [...structuralKeys, ...surveyPick];
    const sections = sanitizeSections(parsed?.sections, orderedKeysAll);
    if (!sections.length) {
      return { kind: 'openai_error', detail: 'Пустая схема разделов' };
    }
    return { kind: 'ok', sections, surveyFilterKeys: surveyPick };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelFilterSections(_pool, event) {
  const body = parseBody(event) || {};

  const structuralKeys = Array.isArray(body.structuralKeys)
    ? body.structuralKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];
  const surveyCandidateKeys = Array.isArray(body.surveyCandidateKeys)
    ? body.surveyCandidateKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];

  const legacyFilterKeys = Array.isArray(body.filterKeys)
    ? body.filterKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
    : [];

  let sKeys = structuralKeys;
  let candKeys = surveyCandidateKeys;
  if (!sKeys.length && !candKeys.length && legacyFilterKeys.length) {
    sKeys = legacyFilterKeys;
  }
  if (!sKeys.length && !candKeys.length) {
    return json(400, { error: 'Нужны structuralKeys/surveyCandidateKeys или legacy filterKeys.' });
  }

  const unionKeys = [...new Set([...sKeys, ...candKeys])];
  const rawCols = Array.isArray(body.columns) ? body.columns : [];
  const columns = [];
  for (const c of rawCols) {
    if (!c || typeof c !== 'object') continue;
    const filterKey = String(c.filterKey ?? c.key ?? '').trim();
    if (!unionKeys.includes(filterKey)) continue;
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

  if (!candKeys.length) {
    const orderedKeysAll = [...sKeys];
    const sections = sanitizeSections(
      [{ title: 'Фильтры', keys: orderedKeysAll }],
      orderedKeysAll,
    );
    return json(200, {
      source: 'no_survey_candidates',
      sections,
      surveyFilterKeys: [],
    });
  }

  const llm = await fetchLayoutFromLlm(columns, sKeys, candKeys);
  if (llm.kind === 'ok') {
    return json(200, {
      source: 'llm',
      sections: llm.sections,
      surveyFilterKeys: llm.surveyFilterKeys,
    });
  }

  const fallbackSurvey = [...candKeys];
  const orderedFallback = [...sKeys, ...fallbackSurvey];
  const sections = sanitizeSections(
    [{ title: 'Фильтры', keys: orderedFallback }],
    orderedFallback,
  );

  return json(200, {
    source: 'fallback',
    sections,
    surveyFilterKeys: fallbackSurvey,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM в среде функции — задайте OPENAI_API_KEY + при OpenRouter OPENAI_BASE_URL=https://openrouter.ai/api/v1, или GIGACHAT_CREDENTIALS (GigaChat API), или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY; создайте новую версию. Иначе — показаны все кандидаты опроса без отбора ИИ. См. BACKEND_AND_API.md.'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelFilterSections };

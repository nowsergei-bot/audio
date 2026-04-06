const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

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

function sanitizeCanonicalMap(parsed, valuesList) {
  const obj =
    parsed && typeof parsed.canonicalMap === 'object'
      ? parsed.canonicalMap
      : parsed && typeof parsed.mapping === 'object'
        ? parsed.mapping
        : {};
  const out = {};
  for (const raw of valuesList) {
    const r = String(raw);
    const c = obj[r];
    out[r] = typeof c === 'string' && c.trim() ? c.trim().slice(0, 200) : r;
  }
  return out;
}

function sanitizeHierarchy(parsed, valuesList) {
  const allowed = new Set(valuesList.map(String));
  const rawGroups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  const out = [];
  let gid = 0;
  const placed = new Set();
  for (const g of rawGroups) {
    const label = typeof g?.label === 'string' ? g.label.trim().slice(0, 120) : '';
    const parentId =
      g?.parentId == null || g.parentId === '' ? null : String(g.parentId).trim().slice(0, 64);
    const valsIn = Array.isArray(g?.values) ? g.values : [];
    const values = [];
    for (const v of valsIn) {
      const s = String(v ?? '').trim();
      if (!s || !allowed.has(s) || placed.has(s)) continue;
      placed.add(s);
      values.push(s);
    }
    if (!label || !values.length) continue;
    const id = typeof g?.id === 'string' && g.id.trim() ? g.id.trim().slice(0, 64) : `g-${gid++}`;
    out.push({ id, label, parentId, values });
  }
  const orphans = valuesList.map(String).filter((v) => !placed.has(v));
  if (orphans.length) {
    out.push({ id: 'ungrouped', label: 'Прочее', parentId: null, values: orphans });
  }
  return out;
}

async function runLlmJson(system, user, maxTokens = 1800) {
  const res = await chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens,
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
  return { kind: 'ok', parsed };
}

async function actionNormalizeValues(body) {
  const filterKey = String(body.filterKey ?? '').trim();
  const header = truncate(body.header, 200);
  const values = Array.isArray(body.values) ? body.values.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  if (!filterKey || values.length < 2) {
    return json(400, { error: 'Нужны filterKey и values (минимум 2 строки).' });
  }
  const uniq = [...new Set(values)].slice(0, 400);
  const system = `Ты нормализуешь подписи значений фильтра дашборда школьных наблюдений (Excel).
Ответь одним JSON: { "canonicalMap": { "как в данных": "каноническая метка", ... } }
Правила:
- Каждый ключ canonicalMap — ТОЧНО одна строка из переданного списка values (символ в символ).
- Объединяй синонимы, опечатки, разный регистр, варианты с « // English» — в одну короткую русскую метку.
- Если значение уже нормально — маппинг на само себя.
Только JSON.`;
  const user = `filterKey: ${filterKey}\nheader: ${header}\nvalues: ${JSON.stringify(uniq)}`;
  const llm = await runLlmJson(system, user, 2400);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      canonicalMap: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM в функции.' : truncate(llm.detail, 800),
    });
  }
  const canonicalMap = sanitizeCanonicalMap(llm.parsed, uniq);
  return json(200, { source: 'llm', canonicalMap });
}

async function actionValueHierarchy(body) {
  const filterKey = String(body.filterKey ?? '').trim();
  const header = truncate(body.header, 200);
  const values = Array.isArray(body.values) ? body.values.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  if (!filterKey || values.length < 4) {
    return json(400, { error: 'Нужны filterKey и values (минимум 4 строки).' });
  }
  const uniq = [...new Set(values)].slice(0, 220);
  const system = `Ты строишь иерархию/умные группы значений одного фильтра (школа, наблюдения).
Ответь JSON: { "groups": [ { "id": "краткий_id", "label": "заголовок группы", "parentId": null или id родителя, "values": ["строка из входного списка", ...] } ] }
Правила:
- Каждое значение из входного списка попадает ровно в одну группу values.
- parentId ссылается на id другой группы или null для корня.
- 2–12 групп верхнего уровня; вложенность 1–2 уровня.
Только JSON.`;
  const user = `filterKey: ${filterKey}\nheader: ${header}\nvalues: ${JSON.stringify(uniq)}`;
  const llm = await runLlmJson(system, user, 2800);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      groups: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM в функции.' : truncate(llm.detail, 800),
    });
  }
  const groups = sanitizeHierarchy(llm.parsed, uniq);
  return json(200, { source: 'llm', groups });
}

async function actionNlSlice(body) {
  const query = String(body.query ?? '').trim();
  if (!query) return json(400, { error: 'Нужен query.' });
  const facetOptions = body.facetOptions && typeof body.facetOptions === 'object' ? body.facetOptions : {};
  const facetLabels = body.facetLabels && typeof body.facetLabels === 'object' ? body.facetLabels : {};
  const currentFilters =
    body.currentFilters && typeof body.currentFilters === 'object' ? body.currentFilters : {};
  const system = `Ты переводишь запрос методиста на язык фильтров дашборда Excel (уроки, наставники, классы).
Ответь JSON: { "reply": "кратко что сделано", "apply_filters": null | { "ключ": ["значение", ...] } }
Значения только из переданных списков facetOptions. Не выдумывай ключи и строки.
Только JSON.`;
  const user = `Запрос: ${query.slice(0, 2000)}
facetLabels: ${truncate(JSON.stringify(facetLabels), 6000)}
facetOptions: ${truncate(JSON.stringify(facetOptions), 100000)}
currentFilters: ${truncate(JSON.stringify(currentFilters), 8000)}`;
  const llm = await runLlmJson(system, user, 2000);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      reply: null,
      apply_filters: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM в функции.' : truncate(llm.detail, 800),
    });
  }
  const reply = typeof llm.parsed.reply === 'string' ? llm.parsed.reply.trim() : '';
  const apply = sanitizeApplyFilters(llm.parsed.apply_filters, facetOptions);
  return json(200, { source: 'llm', reply: reply || 'Готово.', apply_filters: apply });
}

async function actionExplainSlice(body) {
  const snapshot = Array.isArray(body.filterSnapshot) ? body.filterSnapshot : [];
  const kpi = body.kpi && typeof body.kpi === 'object' ? body.kpi : {};
  const numericHint = truncate(body.numericSummary ?? '', 12000);
  const system = `Ты кратко объясняешь активный срез данных дашборда наблюдений (директору).
2–5 предложений по-русски: что отобрано, объём выборки, на что обратить внимание. Без выдуманных цифр сверх переданных.
Ответь JSON: { "explanation": "..." }`;
  const user = `Фильтры:\n${snapshot.map((x) => `- ${x.label}: ${x.value}`).join('\n').slice(0, 8000)}
KPI: ${JSON.stringify(kpi)}
Сводка цифр:\n${numericHint || '—'}`;
  const llm = await runLlmJson(system, user, 900);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      explanation: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM в функции.' : truncate(llm.detail, 800),
    });
  }
  const explanation =
    typeof llm.parsed.explanation === 'string' ? llm.parsed.explanation.trim().slice(0, 4000) : '';
  return json(200, { source: 'llm', explanation: explanation || null });
}

async function actionChartInterpret(body) {
  const title = truncate(body.chartTitle ?? 'График', 200);
  const series = Array.isArray(body.series) ? body.series : [];
  const system = `Ты интерпретируешь уже посчитанные агрегаты графика (школа). 2–4 предложения по-русски, без новых чисел.
Ответь JSON: { "insight": "..." }`;
  const user = `Заголовок: ${title}\nРяд (метка → значение): ${truncate(JSON.stringify(series.slice(0, 80)), 24000)}`;
  const llm = await runLlmJson(system, user, 800);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      insight: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM.' : truncate(llm.detail, 800),
    });
  }
  const insight = typeof llm.parsed.insight === 'string' ? llm.parsed.insight.trim().slice(0, 3000) : '';
  return json(200, { source: 'llm', insight: insight || null });
}

async function actionChartAnomalies(body) {
  const aggregates = Array.isArray(body.aggregates) ? body.aggregates : [];
  const system = `Ты ищешь аномалии и необычные паттерны в таблице агрегатов дашборда. Только по переданным числам.
Ответь JSON: { "bullets": ["строка 1", "строка 2", ...] } — 0–5 пунктов по-русски.`;
  const user = truncate(JSON.stringify(aggregates.slice(0, 120)), 28000);
  const llm = await runLlmJson(system, user, 900);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      bullets: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM.' : truncate(llm.detail, 800),
    });
  }
  const bullets = Array.isArray(llm.parsed.bullets)
    ? llm.parsed.bullets.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return json(200, { source: 'llm', bullets });
}

async function actionChartSpec(body) {
  const query = String(body.query ?? '').trim();
  if (!query) return json(400, { error: 'Нужен query.' });
  const allowedKeys = Array.isArray(body.filterKeys) ? body.filterKeys.map((x) => String(x ?? '').trim()) : [];
  const metricLabels = Array.isArray(body.metricLabels) ? body.metricLabels : [];
  const system = `Ты подсказываешь, какой блок дашборда смотреть под запрос методиста.
Ответь JSON:
{
  "recommendation": "1–3 предложения по-русски",
  "focusFilterKey": null или один из allowedKeys,
  "focusMetricLabel": null или одна из metricLabels (точное совпадение строки)
}
Только JSON.`;
  const user = `Запрос: ${query.slice(0, 2000)}
allowedFilterKeys: ${JSON.stringify(allowedKeys)}
metricLabels: ${JSON.stringify(metricLabels.map((x) => String(x).slice(0, 120)))}`;
  const llm = await runLlmJson(system, user, 700);
  if (llm.kind !== 'ok') {
    return json(200, {
      source: 'error',
      recommendation: null,
      focusFilterKey: null,
      focusMetricLabel: null,
      hint: llm.kind === 'no_key' ? 'Нет ключа LLM.' : truncate(llm.detail, 800),
    });
  }
  let focusFilterKey = llm.parsed.focusFilterKey;
  focusFilterKey =
    typeof focusFilterKey === 'string' && allowedKeys.includes(focusFilterKey) ? focusFilterKey : null;
  let focusMetricLabel = llm.parsed.focusMetricLabel;
  const mls = metricLabels.map((x) => String(x));
  focusMetricLabel =
    typeof focusMetricLabel === 'string' && mls.includes(focusMetricLabel) ? focusMetricLabel : null;
  const recommendation =
    typeof llm.parsed.recommendation === 'string' ? llm.parsed.recommendation.trim().slice(0, 2000) : '';
  return json(200, {
    source: 'llm',
    recommendation: recommendation || null,
    focusFilterKey,
    focusMetricLabel,
  });
}

async function handlePostExcelDashboardAi(_pool, event) {
  const body = parseBody(event) || {};
  const action = String(body.action ?? '').trim();
  switch (action) {
    case 'normalize_values':
      return actionNormalizeValues(body);
    case 'value_hierarchy':
      return actionValueHierarchy(body);
    case 'nl_slice':
      return actionNlSlice(body);
    case 'explain_slice':
      return actionExplainSlice(body);
    case 'chart_interpret':
      return actionChartInterpret(body);
    case 'chart_anomalies':
      return actionChartAnomalies(body);
    case 'chart_spec':
      return actionChartSpec(body);
    default:
      return json(400, {
        error:
          'Неизвестный action. Допустимо: normalize_values, value_hierarchy, nl_slice, explain_slice, chart_interpret, chart_anomalies, chart_spec.',
      });
  }
}

module.exports = { handlePostExcelDashboardAi };

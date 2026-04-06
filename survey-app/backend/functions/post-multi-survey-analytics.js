const { json, parseBody } = require('./lib/http');
const { fetchResultsSnapshot } = require('./get-results');
const { truncate } = require('./lib/insight-dashboard');
const { buildTextCorpusForLlm } = require('./lib/llm-text-digest');
const { buildHeuristicNarrative } = require('./lib/heuristic-narrative');
const { chatCompletion } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

const MAX_SURVEYS = 10;
const CHART_TYPES = new Set(['radio', 'checkbox', 'scale', 'rating', 'date']);

function stripTrailingRecommendation(text) {
  const paras = String(text || '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length <= 1) return text;
  const last = paras[paras.length - 1];
  if (/^Рекомендация:/i.test(last)) return paras.slice(0, -1).join('\n\n');
  return text;
}

function questionRef(surveyId, questionId) {
  return `${surveyId}_Q${questionId}`;
}

function compactOneSurvey(snapshot, textBudget) {
  const text_corpus = buildTextCorpusForLlm(snapshot.questions || [], {
    maxTotalChars: Math.max(1200, textBudget),
  });
  return {
    survey_id: snapshot.survey.id,
    title: snapshot.survey.title,
    total: snapshot.total_responses,
    questions: (snapshot.questions || []).map((q) => {
      const dist = q.distribution || [];
      const sum = dist.reduce((a, d) => a + d.count, 0) || 0;
      const top3 =
        dist.length > 0 && sum > 0
          ? [...dist]
              .sort((a, b) => b.count - a.count)
              .slice(0, 3)
              .map((d) => ({
                label: truncate(String(d.label), 120),
                count: d.count,
                pct: Math.round((d.count / sum) * 1000) / 10,
              }))
          : null;
      return {
        ref: questionRef(snapshot.survey.id, q.question_id),
        id: q.question_id,
        type: q.type,
        text: truncate(q.text, 200),
        n: q.response_count,
        avg: q.average,
        min: q.min,
        max: q.max,
        top3,
      };
    }),
    text_corpus: text_corpus.length ? text_corpus : undefined,
  };
}

function buildQuestionsCatalog(snapshots, maxText = 220) {
  const catalog = [];
  for (const s of snapshots) {
    const sid = s.survey.id;
    for (const q of s.questions || []) {
      const dist = q.distribution || [];
      const sum = dist.reduce((a, d) => a + d.count, 0) || 0;
      const top3 =
        dist.length > 0 && sum > 0
          ? [...dist]
              .sort((a, b) => b.count - a.count)
              .slice(0, 3)
              .map((d) => ({
                label: truncate(String(d.label), 90),
                count: d.count,
                pct: Math.round((d.count / sum) * 1000) / 10,
              }))
          : null;
      catalog.push({
        ref: questionRef(sid, q.question_id),
        survey_id: sid,
        survey_title: truncate(s.survey.title, 100),
        question_id: q.question_id,
        type: q.type,
        text: truncate(q.text, maxText),
        n: q.response_count,
        avg: q.average ?? undefined,
        min: q.min ?? undefined,
        max: q.max ?? undefined,
        top3,
        chartable: CHART_TYPES.has(q.type) && (q.response_count || 0) > 0,
      });
    }
  }
  return catalog;
}

function findQuestionInSnapshots(snapshots, surveyId, questionId) {
  const s = snapshots.find((x) => Number(x.survey.id) === Number(surveyId));
  if (!s) return null;
  const q = (s.questions || []).find((x) => Number(x.question_id) === Number(questionId));
  if (!q) return null;
  return { survey: s.survey, question: q };
}

function parseRef(ref) {
  const m = /^(\d+)_Q(\d+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  return { surveyId: Number(m[1]), questionId: Number(m[2]) };
}

function pickHeuristicHighlights(snapshots, limit = 8) {
  const out = [];
  const seen = new Set();
  const candidates = [];
  for (const s of snapshots) {
    for (const q of s.questions || []) {
      if (!CHART_TYPES.has(q.type) || (q.response_count || 0) < 1) continue;
      candidates.push({ survey: s.survey, question: q, n: q.response_count });
    }
  }
  candidates.sort((a, b) => b.n - a.n);
  for (const c of candidates) {
    const k = `${c.survey.id}_${c.question.question_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      survey_id: c.survey.id,
      survey_title: c.survey.title,
      question: c.question,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function resolveHighlightFromRefs(snapshots, keyChartRefs) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(keyChartRefs) ? keyChartRefs : [];
  for (const item of list) {
    const ref = typeof item === 'string' ? item : item && item.ref;
    const why = typeof item === 'object' && item && item.why_visual ? String(item.why_visual) : '';
    const parsed = parseRef(ref);
    if (!parsed) continue;
    const found = findQuestionInSnapshots(snapshots, parsed.surveyId, parsed.questionId);
    if (!found) continue;
    const { survey, question } = found;
    if (!CHART_TYPES.has(question.type) || (question.response_count || 0) < 1) continue;
    const k = `${survey.id}_${question.question_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      survey_id: survey.id,
      survey_title: survey.title,
      question,
      chart_rationale: why ? truncate(why, 280) : undefined,
    });
  }
  return out;
}

/** Дополняет выбор модели топовыми графиками по объёму ответов, без дубликатов, не больше maxTotal. */
function mergeHighlightsWithHeuristic(snapshots, existing, maxTotal = 8) {
  const have = [...existing];
  const seen = new Set(have.map((h) => `${h.survey_id}_${h.question.question_id}`));
  const extra = pickHeuristicHighlights(snapshots, 48);
  for (const e of extra) {
    if (have.length >= maxTotal) break;
    const k = `${e.survey_id}_${e.question.question_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    have.push({ ...e });
  }
  return have.slice(0, maxTotal);
}

function normalizeMergedThemes(raw, catalogRefSet) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((t) => {
      const refs = (Array.isArray(t.refs) ? t.refs : [])
        .map((r) => String(r).trim())
        .filter((r) => catalogRefSet.has(r))
        .slice(0, 16);
      return {
        theme_title: truncate(String(t.theme_title || ''), 200),
        refs,
        synthesis: truncate(String(t.synthesis || ''), 2500),
        takeaway: truncate(String(t.takeaway || ''), 600),
      };
    })
    .filter((t) => t.theme_title && (t.refs.length > 0 || t.synthesis));
}

function normalizeSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({
      heading: truncate(String(s.heading || '').trim(), 140),
      body: truncate(String(s.body || '').trim(), 4500),
    }))
    .filter((s) => s.heading && s.body);
}

function buildMultiHeuristicNarrative(snapshots) {
  if (!snapshots.length) return 'Выберите хотя бы один опрос.';
  const grand = snapshots.reduce((a, s) => a + (Number(s.total_responses) || 0), 0);
  const intro = `Сравнительная сводка по ${snapshots.length} ${snapshots.length === 1 ? 'опросу' : 'опросам'}; всего заполненных анкет: ${grand}. Ниже — кратко по каждому опросу (автоматический разбор по структуре анкеты).`;
  const blocks = [];
  for (const s of snapshots) {
    const h = buildHeuristicNarrative(s);
    const body = stripTrailingRecommendation(h);
    blocks.push(`«${s.survey.title}» — ${s.total_responses} анкет\n\n${body}`);
  }
  const outro =
    'Рекомендация: сопоставьте приоритетные темы между опросами, отметьте общие закономерности и расхождения и выберите 1–2 направления для обсуждения с командой.';
  return [intro, ...blocks, outro].join('\n\n');
}

async function fetchLlmMultiStructured(compactSurveys, catalog) {
  const chartableRefs = catalog.filter((c) => c.chartable).map((c) => c.ref);
  const messages = [
    {
      role: 'system',
      content: `Ты — ведущий аналитик, который готовит материал уровня слайдов McKinsey / Genspark: ясные выводы, объединение смысла, минимум «пересказа таблицы».

Верни строго один JSON-объект (без markdown, без текста до или после).

Схема:
{
  "sections": [
    { "heading": "строка", "body": "2–6 предложений: причины, следствия, что делать; не ограничивайся перечислением процентов" }
  ],
  "merged_themes": [
    {
      "theme_title": "строка",
      "refs": ["surveyId_QquestionId", "..."],
      "synthesis": "общий смысл по объединённым вопросам",
      "takeaway": "одно практическое предложение"
    }
  ],
  "key_chart_refs": [
    { "ref": "surveyId_QquestionId", "why_visual": "зачем читателю смотреть эту диаграмму" }
  ]
}

Правила:
- sections: 4–7 блоков; повествование по ВСЕЙ совокупности волн опросов, а не отдельный абзац на каждый опрос, если нет явного контраста.
- merged_themes: 5–12 тем; в refs только вопросы с похожим смыслом (объединяй формулировки разных волн).
- key_chart_refs: 5–8 штук; используй ТОЛЬКО ref из поля chartable каталога (chartable=true). Выбирай те графики, которые лучше всего подкрепляют твою линию рассуждения, а не просто с максимальным n.
- Не выдумывай ref — только из переданного questions_catalog.
- Язык: русский. Не упоминай JSON, ИИ, модель, нейросеть.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        instruction:
          'Каталог вопросов с ref, типом, текстом, n, top3, avg и флагом chartable. Сводка по опросам — поле surveys_summary.',
        surveys_summary: compactSurveys,
        questions_catalog: catalog,
        chartable_refs_hint: chartableRefs.slice(0, 60),
      }),
    },
  ];

  const llm = await chatCompletion(messages, {
    jsonObject: true,
    maxTokens: 5500,
    temperature: 0.28,
  });

  if (!llm.ok) {
    return { ok: false, kind: llm.kind, detail: llm.detail };
  }

  const obj = tryParseLlmJsonObject(llm.text);
  if (!obj) {
    return { ok: false, kind: 'parse_json_failed', detail: 'Не удалось разобрать JSON ответа модели' };
  }
  return { ok: true, data: obj };
}

function heuristicFallbackExplanation(llmRes, source) {
  if (source !== 'heuristic_multi') return null;
  if (!llmRes.ok) {
    const k = llmRes.kind;
    if (k === 'no_key') {
      return {
        code: 'no_key',
        hint_ru:
          'На функции не настроен LLM: задайте в окружении Serverless-функции хотя бы один вариант — DEEPSEEK_API_KEY (часто с LLM_PROVIDER=deepseek), или OPENAI_API_KEY, или пару YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY / YANDEX_IAM_TOKEN. См. BACKEND_AND_API.md.',
      };
    }
    if (k === 'parse_json_failed') {
      return {
        code: 'parse_json_failed',
        hint_ru:
          'Модель ответила, но ответ не удалось разобрать как JSON. Повторите «Построить сводку» или смените модель/провайдера (LLM_PROVIDER, DEEPSEEK_MODEL, OPENAI_MODEL).',
      };
    }
    return {
      code: k || 'llm_error',
      hint_ru: `Запрос к LLM не удался: ${String(llmRes.detail || k || 'ошибка').slice(0, 420)}`,
    };
  }
  return {
    code: 'no_narrative_blocks',
    hint_ru:
      'Модель вернула ответ, но без заполненных секций текста и без пригодных тем/графиков после проверки — показана автосводка. Попробуйте ещё раз или другую модель.',
  };
}

async function handlePostMultiSurveyAnalytics(pool, event, canAccessSurvey) {
  const body = parseBody(event) || {};
  const rawIds = body.survey_ids;
  if (!Array.isArray(rawIds)) {
    return json(400, { error: 'Ожидается массив survey_ids' });
  }
  const ids = [...new Set(rawIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) {
    return json(400, { error: 'Нужен хотя бы один корректный id опроса' });
  }
  if (ids.length > MAX_SURVEYS) {
    return json(400, { error: `Не более ${MAX_SURVEYS} опросов за один запрос` });
  }

  for (const id of ids) {
    const ok = await canAccessSurvey(id);
    if (ok === null) {
      return json(404, {
        error: 'survey_not_found',
        message: `Опрос с id ${id} не найден в базе или у аккаунта нет к нему доступа.`,
      });
    }
    if (!ok) return json(403, { error: 'Forbidden' });
  }

  const snapshotsRaw = await Promise.all(
    ids.map((id) =>
      fetchResultsSnapshot(pool, id, {
        forPublicApi: false,
        skipCharts: true,
        skipWordCloud: true,
      }),
    ),
  );
  const snapshots = [];
  for (let i = 0; i < ids.length; i++) {
    const snap = snapshotsRaw[i];
    if (!snap) return json(404, { error: `Опрос ${ids[i]} не найден` });
    snapshots.push(snap);
  }

  const surveys = snapshots.map((s) => ({
    id: s.survey.id,
    title: s.survey.title,
    status: s.survey.status,
    total_responses: s.total_responses,
    question_count: (s.questions || []).length,
  }));
  const grand_total_responses = surveys.reduce((a, row) => a + row.total_responses, 0);

  const perSurveyTextBudget = Math.floor(12000 / Math.max(1, snapshots.length));
  const compact = snapshots.map((s) => compactOneSurvey(s, perSurveyTextBudget));
  const catalog = buildQuestionsCatalog(snapshots, 150);
  const catalogRefSet = new Set(catalog.map((c) => c.ref));

  let narrative = buildMultiHeuristicNarrative(snapshots);
  let source = 'heuristic_multi';
  let narrative_sections = [];
  let merged_themes = [];
  let highlight_questions = pickHeuristicHighlights(snapshots, 8);

  const llmRes = await fetchLlmMultiStructured(compact, catalog);
  if (llmRes.ok && llmRes.data) {
    const d = llmRes.data;
    narrative_sections = normalizeSections(d.sections);
    merged_themes = normalizeMergedThemes(d.merged_themes, catalogRefSet);

    const fromModel = resolveHighlightFromRefs(snapshots, d.key_chart_refs);
    highlight_questions = mergeHighlightsWithHeuristic(snapshots, fromModel, 8);

    if (narrative_sections.length > 0) {
      narrative = narrative_sections.map((s) => `${s.heading}\n\n${s.body}`).join('\n\n');
      source = 'llm_multi';
    } else if (merged_themes.length > 0 || fromModel.length > 0) {
      source = 'llm_multi_partial';
    }
  }

  const llm_fallback = heuristicFallbackExplanation(llmRes, source);

  return json(200, {
    source,
    narrative,
    narrative_sections,
    merged_themes,
    highlight_questions,
    surveys,
    grand_total_responses,
    llm_fallback,
  });
}

module.exports = { handlePostMultiSurveyAnalytics, MAX_SURVEYS };

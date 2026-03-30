const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchResultsSnapshot } = require('./get-results');
const { normalizeFiltersFromBody, resolveFilteredResponseIds } = require('./lib/response-filters');
const { buildHeuristicDashboard, truncate } = require('./lib/insight-dashboard');
const { buildTextCorpusForLlm } = require('./lib/llm-text-digest');
const { buildInsightRelations } = require('./lib/insight-relations');
const { buildHeuristicNarrative } = require('./lib/heuristic-narrative');

async function fetchLlmNarrative(snapshot) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const text_corpus = buildTextCorpusForLlm(snapshot.questions || []);

  const compact = {
    title: snapshot.survey.title,
    total: snapshot.total_responses,
    questions: snapshot.questions.map((q) => ({
      id: q.question_id,
      type: q.type,
      text: truncate(q.text, 200),
      n: q.response_count,
      avg: q.average,
      top:
        q.distribution?.length > 0
          ? [...q.distribution].sort((a, b) => b.count - a.count)[0]
          : null,
    })),
    text_corpus:
      text_corpus.length > 0
        ? text_corpus
        : undefined,
  };

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Ты аналитик опросов. Пиши только по-русски. Форматируй как короткую записку с заголовками.\n' +
          'Структура ответа:\n' +
          '1) «Выводы» — 5–10 пунктов, обязательно раздели на «Положительные» и «Зоны внимания/отрицательные».\n' +
          '2) «По цифрам» — 2–4 тезиса по шкалам/рейтингам/распределениям.\n' +
          '2) Если в JSON есть блок text_corpus — обязательно отдельный раздел «Темы из развёрнутых ответов»: ' +
          'выдели 5–10 самых важных смысловых линий, типичные жалобы и пожелания; можно короткие обобщения, ' +
          'не пересказывай каждый фрагмент. Не выдумывай того, чего нет в выборке.\n' +
          '3) «Рекомендации» — 3–6 конкретных действий, что улучшить/что усилить.\n' +
          '4) Итог: 1–2 предложения с приоритетом действий для организатора.\n' +
          'Без вводных про нейросеть и ИИ. Опирайся только на данные JSON.',
      },
      {
        role: 'user',
        content: `Сделай аналитическую записку по опросу. Данные (JSON):\n${JSON.stringify(compact)}`,
      },
    ],
    max_tokens: 1400,
    temperature: 0.35,
  };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function handlePostAiInsights(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const filters = normalizeFiltersFromBody(body);

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });

  let responseIds;
  if (filters.length) {
    const resolved = await resolveFilteredResponseIds(pool, surveyId, survey.questions, filters);
    responseIds = resolved === null ? undefined : resolved;
  }

  const snapshot = await fetchResultsSnapshot(pool, surveyId, { forPublicApi: false, responseIds });
  if (!snapshot) return json(404, { error: 'Not found' });

  const dashboard = buildHeuristicDashboard(snapshot);
  const relations = await buildInsightRelations(pool, surveyId, snapshot.survey.questions || [], {
    responseIds,
  });
  let narrative = buildHeuristicNarrative(snapshot);
  let source = 'heuristic';

  if (process.env.OPENAI_API_KEY) {
    const llm = await fetchLlmNarrative(snapshot);
    if (llm) {
      narrative = llm;
      source = 'llm_hybrid';
    }
  }

  return json(200, {
    source,
    dashboard,
    relations,
    narrative,
    survey: snapshot.survey,
    total_responses: snapshot.total_responses,
  });
}

module.exports = { handlePostAiInsights };

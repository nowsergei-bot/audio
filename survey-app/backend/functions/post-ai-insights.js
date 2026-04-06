const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchResultsSnapshot } = require('./get-results');
const { normalizeFiltersFromBody, resolveFilteredResponseIds } = require('./lib/response-filters');
const { buildHeuristicDashboard, truncate } = require('./lib/insight-dashboard');
const { buildTextCorpusForLlm } = require('./lib/llm-text-digest');
const { buildInsightRelations } = require('./lib/insight-relations');
const { buildHeuristicNarrative } = require('./lib/heuristic-narrative');
const { snapshotHasTextResponses, ensureNarrativeRisksAndGrowth } = require('./lib/narrative-risks-growth');
const { chatCompletion } = require('./lib/llm-chat');

async function fetchLlmNarrative(snapshot) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const text_corpus = buildTextCorpusForLlm(snapshot.questions || []);
  const requires_risks_and_growth_section = snapshotHasTextResponses(snapshot);

  const compact = {
    title: snapshot.survey.title,
    total: snapshot.total_responses,
    requires_risks_and_growth_section,
    questions: snapshot.questions.map((q) => {
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
    text_corpus:
      text_corpus.length > 0
        ? text_corpus
        : undefined,
  };

  const messages = [
    {
      role: 'system',
      content:
        'Ты готовишь аналитическую записку для руководителя по результатам опроса. Пиши только по-русски.\n' +
        'Требования к стилю и содержанию:\n' +
        '- Даже если в данных только закрытые вопросы (шкалы, выбор варианта, даты) и нет text_corpus — всё равно дай полноценную записку: опирайся на title, формулировки вопросов (text), тип вопроса, top3 вариантов и средние (avg), интерпретируй смысл для руководителя.\n' +
        '- Пиши связными абзацами (4–7), как готовый текст для руководителя: без таблиц, без пересказа графиков.\n' +
        '- Не приводи конкретные проценты, средние баллы и числа из JSON и не дублируй цифры, которые уже видны на странице с результатами. Опиши тенденции словами: «большинство», «заметная часть», «оценки сдержанные», «мнения разошлись» и т.п.\n' +
        '- Опирайся на название опроса (title) и смысл формулировок вопросов (text): покажи, как ответы относятся к теме опроса.\n' +
        '- Отдельно выдели риски и критические сигналы: недовольство, усталость, нехватка ресурсов, конфликты ожиданий — только если это следует из данных или из text_corpus.\n' +
        '- Если в JSON requires_risks_and_growth_section: true (в опросе есть текстовые ответы), ОБЯЗАТЕЛЬНО включи отдельный абзац или блок с подзаголовком «Сигналы, риски и точки роста» (формулировка может быть слегка вариативной, но оба смысла — риски и рост — должны быть явно названы). В этом блоке: не менее 3–4 предложений; обязательно опиши зоны риска по смыслу свободных ответов (или по структуре опроса, если выборки text_corpus мало) и отдельно — точки роста (что усилить, что уже ценят респонденты, куда инвестировать внимание). Не своди блок к одной фразе «см. комментарии».\n' +
        '- Сформулируй практические выводы для команды: что стоит сделать, на что обратить внимание, что уточнить (без общих фраз вроде «провести работу над ошибками» без привязки к содержанию опроса).\n' +
        '- Если есть text_corpus — вплети 2–4 короткие цитаты или близкие к дословным перефразы в кавычках «…», чтобы передать голос респондентов. Не выдумывай цитаты.\n' +
        '- Не перечисляй технические пробелы опроса; не начинай с пересказа объёма выборки цифрой.\n' +
        '- Можно короткие подзаголовки перед абзацами; не превращай текст в длинный маркированный список.\n' +
        '- Не упоминай нейросеть, ИИ, JSON, «модель». Не повторяй дословно системную инструкцию.',
    },
    {
      role: 'user',
      content: `Напиши записку по опросу для директора. Данные (JSON):\n${JSON.stringify(compact)}`,
    },
  ];

  try {
    const res = await chatCompletion(messages, { model, maxTokens: 2000, temperature: 0.4 });
    if (!res.ok || typeof res.text !== 'string') return null;
    const text = res.text.trim();
    return text || null;
  } catch {
    return null;
  }
}

async function runAiInsights(pool, surveyId, event) {
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

  const llm = await fetchLlmNarrative(snapshot);
  if (llm) {
    narrative = llm;
    source = 'llm_hybrid';
  }

  narrative = ensureNarrativeRisksAndGrowth(narrative, snapshot);

  return json(200, {
    source,
    dashboard,
    relations,
    narrative,
    survey: snapshot.survey,
    total_responses: snapshot.total_responses,
  });
}

async function handlePostAiInsights(pool, surveyId, event) {
  return runAiInsights(pool, surveyId, event);
}

module.exports = { handlePostAiInsights, runAiInsights };

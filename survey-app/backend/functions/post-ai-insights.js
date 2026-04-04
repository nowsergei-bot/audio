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

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Ты готовишь короткую аналитическую записку для руководителя по результатам опроса. Пиши только по-русски.\n' +
          'Требования к стилю:\n' +
          '- Пиши связными абзацами (3–6 абзацев), как живой текст для чтения, а не набор обезличенных маркеров.\n' +
          '- В первом абзаце кратко сформулируй главный смысл: что в целом говорят ответы о восприятии темы опроса (по цифрам и формулировкам вопросов из JSON).\n' +
          '- Обязательно ссылайся на конкретные формулировки вопросов (поле text) и цифры: средние по шкалам, доли top3, число анкет total.\n' +
          '- Не начинай с банальностей вроде «собрано N анкет — можно смотреть тенденции»; число респондентов вплети естественно в контекст вывода.\n' +
          '- Не перечисляй технические пробелы («один вопрос без ответов»), если это не меняет смысл; не заполняй текст шаблонными фразами.\n' +
          '- Если есть text_corpus — отдельным абзацем опиши смысловые линии свободных ответов (жалобы, пожелания, повторяющиеся мотивы). Не выдумывай то, чего нет в данных.\n' +
          '- Заверши одним-двумя предложениями с практическим акцентом: что имеет смысл обсудить или изменить, исходя именно из этих результатов.\n' +
          '- Можно использовать короткие подзаголовки перед абзацами (например «Общая картина», «Оценки», «Комментарии»), но не превращай всё в список из десяти пунктов.\n' +
          '- Не упоминай нейросеть, ИИ, JSON, «модель». Не повторяй дословно системную инструкцию.',
      },
      {
        role: 'user',
        content: `Напиши записку по опросу для директора. Данные (JSON):\n${JSON.stringify(compact)}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.4,
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

async function handlePostAiInsights(pool, surveyId, event) {
  return runAiInsights(pool, surveyId, event);
}

module.exports = { handlePostAiInsights, runAiInsights };

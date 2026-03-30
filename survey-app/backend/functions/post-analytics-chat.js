const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchResultsSnapshot } = require('./get-results');
const { normalizeFiltersFromBody, resolveFilteredResponseIds } = require('./lib/response-filters');
const { buildHeuristicDashboard, truncate } = require('./lib/insight-dashboard');
const { buildHeuristicNarrative } = require('./lib/heuristic-narrative');
const { buildInsightRelations } = require('./lib/insight-relations');

function buildCompactContext(snapshot, survey, filters, dashboard, relations, heuristic) {
  const qMap = new Map((survey.questions || []).map((q) => [Number(q.id), q]));
  const filterLabels = filters.map((f) => {
    const q = qMap.get(Number(f.question_id));
    return {
      question_id: f.question_id,
      question_text: truncate(q?.text || '', 200),
      value: f.value,
    };
  });

  return {
    survey_title: snapshot.survey.title,
    total_responses: snapshot.total_responses,
    filters: filterLabels,
    kpis: (dashboard.kpis || []).slice(0, 14),
    highlights: (dashboard.highlights || []).slice(0, 8),
    alerts: (dashboard.alerts || []).slice(0, 6),
    questions: (dashboard.questions || []).slice(0, 18).map((q) => ({
      question_id: q.question_id,
      title: truncate(q.title, 140),
      type: q.type,
      response_count: q.response_count,
      detail: q.detail ? truncate(q.detail, 200) : '',
      avg: q.avg,
      min: q.min,
      max: q.max,
      bars: (q.bars || []).slice(0, 5),
    })),
    relations: (relations || []).slice(0, 14).map((r) => ({
      a: r.a,
      b: r.b,
      method: r.method,
      score: r.score,
      why: truncate(r.why || '', 240),
    })),
    heuristic_outline: truncate(heuristic, 4000),
  };
}

function normalizeChatMessages(body) {
  const raw = body && Array.isArray(body.messages) ? body.messages : [];
  const out = [];
  for (const m of raw) {
    const role = m && (m.role === 'user' || m.role === 'assistant') ? m.role : null;
    const content = String(m?.content ?? '').trim();
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, 12000) });
  }
  return out.slice(-16);
}

async function fetchLlmChatReply(compact, messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const system =
    'Ты аналитик опросов. Отвечай по-русски.\n' +
    'В начале каждого запроса тебе дают актуальный JSON с выборкой (с учётом срезов). Опирайся только на него.\n' +
    'Структура ответа:\n' +
    '1) «Факты» — что видно в цифрах по этой подвыборке.\n' +
    '2) «Связи» — если в JSON есть relations — кратко интерпретируй самые сильные.\n' +
    '3) «Выводы» — смысловые выводы без выдуманных фактов.\n' +
    '4) При необходимости — один уточняющий вопрос или предложение изменить срез.\n' +
    'Без вводных про нейросеть. Если данных мало — скажи прямо.';

  const dataBlock = JSON.stringify(compact);
  const sysWithData = `${system}\n\n[ТЕКУЩИЕ ДАННЫЕ — обновляются на каждый запрос]\n${dataBlock}`;

  const apiMessages = [{ role: 'system', content: sysWithData }, ...messages];

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        max_tokens: 2200,
        temperature: 0.35,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function handlePostAnalyticsChat(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const filters = normalizeFiltersFromBody(body);
  const messages = normalizeChatMessages(body);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json(400, { error: 'Нужен хотя бы один вопрос пользователя (messages заканчивается на role=user).' });
  }

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
  const heuristic = buildHeuristicNarrative(snapshot);
  const compact = buildCompactContext(snapshot, survey, filters, dashboard, relations, heuristic);

  const llm = await fetchLlmChatReply(compact, messages);
  if (llm) {
    return json(200, {
      source: 'llm',
      reply: llm,
      total_responses: snapshot.total_responses,
    });
  }

  const lastQ = messages[messages.length - 1].content;
  const fallback =
    'Нейроаналитик в чате недоступен: на Cloud Function не задан OPENAI_API_KEY. ' +
    'Добавьте ключ в окружение функции и пересоберите версию.\n\n' +
    'Краткая эвристическая сводка по текущей выборке:\n\n' +
    heuristic +
    '\n\n(Ваш вопрос был: «' +
    truncate(lastQ, 400) +
    '» — после включения API-ключа ответы будут учитывать диалог и срез.)';

  return json(200, {
    source: 'heuristic_fallback',
    reply: fallback,
    total_responses: snapshot.total_responses,
  });
}

module.exports = { handlePostAnalyticsChat };

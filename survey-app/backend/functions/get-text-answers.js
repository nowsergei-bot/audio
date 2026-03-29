const { json } = require('./lib/http');
const { fetchTextAnswersPage } = require('./lib/fetch-text-answers');

function parseQuery(event) {
  const q = event.queryStringParameters || {};
  return {
    question_id: q.question_id != null && q.question_id !== '' ? Number(q.question_id) : undefined,
    q: q.q,
    limit: q.limit != null ? Number(q.limit) : undefined,
    offset: q.offset != null ? Number(q.offset) : undefined,
  };
}

async function handleGetTextAnswers(pool, surveyId, event) {
  const opts = parseQuery(event);
  const out = await fetchTextAnswersPage(pool, surveyId, opts);
  if (out.error === 'NOT_FOUND') return json(404, { error: 'Опрос не найден' });
  if (out.error === 'BAD_QUESTION') return json(400, { error: 'Указан не текстовый вопрос' });
  return json(200, out);
}

module.exports = { handleGetTextAnswers };

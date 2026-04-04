const { json } = require('./lib/http');
const { fetchResultsSnapshot } = require('./get-results');
const { runAiInsights } = require('./post-ai-insights');

async function resolveSurveyIdByDirectorToken(pool, token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length > 80) return null;
  const r = await pool.query(
    `SELECT id FROM surveys WHERE director_token = $1 AND status IN ('published', 'closed') LIMIT 1`,
    [raw],
  );
  return r.rows[0]?.id ?? null;
}

async function handleGetPublicDirectorResults(pool, token) {
  const surveyId = await resolveSurveyIdByDirectorToken(pool, token);
  if (!surveyId) return json(404, { error: 'Not found' });

  const snap = await fetchResultsSnapshot(pool, surveyId, { forPublicApi: false });
  if (!snap) return json(404, { error: 'Not found' });

  return json(200, {
    survey: {
      id: snap.survey.id,
      title: snap.survey.title,
      status: snap.survey.status,
    },
    total_responses: snap.total_responses,
    questions: snap.questions,
    charts: snap.charts,
    text_word_cloud: snap.text_word_cloud,
  });
}

async function handlePostPublicDirectorAiInsights(pool, token, event) {
  const surveyId = await resolveSurveyIdByDirectorToken(pool, token);
  if (!surveyId) return json(404, { error: 'Not found' });
  return runAiInsights(pool, surveyId, event);
}

module.exports = {
  handleGetPublicDirectorResults,
  handlePostPublicDirectorAiInsights,
  resolveSurveyIdByDirectorToken,
};

const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchResultsSnapshot } = require('./get-results');
const { resolveFilteredResponseIds, normalizeFiltersFromBody } = require('./lib/response-filters');

async function handlePostResultsFilter(pool, surveyId, event) {
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });

  const body = parseBody(event) || {};
  const filters = normalizeFiltersFromBody(body);

  let responseIds;
  if (filters.length) {
    const resolved = await resolveFilteredResponseIds(pool, surveyId, survey.questions, filters);
    responseIds = resolved === null ? undefined : resolved;
  } else {
    responseIds = undefined;
  }

  const snap = await fetchResultsSnapshot(pool, surveyId, {
    forPublicApi: false,
    responseIds,
  });
  if (!snap) return json(404, { error: 'Not found' });

  const wb = await pool.query(
    `SELECT id, filename, sheets, ai_commentary, created_at::text
     FROM survey_workbooks WHERE survey_id = $1 ORDER BY id DESC`,
    [surveyId]
  );

  return json(200, {
    ...snap,
    filters_applied: filters,
    workbooks: wb.rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      sheets: row.sheets,
      ai_commentary: row.ai_commentary,
      created_at: row.created_at,
    })),
  });
}

module.exports = { handlePostResultsFilter };

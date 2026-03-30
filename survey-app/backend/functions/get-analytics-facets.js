const { json } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');

function addFacet(map, qid, s) {
  const t = String(s ?? '').trim();
  if (!t) return;
  if (!map.has(qid)) map.set(qid, new Set());
  map.get(qid).add(t);
}

function extractFacetStrings(type, rawVal) {
  const t = String(type);
  let val = rawVal;
  if (typeof val === 'string') {
    try {
      val = JSON.parse(val);
    } catch {
      /* keep */
    }
  }
  if (t === 'checkbox' && Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (t === 'scale' || t === 'rating') {
    const n = Number(val);
    return Number.isFinite(n) ? [String(n)] : [];
  }
  if (t === 'date') {
    const d = String(val ?? '').trim().slice(0, 10);
    return d ? [d] : [];
  }
  if (t === 'text') {
    const s = String(val ?? '').trim();
    return s ? [s.slice(0, 500)] : [];
  }
  return [String(val ?? '').trim()].filter(Boolean);
}

/**
 * Уникальные значения по вопросам (для фильтров срезов).
 */
async function handleGetAnalyticsFacets(pool, surveyId) {
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });

  const r = await pool.query(
    `SELECT av.question_id, av.value
     FROM answer_values av
     INNER JOIN responses r ON r.id = av.response_id
     WHERE r.survey_id = $1`,
    [surveyId]
  );

  const byQ = new Map();
  const qTypes = new Map(survey.questions.map((q) => [Number(q.id), String(q.type)]));

  for (const row of r.rows) {
    const qid = Number(row.question_id);
    const type = qTypes.get(qid);
    if (!type) continue;
    const parts = extractFacetStrings(type, row.value);
    for (const p of parts) {
      addFacet(byQ, qid, p);
    }
  }

  const facets = {};
  for (const [qid, set] of byQ) {
    facets[String(qid)] = [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  return json(200, { facets });
}

module.exports = { handleGetAnalyticsFacets };

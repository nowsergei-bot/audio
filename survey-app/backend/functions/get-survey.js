const { json } = require('./lib/http');
const { isSurveyGroupSchemaError } = require('./lib/survey-groups-schema');

const SURVEY_SELECT = `
  SELECT s.id, s.title, s.description, s.created_at, s.created_by, s.status, s.access_link, s.director_token, s.media, s.owner_user_id,
         s.survey_group_id,
         g.id AS grp_id, g.slug AS grp_slug, g.name AS grp_name, g.curator_name AS grp_curator
  FROM surveys s
  LEFT JOIN survey_groups g ON g.id = s.survey_group_id
  WHERE s.id = $1
`;

const SURVEY_SELECT_LEGACY = `
  SELECT id, title, description, created_at, created_by, status, access_link, director_token, media, owner_user_id
  FROM surveys WHERE id = $1
`;

function surveyRowToApi(row) {
  if (!row) return null;
  if (!Object.prototype.hasOwnProperty.call(row, 'grp_id')) {
    return {
      ...row,
      survey_group_id: row.survey_group_id ?? null,
      survey_group: null,
    };
  }
  const { grp_id, grp_slug, grp_name, grp_curator, ...base } = row;
  return {
    ...base,
    survey_group:
      grp_id != null
        ? { id: grp_id, slug: grp_slug, name: grp_name, curator_name: grp_curator ?? '' }
        : null,
  };
}

async function loadSurveyWithQuestions(pool, id) {
  let s;
  try {
    s = await pool.query(SURVEY_SELECT, [id]);
  } catch (e) {
    if (!isSurveyGroupSchemaError(e)) throw e;
    s = await pool.query(SURVEY_SELECT_LEGACY, [id]);
  }
  if (!s.rows.length) return null;
  const mapped = surveyRowToApi(s.rows[0]);
  const q = await pool.query(
    `SELECT id, survey_id, text, type::text AS type, options, sort_order, required FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
    [id],
  );
  return { ...mapped, questions: q.rows };
}

async function handleGetSurvey(pool, id) {
  const survey = await loadSurveyWithQuestions(pool, id);
  if (!survey) return json(404, { error: 'Not found' });
  return json(200, { survey });
}

module.exports = { handleGetSurvey, loadSurveyWithQuestions, surveyRowToApi };

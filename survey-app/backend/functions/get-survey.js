const { json } = require('./lib/http');
const { isSurveyGroupSchemaError } = require('./lib/survey-groups-schema');
const { surveysAllowMultipleResponsesSupported } = require('./lib/survey-schema-support');

const SURVEY_SELECT = `
  SELECT s.id, s.title, s.description, s.created_at, s.created_by, s.status, s.access_link, s.director_token, s.allow_multiple_responses, s.media, s.owner_user_id,
         s.survey_group_id,
         g.id AS grp_id, g.slug AS grp_slug, g.name AS grp_name, g.curator_name AS grp_curator
  FROM surveys s
  LEFT JOIN survey_groups g ON g.id = s.survey_group_id
  WHERE s.id = $1
`;

const SURVEY_SELECT_LEGACY = `
  SELECT id, title, description, created_at, created_by, status, access_link, director_token, allow_multiple_responses, media, owner_user_id
  FROM surveys WHERE id = $1
`;

const SURVEY_SELECT_NO_MULTI = `
  SELECT s.id, s.title, s.description, s.created_at, s.created_by, s.status, s.access_link, s.director_token, FALSE AS allow_multiple_responses, s.media, s.owner_user_id,
         s.survey_group_id,
         g.id AS grp_id, g.slug AS grp_slug, g.name AS grp_name, g.curator_name AS grp_curator
  FROM surveys s
  LEFT JOIN survey_groups g ON g.id = s.survey_group_id
  WHERE s.id = $1
`;

const SURVEY_SELECT_LEGACY_NO_MULTI = `
  SELECT id, title, description, created_at, created_by, status, access_link, director_token, FALSE AS allow_multiple_responses, media, owner_user_id
  FROM surveys WHERE id = $1
`;

const SURVEY_SELECT_ULTRA_LEGACY = `
  SELECT id, title, description, created_at, created_by, status, access_link
  FROM surveys
  WHERE id = $1
`;

function isMissingAllowMultipleResponsesColumn(err) {
  if (!err || err.code !== '42703') return false;
  return /allow_multiple_responses/i.test(String(err.message || ''));
}

function isMissingSurveyColumn(err) {
  if (!err || err.code !== '42703') return false;
  return /(survey_group|allow_multiple_responses|director_token|media|owner_user_id)/i.test(
    String(err.message || '')
  );
}

function surveyRowToApi(row) {
  if (!row) return null;
  const normalizedBase = {
    ...row,
    director_token:
      Object.prototype.hasOwnProperty.call(row, 'director_token') ? row.director_token : null,
    media:
      Object.prototype.hasOwnProperty.call(row, 'media') && row.media && typeof row.media === 'object'
        ? row.media
        : {},
    owner_user_id:
      Object.prototype.hasOwnProperty.call(row, 'owner_user_id') ? row.owner_user_id : null,
    allow_multiple_responses:
      Object.prototype.hasOwnProperty.call(row, 'allow_multiple_responses') &&
      row.allow_multiple_responses === true,
  };
  if (!Object.prototype.hasOwnProperty.call(row, 'grp_id')) {
    return {
      ...normalizedBase,
      survey_group_id: row.survey_group_id ?? null,
      survey_group: null,
    };
  }
  const { grp_id, grp_slug, grp_name, grp_curator } = row;
  return {
    ...normalizedBase,
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
    if (isMissingAllowMultipleResponsesColumn(e)) {
      try {
        s = await pool.query(SURVEY_SELECT_NO_MULTI, [id]);
      } catch (e2) {
        if (!isSurveyGroupSchemaError(e2)) throw e2;
        s = await pool.query(SURVEY_SELECT_LEGACY_NO_MULTI, [id]);
      }
    } else if (isSurveyGroupSchemaError(e)) {
      try {
        s = await pool.query(SURVEY_SELECT_LEGACY, [id]);
      } catch (e2) {
        if (!isMissingAllowMultipleResponsesColumn(e2)) throw e2;
        s = await pool.query(SURVEY_SELECT_LEGACY_NO_MULTI, [id]);
      }
    } else {
      if (!isMissingSurveyColumn(e)) throw e;
      s = await pool.query(SURVEY_SELECT_ULTRA_LEGACY, [id]);
    }
  }
  if (!s.rows.length) return null;
  const mapped = surveyRowToApi(s.rows[0]);
  let q;
  try {
    q = await pool.query(
      `SELECT id, survey_id, text, type::text AS type, options, sort_order, required FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
      [id],
    );
  } catch (e) {
    if (!e || e.code !== '42703' || !/required/i.test(String(e.message || ''))) throw e;
    q = await pool.query(
      `SELECT id, survey_id, text, type::text AS type, options, sort_order, TRUE AS required FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
      [id],
    );
  }
  const allowMultipleSupported = await surveysAllowMultipleResponsesSupported(pool);
  return {
    ...mapped,
    questions: q.rows,
    allow_multiple_responses_supported: allowMultipleSupported,
  };
}

async function handleGetSurvey(pool, id) {
  const survey = await loadSurveyWithQuestions(pool, id);
  if (!survey) return json(404, { error: 'Not found' });
  return json(200, { survey });
}

module.exports = { handleGetSurvey, loadSurveyWithQuestions, surveyRowToApi };

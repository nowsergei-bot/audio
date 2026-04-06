const { json } = require('./lib/http');
const { surveyRowToApi } = require('./get-survey');
const { isSurveyGroupSchemaError } = require('./lib/survey-groups-schema');

async function handleGetSurveys(pool, user) {
  const isAdmin = user && user.role === 'admin';
  const sqlWithGroups = isAdmin
    ? `SELECT s.id, s.title, s.description, s.created_at, s.created_by, s.status, s.access_link, s.media, s.owner_user_id,
              s.survey_group_id,
              g.id AS grp_id, g.slug AS grp_slug, g.name AS grp_name, g.curator_name AS grp_curator
       FROM surveys s
       LEFT JOIN survey_groups g ON g.id = s.survey_group_id
       ORDER BY s.created_at DESC`
    : `SELECT s.id, s.title, s.description, s.created_at, s.created_by, s.status, s.access_link, s.media, s.owner_user_id,
              s.survey_group_id,
              g.id AS grp_id, g.slug AS grp_slug, g.name AS grp_name, g.curator_name AS grp_curator
       FROM surveys s
       LEFT JOIN survey_groups g ON g.id = s.survey_group_id
       WHERE s.owner_user_id = $1
       ORDER BY s.created_at DESC`;

  const sqlLegacy = isAdmin
    ? `SELECT id, title, description, created_at, created_by, status, access_link, media, owner_user_id
       FROM surveys
       ORDER BY created_at DESC`
    : `SELECT id, title, description, created_at, created_by, status, access_link, media, owner_user_id
       FROM surveys
       WHERE owner_user_id = $1
       ORDER BY created_at DESC`;

  let r;
  try {
    r = isAdmin ? await pool.query(sqlWithGroups) : await pool.query(sqlWithGroups, [user.id]);
  } catch (e) {
    if (!isSurveyGroupSchemaError(e)) throw e;
    r = isAdmin ? await pool.query(sqlLegacy) : await pool.query(sqlLegacy, [user.id]);
  }

  const surveys = r.rows.map((row) => surveyRowToApi(row));
  return json(200, { surveys });
}

module.exports = { handleGetSurveys };

const { json } = require('./lib/http');
const { isSurveyGroupSchemaError } = require('./lib/survey-groups-schema');

async function handleGetSurveyGroups(pool) {
  try {
    const r = await pool.query(
      `SELECT id, slug, name, curator_name, sort_order FROM survey_groups ORDER BY sort_order ASC, id ASC`,
    );
    return json(200, { groups: r.rows });
  } catch (e) {
    if (isSurveyGroupSchemaError(e)) {
      return json(200, { groups: [] });
    }
    throw e;
  }
}

module.exports = { handleGetSurveyGroups };

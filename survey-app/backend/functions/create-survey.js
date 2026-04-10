const { v4: uuidv4 } = require('uuid');
const { json, parseBody } = require('./lib/http');
const { QUESTION_TYPES } = require('./lib/validation');
const { loadSurveyWithQuestions } = require('./get-survey');
const { surveysAllowMultipleResponsesSupported } = require('./lib/survey-schema-support');

async function handleCreateSurvey(pool, event, user) {
  const body = parseBody(event) || {};
  const title = String(body.title || '').trim() || 'Без названия';
  const description = String(body.description || '').trim();
  const access_link = (body.access_link && String(body.access_link).trim()) || uuidv4().replace(/-/g, '');
  const director_token = uuidv4().replace(/-/g, '');
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const media = body.media && typeof body.media === 'object' ? body.media : {};
  const allowMultipleResponses = body.allow_multiple_responses === true;
  const allowedStatus = new Set(['draft', 'published', 'closed']);
  const status = allowedStatus.has(body.status) ? body.status : 'draft';
  const ownerUserId = user && user.id != null ? Number(user.id) : null;

  let surveyGroupId = null;
  if (body.survey_group_id !== undefined && body.survey_group_id !== null) {
    const gid = Number(body.survey_group_id);
    if (!Number.isFinite(gid) || gid < 1) return json(400, { error: 'Invalid survey_group_id' });
    const gr = await pool.query('SELECT id FROM survey_groups WHERE id = $1', [gid]);
    if (!gr.rows.length) return json(400, { error: 'Unknown survey group' });
    surveyGroupId = gid;
  }

  const client = await pool.connect();
  let newSurveyId;
  try {
    const supportsAllowMultiple = await surveysAllowMultipleResponsesSupported(pool);
    await client.query('BEGIN');
    const ins = supportsAllowMultiple
      ? await client.query(
        `INSERT INTO surveys (title, description, status, access_link, director_token, allow_multiple_responses, media, owner_user_id, survey_group_id)
         VALUES ($1, $2, $3::survey_status, $4, $5, $6, $7::jsonb, $8, $9)
         RETURNING id`,
        [title, description, status, access_link, director_token, allowMultipleResponses, JSON.stringify(media), ownerUserId, surveyGroupId],
      )
      : await client.query(
        `INSERT INTO surveys (title, description, status, access_link, director_token, media, owner_user_id, survey_group_id)
         VALUES ($1, $2, $3::survey_status, $4, $5, $6::jsonb, $7, $8)
         RETURNING id`,
        [title, description, status, access_link, director_token, JSON.stringify(media), ownerUserId, surveyGroupId],
      );
    newSurveyId = ins.rows[0].id;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const text = String(q.text || '').trim();
      const type = q.type;
      if (!QUESTION_TYPES.has(type)) {
        await client.query('ROLLBACK');
        return json(400, { error: `Invalid question type at index ${i}` });
      }
      const options = q.options != null ? q.options : type === 'scale' ? { min: 1, max: 10 } : [];
      const sort_order = Number.isFinite(q.sort_order) ? q.sort_order : i;
      const required = q.required !== false;
      await client.query(
        `INSERT INTO questions (survey_id, text, type, options, sort_order, required)
         VALUES ($1, $2, $3::question_type, $4::jsonb, $5, $6)`,
        [newSurveyId, text, type, JSON.stringify(options), sort_order, required],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return json(409, { error: 'access_link or director_token already exists' });
    }
    throw e;
  } finally {
    client.release();
  }

  const full = await loadSurveyWithQuestions(pool, newSurveyId);
  return json(201, { survey: full });
}

module.exports = { handleCreateSurvey };

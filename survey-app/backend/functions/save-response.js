const { json, parseBody, parseQuery } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { validatePayload } = require('./lib/validation');

async function assertSurveyAcceptsResponses(pool, surveyId) {
  const r = await pool.query(`SELECT id, status FROM surveys WHERE id = $1`, [surveyId]);
  if (!r.rows.length) return { ok: false, code: 404, error: 'Not found' };
  if (r.rows[0].status !== 'published') {
    return { ok: false, code: 403, error: 'Survey is not accepting responses' };
  }
  return { ok: true };
}

async function handleSaveResponse(pool, surveyId, event) {
  const check = await assertSurveyAcceptsResponses(pool, surveyId);
  if (!check.ok) return json(check.code, { error: check.error });

  const body = parseBody(event) || {};
  const query = parseQuery(event);
  const invite = query.invite ? String(query.invite).trim() : '';
  const respondent_id = body.respondent_id != null ? String(body.respondent_id).trim() : '';
  if (!respondent_id || respondent_id.length > 512) {
    return json(400, { error: 'respondent_id is required (max 512 chars)' });
  }

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  const validation = validatePayload(survey.questions, body.answers);
  if (!validation.ok) {
    return json(400, { error: validation.error });
  }
  const allowMultipleResponses = survey.allow_multiple_responses === true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!allowMultipleResponses) {
      const duplicateR = await client.query(
        `SELECT 1 FROM responses WHERE survey_id = $1 AND respondent_id = $2 LIMIT 1`,
        [surveyId, respondent_id]
      );
      if (duplicateR.rows.length) {
        await client.query('ROLLBACK');
        return json(409, { error: 'You have already submitted this survey' });
      }
    }
    const insR = await client.query(
      `INSERT INTO responses (survey_id, respondent_id) VALUES ($1, $2) RETURNING id`,
      [surveyId, respondent_id]
    );
    const responseId = insR.rows[0].id;
    for (const a of validation.answers) {
      await client.query(
        `INSERT INTO answer_values (response_id, question_id, value) VALUES ($1, $2, $3::jsonb)`,
        [responseId, a.question_id, JSON.stringify(a.value)]
      );
    }

    if (invite) {
      await client.query(
        `UPDATE survey_invites
         SET status = 'responded', responded_at = NOW(), last_error = NULL
         WHERE survey_id = $1 AND invite_token = $2`,
        [surveyId, invite]
      );
    }

    await client.query('COMMIT');
    return json(201, { ok: true, response_id: responseId });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return json(409, { error: 'You have already submitted this survey' });
    }
    throw e;
  } finally {
    client.release();
  }
}

async function handleSaveResponseByLink(pool, accessLink, event) {
  const r = await pool.query(`SELECT id, status FROM surveys WHERE access_link = $1`, [accessLink]);
  if (!r.rows.length) {
    return json(404, { error: 'Not found' });
  }
  if (r.rows[0].status !== 'published') {
    return json(403, { error: 'Survey is not accepting responses' });
  }
  return handleSaveResponse(pool, r.rows[0].id, event);
}

module.exports = { handleSaveResponse, handleSaveResponseByLink };

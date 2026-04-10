const { json, parseBody } = require('./lib/http');
const { QUESTION_TYPES } = require('./lib/validation');
const { loadSurveyWithQuestions } = require('./get-survey');
const { surveysAllowMultipleResponsesSupported } = require('./lib/survey-schema-support');

async function handleUpdateSurvey(pool, id, event, user) {
  const body = parseBody(event) || {};
  const existing = await loadSurveyWithQuestions(pool, id);
  if (!existing) return json(404, { error: 'Not found' });
  if (user && user.role !== 'admin' && Number(existing.owner_user_id || 0) !== Number(user.id || -1)) {
    return json(403, { error: 'Forbidden' });
  }

  const client = await pool.connect();
  try {
    const supportsAllowMultiple = await surveysAllowMultipleResponsesSupported(pool);
    await client.query('BEGIN');
    const title = body.title != null ? String(body.title).trim() : existing.title;
    const description = body.description != null ? String(body.description).trim() : existing.description;
    const allowedStatus = new Set(['draft', 'published', 'closed']);
    const status =
      body.status != null && allowedStatus.has(body.status) ? body.status : existing.status;
    const access_link =
      body.access_link != null ? String(body.access_link).trim() : existing.access_link;
    const allowMultipleResponses =
      body.allow_multiple_responses != null
        ? body.allow_multiple_responses === true
        : existing.allow_multiple_responses === true;
    const media = body.media && typeof body.media === 'object' ? body.media : null;

    let nextGroupId = existing.survey_group_id != null ? existing.survey_group_id : null;
    if (body.survey_group_id !== undefined) {
      if (body.survey_group_id === null) {
        nextGroupId = null;
      } else {
        const gid = Number(body.survey_group_id);
        if (!Number.isFinite(gid) || gid < 1) {
          await client.query('ROLLBACK');
          return json(400, { error: 'Invalid survey_group_id' });
        }
        const gr = await client.query('SELECT id FROM survey_groups WHERE id = $1', [gid]);
        if (!gr.rows.length) {
          await client.query('ROLLBACK');
          return json(400, { error: 'Unknown survey group' });
        }
        nextGroupId = gid;
      }
    }

    if (media) {
      if (supportsAllowMultiple) {
        await client.query(
          `UPDATE surveys
           SET title = $1, description = $2, status = $3::survey_status, access_link = $4, allow_multiple_responses = $5, media = $6::jsonb, survey_group_id = $7
           WHERE id = $8`,
          [title, description, status, access_link, allowMultipleResponses, JSON.stringify(media), nextGroupId, id],
        );
      } else {
        await client.query(
          `UPDATE surveys
           SET title = $1, description = $2, status = $3::survey_status, access_link = $4, media = $5::jsonb, survey_group_id = $6
           WHERE id = $7`,
          [title, description, status, access_link, JSON.stringify(media), nextGroupId, id],
        );
      }
    } else {
      if (supportsAllowMultiple) {
        await client.query(
          `UPDATE surveys
           SET title = $1, description = $2, status = $3::survey_status, access_link = $4, allow_multiple_responses = $5, survey_group_id = $6
           WHERE id = $7`,
          [title, description, status, access_link, allowMultipleResponses, nextGroupId, id],
        );
      } else {
        await client.query(
          `UPDATE surveys
           SET title = $1, description = $2, status = $3::survey_status, access_link = $4, survey_group_id = $5
           WHERE id = $6`,
          [title, description, status, access_link, nextGroupId, id],
        );
      }
    }

    if (Array.isArray(body.questions)) {
      await client.query(`DELETE FROM questions WHERE survey_id = $1`, [id]);
      for (let i = 0; i < body.questions.length; i++) {
        const q = body.questions[i];
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
          [id, text, type, JSON.stringify(options), sort_order, required],
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return json(409, { error: 'access_link already exists' });
    }
    throw e;
  } finally {
    client.release();
  }

  const survey = await loadSurveyWithQuestions(pool, id);
  return json(200, { survey });
}

module.exports = { handleUpdateSurvey };

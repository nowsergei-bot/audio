const { v4: uuidv4 } = require('uuid');
const { json, parseBody } = require('./lib/http');
const { QUESTION_TYPES } = require('./lib/validation');

async function handleCreateSurvey(pool, event) {
  const body = parseBody(event) || {};
  const title = String(body.title || '').trim() || 'Без названия';
  const description = String(body.description || '').trim();
  const access_link = (body.access_link && String(body.access_link).trim()) || uuidv4().replace(/-/g, '');
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const allowedStatus = new Set(['draft', 'published', 'closed']);
  const status = allowedStatus.has(body.status) ? body.status : 'draft';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO surveys (title, description, status, access_link)
       VALUES ($1, $2, $3::survey_status, $4)
       RETURNING id, title, description, created_at, created_by, status, access_link`,
      [title, description, status, access_link]
    );
    const survey = ins.rows[0];

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
      await client.query(
        `INSERT INTO questions (survey_id, text, type, options, sort_order)
         VALUES ($1, $2, $3::question_type, $4::jsonb, $5)`,
        [survey.id, text, type, JSON.stringify(options), sort_order]
      );
    }

    await client.query('COMMIT');
    const qrows = await pool.query(
      `SELECT id, survey_id, text, type, options, sort_order FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
      [survey.id]
    );
    return json(201, { survey: { ...survey, questions: qrows.rows } });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return json(409, { error: 'access_link already exists' });
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { handleCreateSurvey };

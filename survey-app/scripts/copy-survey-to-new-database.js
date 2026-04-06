#!/usr/bin/env node
/**
 * Копирует один опрос из старой Neon в новую с новыми id (сценарий B).
 *
 * Установка: cd survey-app/backend && npm install --prefix functions
 *
 * Запуск из корня survey-app:
 *   SOURCE_DATABASE_URL='postgresql://...' TARGET_DATABASE_URL='postgresql://...' \
 *   node scripts/copy-survey-to-new-database.js <source_survey_id>
 *
 * Опционально:
 *   TARGET_OWNER_USER_ID=12   — владелец в целевой БД (пусто или "null" → NULL)
 *   Если не задано: берётся owner_user_id из источника, только если такой users.id есть в цели, иначе NULL.
 *   DRY_RUN=1 — только показать, что будет скопировано, без записи.
 *
 * Список опросов в источнике (только SOURCE_DATABASE_URL):
 *   SOURCE_DATABASE_URL='...' node scripts/copy-survey-to-new-database.js list
 */
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join(__dirname, '../backend/functions/package.json'));
const { Pool } = req('pg');
const { v4: uuidv4 } = req('uuid');

function sslFromEnv() {
  return process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false };
}

function token32() {
  return uuidv4().replace(/-/g, '');
}

/** Любое значение для колонки jsonb: сырой текст («Да») → "\"Да\"" */
function toJsonbParam(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

async function resolveTargetOwner(newPool, oldSurvey) {
  const explicit = process.env.TARGET_OWNER_USER_ID;
  if (explicit !== undefined && explicit !== '') {
    if (String(explicit).toLowerCase() === 'null') return null;
    const id = parseInt(explicit, 10);
    if (Number.isNaN(id)) throw new Error('TARGET_OWNER_USER_ID must be an integer or "null"');
    const u = await newPool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (u.rowCount === 0) throw new Error(`TARGET_OWNER_USER_ID=${id}: пользователь не найден в целевой БД`);
    return id;
  }
  const oid = oldSurvey.owner_user_id;
  if (oid == null) return null;
  const u = await newPool.query('SELECT id FROM users WHERE id = $1', [oid]);
  return u.rowCount > 0 ? oid : null;
}

async function listSourceSurveys(sourceUrl) {
  const pool = new Pool({ connectionString: sourceUrl, ssl: sslFromEnv() });
  try {
    const cnt = await pool.query('SELECT COUNT(*)::int AS c FROM surveys');
    const rows = await pool.query(
      `SELECT id, title, status, created_at FROM surveys ORDER BY id DESC LIMIT 80`
    );
    console.log(`В источнике опросов: ${cnt.rows[0].c} (показано до 80, новые сверху)`);
    for (const r of rows.rows) {
      const title = (r.title || '').replace(/\s+/g, ' ').slice(0, 72);
      console.log(`  id=${r.id}\t${r.status}\t${r.created_at?.toISOString?.() || r.created_at}\t${title}`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const arg2 = process.argv[2];
  const listOnly = arg2 === 'list' || arg2 === '--list';
  const sourceSurveyId = parseInt(arg2 || process.env.SOURCE_SURVEY_ID || '', 10);
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  if (!sourceUrl) {
    console.error('Нужен SOURCE_DATABASE_URL');
    process.exit(1);
  }

  if (listOnly) {
    await listSourceSurveys(sourceUrl);
    return;
  }

  if (!targetUrl) {
    console.error('Нужен TARGET_DATABASE_URL (или запустите с аргументом list для списка опросов в источнике)');
    process.exit(1);
  }
  if (Number.isNaN(sourceSurveyId) || sourceSurveyId < 1) {
    console.error('Укажите id опроса в источнике: node scripts/copy-survey-to-new-database.js <id>');
    process.exit(1);
  }

  const oldPool = new Pool({ connectionString: sourceUrl, ssl: sslFromEnv() });
  const newPool = new Pool({ connectionString: targetUrl, ssl: sslFromEnv() });

  try {
    const sRes = await oldPool.query(
      `SELECT id, title, description, created_at, created_by, owner_user_id, status,
              access_link, director_token, media, results_share_token
       FROM surveys WHERE id = $1`,
      [sourceSurveyId]
    );
    if (sRes.rowCount === 0) {
      console.error(`Опрос id=${sourceSurveyId} не найден в источнике.`);
      const cnt = await oldPool.query('SELECT COUNT(*)::int AS c FROM surveys');
      const sample = await oldPool.query(
        `SELECT id, title, status FROM surveys ORDER BY id DESC LIMIT 30`
      );
      console.error(`В этой базе всего строк в surveys: ${cnt.rows[0].c}. Последние по id:`);
      for (const r of sample.rows) {
        const title = (r.title || '').replace(/\s+/g, ' ').slice(0, 64);
        console.error(`  id=${r.id}\t${r.status}\t${title}`);
      }
      console.error('Подставьте нужный id в команду или проверьте, что SOURCE указывает на ту ветку/проект Neon, где лежит опрос.');
      process.exit(1);
    }
    const oldSurvey = sRes.rows[0];

    const [questions, responses, answerValues, comments, workbooks, invites, templates] =
      await Promise.all([
        oldPool.query(
          `SELECT id, text, type, options, sort_order, required FROM questions WHERE survey_id = $1 ORDER BY sort_order, id`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT id, respondent_id, submitted_at FROM responses WHERE survey_id = $1 ORDER BY id`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT av.response_id, av.question_id, av.value
           FROM answer_values av
           INNER JOIN responses r ON r.id = av.response_id
           WHERE r.survey_id = $1`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT question_id, user_id, text, created_at FROM comments WHERE survey_id = $1 ORDER BY id`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT filename, sheets, ai_commentary, created_at FROM survey_workbooks WHERE survey_id = $1 ORDER BY id`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT email, status, invite_token, attempts, last_error, created_at, sent_at, last_sent_at, responded_at
           FROM survey_invites WHERE survey_id = $1 ORDER BY id`,
          [sourceSurveyId]
        ),
        oldPool.query(
          `SELECT subject, html, updated_at FROM survey_invite_templates WHERE survey_id = $1`,
          [sourceSurveyId]
        ),
      ]);

    console.log('Источник: опрос', oldSurvey.title, `(id=${oldSurvey.id}, status=${oldSurvey.status})`);
    console.log(
      `Строки: questions=${questions.rowCount} responses=${responses.rowCount} answer_values=${answerValues.rowCount} comments=${comments.rowCount} workbooks=${workbooks.rowCount} invites=${invites.rowCount} template=${templates.rowCount}`
    );

    if (dryRun) {
      console.log('DRY_RUN: запись не выполнялась');
      return;
    }

    const ownerUserId = await resolveTargetOwner(newPool, oldSurvey);
    const accessLink = token32();
    const directorToken = token32();
    const resultsShareToken = oldSurvey.results_share_token ? token32() : null;

    const client = await newPool.connect();
    try {
      await client.query('BEGIN');

      const insSurvey = await client.query(
        `INSERT INTO surveys (
           title, description, created_at, created_by, owner_user_id, status,
           access_link, director_token, media, results_share_token
         ) VALUES ($1, $2, $3, $4, $5, $6::survey_status, $7, $8, $9::jsonb, $10)
         RETURNING id`,
        [
          oldSurvey.title,
          oldSurvey.description,
          oldSurvey.created_at,
          oldSurvey.created_by,
          ownerUserId,
          oldSurvey.status,
          accessLink,
          directorToken,
          toJsonbParam(oldSurvey.media ?? {}),
          resultsShareToken,
        ]
      );
      const newSurveyId = insSurvey.rows[0].id;

      const qMap = new Map();
      for (const q of questions.rows) {
        const r = await client.query(
          `INSERT INTO questions (survey_id, text, type, options, sort_order, required)
           VALUES ($1, $2, $3::question_type, $4::jsonb, $5, $6)
           RETURNING id`,
          [
            newSurveyId,
            q.text,
            q.type,
            toJsonbParam(q.options ?? []),
            q.sort_order,
            q.required,
          ]
        );
        qMap.set(q.id, r.rows[0].id);
      }

      const rMap = new Map();
      for (const row of responses.rows) {
        const r = await client.query(
          `INSERT INTO responses (survey_id, respondent_id, submitted_at)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [newSurveyId, row.respondent_id, row.submitted_at]
        );
        rMap.set(row.id, r.rows[0].id);
      }

      for (const av of answerValues.rows) {
        const newRid = rMap.get(av.response_id);
        const newQid = qMap.get(av.question_id);
        if (newRid == null || newQid == null) continue;
        await client.query(
          `INSERT INTO answer_values (response_id, question_id, value)
           VALUES ($1, $2, $3::jsonb)`,
          [
            newRid,
            newQid,
            toJsonbParam(av.value),
          ]
        );
      }

      for (const c of comments.rows) {
        const newQid = c.question_id == null ? null : qMap.get(c.question_id);
        if (c.question_id != null && newQid == null) continue;
        await client.query(
          `INSERT INTO comments (survey_id, question_id, user_id, text, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [newSurveyId, newQid, c.user_id, c.text, c.created_at]
        );
      }

      for (const w of workbooks.rows) {
        await client.query(
          `INSERT INTO survey_workbooks (survey_id, filename, sheets, ai_commentary, created_at)
           VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [
            newSurveyId,
            w.filename,
            toJsonbParam(w.sheets ?? []),
            w.ai_commentary,
            w.created_at,
          ]
        );
      }

      for (const inv of invites.rows) {
        const newInviteToken = inv.invite_token ? token32() : null;
        await client.query(
          `INSERT INTO survey_invites (
             survey_id, email, status, invite_token, attempts, last_error,
             created_at, sent_at, last_sent_at, responded_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            newSurveyId,
            inv.email,
            inv.status,
            newInviteToken,
            inv.attempts,
            inv.last_error,
            inv.created_at,
            inv.sent_at,
            inv.last_sent_at,
            inv.responded_at,
          ]
        );
      }

      if (templates.rowCount > 0) {
        const t = templates.rows[0];
        await client.query(
          `INSERT INTO survey_invite_templates (survey_id, subject, html, updated_at)
           VALUES ($1, $2, $3, $4)`,
          [newSurveyId, t.subject, t.html, t.updated_at]
        );
      }

      await client.query('COMMIT');
      console.log('Готово. Новый id опроса:', newSurveyId);
      console.log('access_link:', accessLink);
      console.log('director_token:', directorToken);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await oldPool.end();
    await newPool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

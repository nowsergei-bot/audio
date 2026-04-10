const { json, parseBody } = require('./lib/http');
const { sendInviteEmail, isSmtpConfigured } = require('./lib/mailer');
const crypto = require('crypto');

function normalizeEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  // минимальная валидация, без RFC-крайностей
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

function parseEmails(raw) {
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw || '');
  const parts = text.split(/[\s,;]+/g).map((s) => s.trim());
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const e = normalizeEmail(p);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

async function getSurveyAccessLink(pool, surveyId) {
  const r = await pool.query(`SELECT id, title, access_link FROM surveys WHERE id = $1 LIMIT 1`, [surveyId]);
  return r.rows[0] || null;
}

async function handleGetSurveyInvites(pool, surveyId) {
  const r = await pool.query(
    `SELECT email, status, sent_at, last_error, created_at
     FROM survey_invites
     WHERE survey_id = $1
     ORDER BY email`,
    [surveyId]
  );
  return json(200, { invites: r.rows });
}

async function handleGetSurveyInviteTemplate(pool, surveyId) {
  const r = await pool.query(`SELECT subject, html, updated_at FROM survey_invite_templates WHERE survey_id = $1`, [
    surveyId,
  ]);
  const row = r.rows[0] || null;
  return json(200, { template: row || { subject: '', html: '', updated_at: null } });
}

async function handlePutSurveyInviteTemplate(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const subject = body.subject != null ? String(body.subject).slice(0, 180) : '';
  const html = body.html != null ? String(body.html) : '';
  await pool.query(
    `INSERT INTO survey_invite_templates (survey_id, subject, html, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (survey_id) DO UPDATE SET subject = EXCLUDED.subject, html = EXCLUDED.html, updated_at = NOW()`,
    [surveyId, subject, html]
  );
  return json(200, { ok: true });
}

async function handlePostSurveyInvites(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const emails = parseEmails(body.emails || body.list || body.text || []);
  if (!emails.length) return json(400, { error: 'Список email пуст или некорректен' });
  if (emails.length > 2000) return json(400, { error: 'Слишком много email (лимит 2000)' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // upsert: сохраняем (pending), не трогаем sent если уже sent
    for (const e of emails) {
      await client.query(
        `INSERT INTO survey_invites (survey_id, email, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (survey_id, email)
         DO UPDATE SET status = CASE WHEN survey_invites.status IN ('sent','responded') THEN survey_invites.status ELSE 'pending' END,
                      last_error = NULL`,
        [surveyId, e]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return json(200, { ok: true, saved: emails.length });
}

function publicSurveyUrlFromEnv(accessLink) {
  const base = (process.env.PUBLIC_APP_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/s/${encodeURIComponent(accessLink)}`;
}

function compileTemplate({ subject, html }, survey, link) {
  const subj = (subject || '').trim();
  const tpl = (html || '').trim();
  const subjectOut = subj || `Приглашение: ${survey.title || 'опрос'}`;
  const htmlOut =
    tpl.length > 0
      ? tpl
      : `<div style="font-family: Arial, sans-serif; line-height: 1.45;">
           <p>Здравствуйте!</p>
           <p>Приглашаем пройти опрос: <b>${escapeHtml(survey.title || 'Опрос')}</b></p>
           <p><a href="${link}">${link}</a></p>
           <p style="color:#6b7280;">Если письмо пришло по ошибке — просто проигнорируйте.</p>
         </div>`;
  return { subject: subjectOut, html: htmlOut };
}

function withInvite(link, token) {
  const sep = link.includes('?') ? '&' : '?';
  return `${link}${sep}invite=${encodeURIComponent(token)}`;
}

function newInviteToken() {
  return crypto.randomBytes(18).toString('base64url');
}

async function handlePostSurveyInvitesSend(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const limit = Math.min(200, Math.max(1, Number(body.limit || 50)));

  const survey = await getSurveyAccessLink(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });
  const link = publicSurveyUrlFromEnv(survey.access_link);
  if (!link) return json(400, { error: 'PUBLIC_APP_BASE не задан на функции (нужен для ссылки в письме)' });
  if (!isSmtpConfigured()) {
    return json(503, {
      error: 'smtp_not_configured',
      message:
        'SMTP не настроен: задайте SMTP_HOST, SMTP_PORT, SMTP_FROM и при необходимости SMTP_USER, SMTP_PASS в окружении функции.',
    });
  }

  const tplR = await pool.query(`SELECT subject, html FROM survey_invite_templates WHERE survey_id = $1`, [surveyId]);
  const compiled = compileTemplate(tplR.rows[0] || {}, survey, link);

  const r = await pool.query(
    `SELECT email, invite_token, status
     FROM survey_invites
     WHERE survey_id = $1 AND status IN ('pending','error')
     ORDER BY created_at, email
     LIMIT $2`,
    [surveyId, limit]
  );

  let sent = 0;
  let errors = 0;
  const details = [];

  for (const row of r.rows) {
    const to = row.email;
    try {
      let token = row.invite_token ? String(row.invite_token) : '';
      if (!token) {
        token = newInviteToken();
        await pool.query(`UPDATE survey_invites SET invite_token = $3 WHERE survey_id = $1 AND email = $2`, [
          surveyId,
          to,
          token,
        ]);
      }

      const perLink = withInvite(link, token);
      const subject = body.subject ? String(body.subject).slice(0, 180) : compiled.subject;
      const htmlRaw = body.html && String(body.html).trim().length > 0 ? String(body.html) : compiled.html;
      const html = htmlRaw
        .replace(/\{\{\s*link\s*\}\}/gi, perLink)
        .replace(/\{\{\s*title\s*\}\}/gi, escapeHtml(survey.title || 'Опрос'));

      await sendInviteEmail({ to, subject, html });
      await pool.query(
        `UPDATE survey_invites
         SET status = 'sent',
             sent_at = COALESCE(sent_at, NOW()),
             last_sent_at = NOW(),
             attempts = attempts + 1,
             last_error = NULL
         WHERE survey_id = $1 AND email = $2`,
        [surveyId, to]
      );
      sent += 1;
      details.push({ email: to, ok: true });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      await pool.query(
        `UPDATE survey_invites
         SET status = 'error', last_error = $3, attempts = attempts + 1
         WHERE survey_id = $1 AND email = $2`,
        [surveyId, to, msg.slice(0, 500)]
      );
      errors += 1;
      details.push({ email: to, ok: false, error: msg });
    }
  }

  return json(200, { ok: true, attempted: r.rows.length, sent, errors, details });
}

async function handlePostSurveyInvitesRemind(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const limit = Math.min(200, Math.max(1, Number(body.limit || 50)));
  const minHours = Math.min(168, Math.max(1, Number(body.min_hours_between || 24)));

  const survey = await getSurveyAccessLink(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });
  const link = publicSurveyUrlFromEnv(survey.access_link);
  if (!link) return json(400, { error: 'PUBLIC_APP_BASE не задан на функции (нужен для ссылки в письме)' });
  if (!isSmtpConfigured()) {
    return json(503, {
      error: 'smtp_not_configured',
      message:
        'SMTP не настроен: задайте SMTP_HOST, SMTP_PORT, SMTP_FROM и при необходимости SMTP_USER, SMTP_PASS в окружении функции.',
    });
  }

  const tplR = await pool.query(`SELECT subject, html FROM survey_invite_templates WHERE survey_id = $1`, [surveyId]);
  const compiled = compileTemplate(tplR.rows[0] || {}, survey, link);
  const subject = (body.subject ? String(body.subject).slice(0, 180) : compiled.subject) || `Напоминание: ${survey.title || 'опрос'}`;

  const r = await pool.query(
    `SELECT email, invite_token
     FROM survey_invites
     WHERE survey_id = $1
       AND responded_at IS NULL
       AND status IN ('sent','error','pending')
       AND (last_sent_at IS NULL OR last_sent_at < NOW() - ($3::text || ' hours')::interval)
     ORDER BY COALESCE(last_sent_at, created_at) ASC, email
     LIMIT $2`,
    [surveyId, limit, String(minHours)]
  );

  let sent = 0;
  let errors = 0;
  const details = [];
  for (const row of r.rows) {
    const to = row.email;
    try {
      let token = row.invite_token ? String(row.invite_token) : '';
      if (!token) {
        token = newInviteToken();
        await pool.query(`UPDATE survey_invites SET invite_token = $3 WHERE survey_id = $1 AND email = $2`, [
          surveyId,
          to,
          token,
        ]);
      }
      const perLink = withInvite(link, token);
      const htmlRaw = body.html && String(body.html).trim().length > 0 ? String(body.html) : compiled.html;
      const html = htmlRaw
        .replace(/\{\{\s*link\s*\}\}/gi, perLink)
        .replace(/\{\{\s*title\s*\}\}/gi, escapeHtml(survey.title || 'Опрос'));

      await sendInviteEmail({ to, subject, html });
      await pool.query(
        `UPDATE survey_invites
         SET status = 'sent',
             sent_at = COALESCE(sent_at, NOW()),
             last_sent_at = NOW(),
             attempts = attempts + 1,
             last_error = NULL
         WHERE survey_id = $1 AND email = $2`,
        [surveyId, to]
      );
      sent += 1;
      details.push({ email: to, ok: true });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      await pool.query(
        `UPDATE survey_invites
         SET status = 'error', last_error = $3, attempts = attempts + 1
         WHERE survey_id = $1 AND email = $2`,
        [surveyId, to, msg.slice(0, 500)]
      );
      errors += 1;
      details.push({ email: to, ok: false, error: msg });
    }
  }

  return json(200, { ok: true, attempted: r.rows.length, sent, errors, details });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  handleGetSurveyInvites,
  handlePostSurveyInvites,
  handlePostSurveyInvitesSend,
  handlePostSurveyInvitesRemind,
  handleGetSurveyInviteTemplate,
  handlePutSurveyInviteTemplate,
};


const { json, parseBody } = require('./lib/http');
const { sendHtmlEmail, isSmtpConfigured } = require('./lib/mailer');
const { detokenize } = require('./lib/pii-tokenize');

/**
 * Сессии педагогики привязаны к user_id. Если в запросе есть и X-Api-Key, и валидный Bearer,
 * используем пользователя из сессии — иначе POST создаёт строки с user_id=NULL, а GET с ключом их не находит (404).
 */
function resolveProjectOwner(user, viaAdminKey, sessionUser) {
  if (sessionUser && sessionUser.id != null) {
    return { ok: true, userId: Number(sessionUser.id) };
  }
  if (user && user.id != null) return { ok: true, userId: Number(user.id) };
  if (viaAdminKey) return { ok: true, apiKey: true };
  return { ok: false };
}

function requireAccess(user, viaAdminKey, sessionUser) {
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  if (!scope.ok) {
    return json(403, {
      error: 'pedagogical_auth',
      message: 'Нужна авторизация: Bearer-сессия или X-Api-Key.',
    });
  }
  return null;
}

function defaultState() {
  return {
    v: 1,
    step: 'draft',
    job: { status: 'idle', done: 0, total: 0, error: null },
    segments: [],
    notification: { emailEnabled: false, maxWebhookUrl: '', consent: false },
    excelProjectId: null,
    /** Строки таблицы Excel по одному педагогу; авто-ПДн на сервере — по блокам. */
    sourceBlocks: null,
    /** token → исходное значение; в запрос к LLM не передаётся, только redactedSource. */
    piiMap: {},
    redactedSource: '',
    /** Исходный текст с ПДн (черновик редактирования); хранится в сессии на сервере. */
    sourcePlain: '',
    piiEntitiesDraft: [],
    /** Последний ответ модели: replyRedacted — как вернула модель; replyPlain — после detokenize на сервере. */
    llmLast: null,
    piiAuto: null,
  };
}

function normalizePiiAuto(x) {
  if (x == null) return null;
  if (typeof x !== 'object' || Array.isArray(x)) return null;
  return {
    at: String(x.at || ''),
    entityCount: Number(x.entityCount) || 0,
    autoDetectedCount: Number(x.autoDetectedCount) || 0,
  };
}

function normalizeLlmLast(x) {
  if (x == null) return null;
  if (typeof x !== 'object' || Array.isArray(x)) return null;
  return {
    at: String(x.at || ''),
    provider: String(x.provider || ''),
    replyRedacted: String(x.replyRedacted || ''),
    replyPlain: String(x.replyPlain || ''),
  };
}

function mergeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    v: 1,
    job: { ...base.job, ...(raw.job && typeof raw.job === 'object' ? raw.job : {}) },
    notification: {
      ...base.notification,
      ...(raw.notification && typeof raw.notification === 'object' ? raw.notification : {}),
    },
    segments: Array.isArray(raw.segments) ? raw.segments : base.segments,
    sourceBlocks:
      raw.sourceBlocks === undefined
        ? base.sourceBlocks
        : Array.isArray(raw.sourceBlocks)
          ? raw.sourceBlocks.map((x) => String(x ?? ''))
          : null,
    piiMap: raw.piiMap && typeof raw.piiMap === 'object' && !Array.isArray(raw.piiMap) ? raw.piiMap : base.piiMap,
    redactedSource: typeof raw.redactedSource === 'string' ? raw.redactedSource : base.redactedSource,
    sourcePlain: typeof raw.sourcePlain === 'string' ? raw.sourcePlain : base.sourcePlain,
    piiEntitiesDraft: Array.isArray(raw.piiEntitiesDraft) ? raw.piiEntitiesDraft : base.piiEntitiesDraft,
    llmLast: raw.llmLast !== undefined ? normalizeLlmLast(raw.llmLast) : base.llmLast,
    piiAuto: raw.piiAuto !== undefined ? normalizePiiAuto(raw.piiAuto) : base.piiAuto,
  };
}

async function handleGetPedagogicalSessions(pool, user, viaAdminKey, sessionUser) {
  const denied = requireAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(
          `SELECT id, title, state_json->>'step' AS step, updated_at
           FROM pedagogical_analytics_sessions
           WHERE user_id IS NULL
           ORDER BY updated_at DESC
           LIMIT 80`,
        )
      : await pool.query(
          `SELECT id, title, state_json->>'step' AS step, updated_at
           FROM pedagogical_analytics_sessions
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT 80`,
          [scope.userId],
        );
  return json(200, { sessions: r.rows });
}

async function handleGetPedagogicalSession(pool, user, viaAdminKey, sessionUser, id) {
  const denied = requireAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(
          `SELECT id, title, state_json, created_at, updated_at
           FROM pedagogical_analytics_sessions
           WHERE id = $1 AND user_id IS NULL`,
          [id],
        )
      : await pool.query(
          `SELECT id, title, state_json, created_at, updated_at
           FROM pedagogical_analytics_sessions
           WHERE id = $1 AND user_id = $2`,
          [id, scope.userId],
        );
  if (!r.rows.length) return json(404, { error: 'Not found' });
  const row = r.rows[0];
  return json(200, {
    session: {
      id: row.id,
      title: row.title,
      state: mergeState(row.state_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

async function handlePostPedagogicalSession(pool, user, viaAdminKey, sessionUser, event) {
  const denied = requireAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const body = parseBody(event) || {};
  const title = String(body.title || '').trim() || 'Педагогическая аналитика';
  const state = mergeState(body.state);

  if (body.id != null) {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id < 1) return json(400, { error: 'Invalid id' });
    const state_json = JSON.stringify(state);
    const upd =
      scope.apiKey === true
        ? await pool.query(
            `UPDATE pedagogical_analytics_sessions
             SET title = $1, state_json = $2::jsonb, updated_at = NOW()
             WHERE id = $3 AND user_id IS NULL
             RETURNING id, title, updated_at`,
            [title, state_json, id],
          )
        : await pool.query(
            `UPDATE pedagogical_analytics_sessions
             SET title = $1, state_json = $2::jsonb, updated_at = NOW()
             WHERE id = $3 AND user_id = $4
             RETURNING id, title, updated_at`,
            [title, state_json, id, scope.userId],
          );
    if (!upd.rows.length) return json(404, { error: 'Not found' });
    return json(200, { session: { ...upd.rows[0], state } });
  }

  const state_json = JSON.stringify(state);
  const ins =
    scope.apiKey === true
      ? await pool.query(
          `INSERT INTO pedagogical_analytics_sessions (user_id, title, state_json)
           VALUES (NULL, $1, $2::jsonb)
           RETURNING id, title, updated_at`,
          [title, state_json],
        )
      : await pool.query(
          `INSERT INTO pedagogical_analytics_sessions (user_id, title, state_json)
           VALUES ($1, $2, $3::jsonb)
           RETURNING id, title, updated_at`,
          [scope.userId, title, state_json],
        );
  return json(201, { session: { ...ins.rows[0], state } });
}

async function handleDeletePedagogicalSession(pool, user, viaAdminKey, sessionUser, id) {
  const denied = requireAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(`DELETE FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id IS NULL RETURNING id`, [
          id,
        ])
      : await pool.query(`DELETE FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id = $2 RETURNING id`, [
          id,
          scope.userId,
        ]);
  if (!r.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true, id: r.rows[0].id });
}

/**
 * Уведомления: письма (SMTP) и/или входящий вебхук (например, чат Max / корп. мессенджер).
 */
async function handlePostPedagogicalNotify(pool, user, viaAdminKey, sessionUser, sessionId, event) {
  const denied = requireAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const body = parseBody(event) || {};
  if (!body.consent) {
    return json(400, { error: 'Нужно подтвердить согласие на рассылку (consent: true).' });
  }

  const r =
    scope.apiKey === true
      ? await pool.query(`SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id IS NULL`, [
          sessionId,
        ])
      : await pool.query(
          `SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id = $2`,
          [sessionId, scope.userId],
        );
  if (!r.rows.length) return json(404, { error: 'Not found' });
  const row = r.rows[0];
  const state = mergeState(row.state_json);

  const emails = Array.isArray(body.emails) ? body.emails.map((e) => String(e || '').trim()).filter(Boolean) : [];
  const maxUrl = String(body.maxWebhookUrl || state.notification?.maxWebhookUrl || '').trim();
  const subject = String(body.subject || `Педагогическая аналитика: ${row.title}`).slice(0, 200);
  const htmlRaw = String(body.html || '').trim();
  const textRaw = String(body.text || '').trim();

  if (!htmlRaw && !textRaw) {
    return json(400, { error: 'Передайте html или text письма / уведомления.' });
  }

  const piiMap = state.piiMap && typeof state.piiMap === 'object' && !Array.isArray(state.piiMap) ? state.piiMap : {};
  let emailHtml = htmlRaw;
  let emailText = textRaw;
  if (Object.keys(piiMap).length && body.detokenizeEmail !== false) {
    emailHtml = detokenize(emailHtml, piiMap);
    emailText = detokenize(emailText, piiMap);
  }

  const safeHtml = emailHtml || `<pre style="font-family:system-ui">${escapeHtml(emailText)}</pre>`;

  const results = { email: { sent: 0, failed: [] }, max: { ok: false, detail: null } };

  const smtpOk = isSmtpConfigured();
  for (const to of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      results.email.failed.push({ to, error: 'invalid email' });
      continue;
    }
    if (!smtpOk) {
      results.email.failed.push({
        to,
        error:
          'SMTP не настроен: задайте SMTP_HOST, SMTP_PORT, SMTP_FROM (и при необходимости SMTP_USER, SMTP_PASS) в окружении функции. См. .env.cloud-function.example',
      });
      continue;
    }
    try {
      await sendHtmlEmail({ to, subject, html: safeHtml, text: emailText || undefined });
      results.email.sent += 1;
    } catch (e) {
      results.email.failed.push({ to, error: e.message || String(e) });
    }
  }

  if (maxUrl) {
    try {
      let maxText = String(body.maxText ?? textRaw ?? '').trim() || null;
      if (body.maxDetokenize === true && Object.keys(piiMap).length && maxText) {
        maxText = detokenize(maxText, piiMap);
      }
      const payload = {
        event: 'pedagogical_analytics_report',
        sessionId: row.id,
        title: row.title,
        subject,
        text: maxText,
        html: Boolean(htmlRaw),
        at: new Date().toISOString(),
      };
      const resp = await fetch(maxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      results.max.ok = resp.ok;
      results.max.detail = `HTTP ${resp.status}`;
    } catch (e) {
      results.max.ok = false;
      results.max.detail = e.message || String(e);
    }
  }

  const next = {
    ...state,
    notification: {
      ...state.notification,
      consent: true,
      lastNotifiedAt: new Date().toISOString(),
    },
    step: 'sent',
  };
  const state_json = JSON.stringify(next);
  if (scope.apiKey === true) {
    await pool.query(
      `UPDATE pedagogical_analytics_sessions SET state_json = $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id IS NULL`,
      [state_json, sessionId],
    );
  } else {
    await pool.query(
      `UPDATE pedagogical_analytics_sessions SET state_json = $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [state_json, sessionId, scope.userId],
    );
  }

  return json(200, { ok: true, results, smtp_configured: smtpOk });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  handleGetPedagogicalSessions,
  handleGetPedagogicalSession,
  handlePostPedagogicalSession,
  handleDeletePedagogicalSession,
  handlePostPedagogicalNotify,
  mergePedagogicalState: mergeState,
  resolvePedagogicalOwner: resolveProjectOwner,
  requirePedagogicalAccess: requireAccess,
};

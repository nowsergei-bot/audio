const { randomUUID } = require('crypto');
const { json, parseBody } = require('./lib/http');
const { resolveProjectOwner } = require('./lib/resolve-project-owner');

function emptyDraft(title) {
  return {
    title: title || 'Отчёт по феноменальным урокам',
    periodLabel: '',
    blocks: [],
    updatedAt: new Date().toISOString(),
    surveyId: null,
  };
}

function requirePhenomenalAccess(user, viaAdminKey, sessionUser) {
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  if (!scope.ok) {
    return json(403, {
      error: 'Forbidden',
      message:
        'Нужна сессия (войдите в систему) или X-Api-Key. Если передаёте и ключ, и Bearer — черновик привязывается к аккаунту из сессии.',
    });
  }
  return null;
}

/** Доступ к строке проекта: сессия — свой user_id; только ключ — только строки с user_id IS NULL. */
async function assertProjectRowScope(pool, projectId, scope) {
  const r = await pool.query(`SELECT id, user_id FROM phenomenal_report_projects WHERE id = $1`, [projectId]);
  if (!r.rows.length) return { ok: false, code: 404 };
  const row = r.rows[0];
  if (scope.apiKey === true) {
    if (row.user_id == null) return { ok: true, row };
    return { ok: false, code: 404 };
  }
  if (row.user_id != null && Number(row.user_id) === Number(scope.userId)) return { ok: true, row };
  return { ok: false, code: 404 };
}

async function handleListPhenomenalReportProjects(pool, user, viaAdminKey, sessionUser) {
  const denied = requirePhenomenalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(
          `SELECT id, title, survey_id, director_share_token, created_at, updated_at
           FROM phenomenal_report_projects
           WHERE user_id IS NULL
           ORDER BY updated_at DESC
           LIMIT 100`,
        )
      : await pool.query(
          `SELECT id, title, survey_id, director_share_token, created_at, updated_at
           FROM phenomenal_report_projects
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT 100`,
          [scope.userId],
        );
  return json(200, { projects: r.rows });
}

async function handlePostPhenomenalReportProject(pool, user, viaAdminKey, sessionUser, event) {
  const denied = requirePhenomenalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);

  const body = parseBody(event) || {};
  const title = String(body.title || 'Отчёт по феноменальным урокам').trim().slice(0, 500);
  const surveyId =
    body.survey_id != null && body.survey_id !== ''
      ? Number(body.survey_id)
      : body.surveyId != null && body.surveyId !== ''
        ? Number(body.surveyId)
        : null;
  const draftFromBody = body.draft && typeof body.draft === 'object' ? body.draft : null;
  const draft = draftFromBody
    ? {
        ...draftFromBody,
        title: String(draftFromBody.title || title).slice(0, 500),
        updatedAt: new Date().toISOString(),
        surveyId:
          draftFromBody.surveyId != null
            ? Number(draftFromBody.surveyId)
            : Number.isFinite(surveyId)
              ? surveyId
              : null,
      }
    : emptyDraft(title);

  const token = randomUUID().replace(/-/g, '');
  const sid = Number.isFinite(surveyId) ? surveyId : draft.surveyId != null ? Number(draft.surveyId) : null;

  const uidParam = scope.apiKey === true ? null : scope.userId;
  let ins;
  try {
    ins = await pool.query(
      `INSERT INTO phenomenal_report_projects (user_id, title, survey_id, state_json, director_share_token)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, title, survey_id, director_share_token, created_at, updated_at`,
      [uidParam, title, Number.isFinite(sid) ? sid : null, JSON.stringify({ draft }), token],
    );
  } catch (e) {
    if (e && e.code === '23502' && /user_id|phenomenal_report/i.test(`${e.message || ''} ${e.detail || ''}`)) {
      return json(500, {
        error: 'db_schema',
        message:
          'В БД колонка user_id всё ещё NOT NULL. Выполните миграцию backend/db/migrations/020_phenomenal_report_projects_user_nullable.sql',
      });
    }
    throw e;
  }
  return json(201, { project: ins.rows[0], draft });
}

async function handleGetPhenomenalReportProject(pool, user, viaAdminKey, sessionUser, projectId) {
  const denied = requirePhenomenalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const check = await assertProjectRowScope(pool, projectId, scope);
  if (!check.ok) return json(check.code, { error: 'Not found' });

  const r = await pool.query(
    `SELECT id, title, survey_id, state_json, director_share_token, created_at, updated_at
     FROM phenomenal_report_projects WHERE id = $1`,
    [projectId],
  );
  const row = r.rows[0];
  const state = row.state_json && typeof row.state_json === 'object' ? row.state_json : {};
  const base = state.draft && typeof state.draft === 'object' ? state.draft : emptyDraft(row.title);
  const rowSid = row.survey_id != null ? Number(row.survey_id) : null;
  const outDraft = {
    ...base,
    surveyId: Number.isFinite(rowSid) ? rowSid : base.surveyId ?? null,
  };
  return json(200, { project: row, draft: outDraft });
}

async function handlePutPhenomenalReportProject(pool, user, viaAdminKey, sessionUser, projectId, event) {
  const denied = requirePhenomenalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const check = await assertProjectRowScope(pool, projectId, scope);
  if (!check.ok) return json(check.code, { error: 'Not found' });

  const body = parseBody(event) || {};
  const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;
  if (!draft) return json(400, { error: 'draft required' });

  const title =
    body.title != null
      ? String(body.title).trim().slice(0, 500)
      : String(draft.title || 'Отчёт по феноменальным урокам').slice(0, 500);

  let resolvedSurveyId = null;
  if (body.survey_id !== undefined) {
    if (body.survey_id === null || body.survey_id === '') resolvedSurveyId = null;
    else {
      const n = Number(body.survey_id);
      resolvedSurveyId = Number.isFinite(n) ? n : null;
    }
  } else if (body.surveyId !== undefined) {
    if (body.surveyId === null || body.surveyId === '') resolvedSurveyId = null;
    else {
      const n = Number(body.surveyId);
      resolvedSurveyId = Number.isFinite(n) ? n : null;
    }
  } else if (draft.surveyId != null && draft.surveyId !== '') {
    const n = Number(draft.surveyId);
    resolvedSurveyId = Number.isFinite(n) ? n : null;
  }

  const nextDraft = {
    ...draft,
    title,
    updatedAt: new Date().toISOString(),
    surveyId: resolvedSurveyId,
  };

  const updScope = scope.apiKey === true ? 'AND user_id IS NULL' : 'AND user_id = $5';
  const params =
    scope.apiKey === true
      ? [projectId, title, resolvedSurveyId, JSON.stringify({ draft: nextDraft })]
      : [projectId, title, resolvedSurveyId, JSON.stringify({ draft: nextDraft }), scope.userId];

  const u = await pool.query(
    `UPDATE phenomenal_report_projects
     SET title = $2, survey_id = $3, state_json = $4::jsonb, updated_at = NOW()
     WHERE id = $1 ${updScope}
     RETURNING id`,
    params,
  );
  if (!u.rows.length) return json(404, { error: 'Not found' });

  const r = await pool.query(
    `SELECT id, title, survey_id, director_share_token, updated_at FROM phenomenal_report_projects WHERE id = $1`,
    [projectId],
  );
  return json(200, { project: r.rows[0], draft: nextDraft });
}

async function handleDeletePhenomenalReportProject(pool, user, viaAdminKey, sessionUser, projectId) {
  const denied = requirePhenomenalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const check = await assertProjectRowScope(pool, projectId, scope);
  if (!check.ok) return json(check.code, { error: 'Not found' });

  const delScope = scope.apiKey === true ? 'AND user_id IS NULL' : 'AND user_id = $2';
  const delParams = scope.apiKey === true ? [projectId] : [projectId, scope.userId];
  const d = await pool.query(
    `DELETE FROM phenomenal_report_projects WHERE id = $1 ${delScope} RETURNING id`,
    delParams,
  );
  if (!d.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true });
}

module.exports = {
  handleListPhenomenalReportProjects,
  handlePostPhenomenalReportProject,
  handleGetPhenomenalReportProject,
  handlePutPhenomenalReportProject,
  handleDeletePhenomenalReportProject,
};

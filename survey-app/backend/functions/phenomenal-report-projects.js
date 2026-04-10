const { randomUUID } = require('crypto');
const { json, parseBody } = require('./lib/http');

function emptyDraft(title) {
  return {
    title: title || 'Отчёт по феноменальным урокам',
    periodLabel: '',
    blocks: [],
    updatedAt: new Date().toISOString(),
    surveyId: null,
  };
}

async function assertProjectOwner(pool, projectId, user) {
  if (!user || user.id == null) return { ok: false, code: 403 };
  const r = await pool.query(`SELECT id, user_id FROM phenomenal_report_projects WHERE id = $1`, [projectId]);
  if (!r.rows.length) return { ok: false, code: 404 };
  if (user.role === 'admin') return { ok: true, row: r.rows[0] };
  if (Number(r.rows[0].user_id) !== Number(user.id)) return { ok: false, code: 403 };
  return { ok: true, row: r.rows[0] };
}

async function handleListPhenomenalReportProjects(pool, user) {
  if (!user || user.id == null) return json(403, { error: 'Forbidden' });
  const r = await pool.query(
    `SELECT id, title, survey_id, director_share_token, created_at, updated_at
     FROM phenomenal_report_projects
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 100`,
    [user.id],
  );
  return json(200, { projects: r.rows });
}

async function handlePostPhenomenalReportProject(pool, user, event) {
  if (!user || user.id == null) return json(403, { error: 'Forbidden' });
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

  const ins = await pool.query(
    `INSERT INTO phenomenal_report_projects (user_id, title, survey_id, state_json, director_share_token)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, title, survey_id, director_share_token, created_at, updated_at`,
    [user.id, title, Number.isFinite(sid) ? sid : null, JSON.stringify({ draft }), token],
  );
  return json(201, { project: ins.rows[0], draft });
}

async function handleGetPhenomenalReportProject(pool, user, projectId) {
  const check = await assertProjectOwner(pool, projectId, user);
  if (!check.ok) return json(check.code, { error: 'Not found' });
  const r = await pool.query(
    `SELECT id, title, survey_id, state_json, director_share_token, created_at, updated_at
     FROM phenomenal_report_projects WHERE id = $1`,
    [projectId],
  );
  const row = r.rows[0];
  const state = row.state_json && typeof row.state_json === 'object' ? row.state_json : {};
  const base = state.draft && typeof state.draft === 'object' ? state.draft : emptyDraft(row.title);
  const sid = row.survey_id != null ? Number(row.survey_id) : null;
  const draft = {
    ...base,
    surveyId: Number.isFinite(sid) ? sid : base.surveyId ?? null,
  };
  return json(200, { project: row, draft });
}

async function handlePutPhenomenalReportProject(pool, user, projectId, event) {
  const check = await assertProjectOwner(pool, projectId, user);
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

  await pool.query(
    `UPDATE phenomenal_report_projects
     SET title = $2, survey_id = $3, state_json = $4::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [projectId, title, resolvedSurveyId, JSON.stringify({ draft: nextDraft })],
  );
  const r = await pool.query(
    `SELECT id, title, survey_id, director_share_token, updated_at FROM phenomenal_report_projects WHERE id = $1`,
    [projectId],
  );
  return json(200, { project: r.rows[0], draft: nextDraft });
}

async function handleDeletePhenomenalReportProject(pool, user, projectId) {
  const check = await assertProjectOwner(pool, projectId, user);
  if (!check.ok) return json(check.code, { error: 'Not found' });
  await pool.query(`DELETE FROM phenomenal_report_projects WHERE id = $1`, [projectId]);
  return json(200, { ok: true });
}

module.exports = {
  handleListPhenomenalReportProjects,
  handlePostPhenomenalReportProject,
  handleGetPhenomenalReportProject,
  handlePutPhenomenalReportProject,
  handleDeletePhenomenalReportProject,
};

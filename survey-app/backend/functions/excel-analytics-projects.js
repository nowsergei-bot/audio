const { json, parseBody } = require('./lib/http');

/** Postgres SQLSTATE 23502 — нарушение NOT NULL (часто user_id до миграции 016). */
function isNotNullUserIdExcelProjectsError(err) {
  if (!err || err.code !== '23502') return false;
  const t = `${err.message || ''} ${err.detail || ''}`;
  return /user_id|excel_analytics_projects/i.test(t);
}

function jsonExcelProjectsSchemaMigrationNeeded() {
  return json(500, {
    error: 'db_schema',
    message:
      'В базе не применена миграция 016: колонка user_id должна допускать NULL для сохранения по API-ключу. Выполните backend/db/migrations/016_excel_analytics_projects_api_key.sql к этой БД и снова задеплойте функцию.',
  });
}

function validateSessionPayload(s) {
  if (!s || typeof s !== 'object') return 'Некорректное тело session';
  if (s.v !== 1) return 'Ожидается session.v === 1';
  if (typeof s.fingerprint !== 'string' || !s.fingerprint.trim()) return 'Нет fingerprint в session';
  if (typeof s.fileName !== 'string') return 'Нет fileName в session';
  if (typeof s.sheet !== 'string') return 'Нет sheet в session';
  if (typeof s.headerRow1Based !== 'number' || !Number.isFinite(s.headerRow1Based)) return 'Некорректная строка заголовков';
  if (!Array.isArray(s.headers) || !Array.isArray(s.roles)) return 'Некорректные headers/roles в session';
  return null;
}

/**
 * @returns {{ ok: true, userId: number } | { ok: true, apiKey: true } | { ok: false }}
 * При X-Api-Key + Bearer владелец — пользователь из сессии (иначе POST пишет user_id, GET по ключу — 404).
 */
function resolveProjectOwner(user, viaAdminKey, sessionUser) {
  if (sessionUser && sessionUser.id != null) {
    return { ok: true, userId: Number(sessionUser.id) };
  }
  if (user && user.id != null) return { ok: true, userId: Number(user.id) };
  if (viaAdminKey) return { ok: true, apiKey: true };
  return { ok: false };
}

function requireProjectAccess(user, viaAdminKey, sessionUser) {
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  if (!scope.ok) {
    return json(403, {
      error: 'excel_projects_auth',
      message: 'Нужна авторизация: Bearer-сессия или X-Api-Key в заголовке.',
    });
  }
  return null;
}

async function handleGetExcelAnalyticsProjects(pool, user, viaAdminKey, sessionUser) {
  const denied = requireProjectAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(
          `SELECT id, title, fingerprint, file_name, updated_at,
                  session_json->>'sheet' AS sheet
           FROM excel_analytics_projects
           WHERE user_id IS NULL
           ORDER BY updated_at DESC
           LIMIT 50`,
        )
      : await pool.query(
          `SELECT id, title, fingerprint, file_name, updated_at,
                  session_json->>'sheet' AS sheet
           FROM excel_analytics_projects
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT 50`,
          [scope.userId],
        );
  return json(200, { projects: r.rows });
}

async function handleGetExcelAnalyticsProject(pool, user, viaAdminKey, sessionUser, id) {
  const denied = requireProjectAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(
          `SELECT id, title, fingerprint, file_name, session_json, created_at, updated_at
           FROM excel_analytics_projects
           WHERE id = $1 AND user_id IS NULL`,
          [id],
        )
      : await pool.query(
          `SELECT id, title, fingerprint, file_name, session_json, created_at, updated_at
           FROM excel_analytics_projects
           WHERE id = $1 AND user_id = $2`,
          [id, scope.userId],
        );
  if (!r.rows.length) return json(404, { error: 'Not found' });
  const row = r.rows[0];
  return json(200, {
    project: {
      id: row.id,
      title: row.title,
      fingerprint: row.fingerprint,
      file_name: row.file_name,
      session: row.session_json,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

async function handlePostExcelAnalyticsProject(pool, user, viaAdminKey, sessionUser, event) {
  const denied = requireProjectAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const body = parseBody(event) || {};
  const err = validateSessionPayload(body.session);
  if (err) return json(400, { error: err });
  const title = String(body.title || '').trim() || 'Без названия';
  const session = body.session;
  const fingerprint = session.fingerprint;
  const file_name = String(session.fileName || '').trim() || 'file.xlsx';
  const session_json = JSON.stringify(session);

  try {
    if (body.id != null) {
      const id = Number(body.id);
      if (!Number.isFinite(id) || id < 1) return json(400, { error: 'Invalid id' });
      const upd =
        scope.apiKey === true
          ? await pool.query(
              `UPDATE excel_analytics_projects
               SET title = $1, fingerprint = $2, file_name = $3, session_json = $4::jsonb, updated_at = NOW()
               WHERE id = $5 AND user_id IS NULL
               RETURNING id, title, updated_at`,
              [title, fingerprint, file_name, session_json, id],
            )
          : await pool.query(
              `UPDATE excel_analytics_projects
               SET title = $1, fingerprint = $2, file_name = $3, session_json = $4::jsonb, updated_at = NOW()
               WHERE id = $5 AND user_id = $6
               RETURNING id, title, updated_at`,
              [title, fingerprint, file_name, session_json, id, scope.userId],
            );
      if (!upd.rows.length) return json(404, { error: 'Not found' });
      return json(200, { project: upd.rows[0] });
    }

    const ins =
      scope.apiKey === true
        ? await pool.query(
            `INSERT INTO excel_analytics_projects (user_id, title, fingerprint, file_name, session_json)
             VALUES (NULL, $1, $2, $3, $4::jsonb)
             RETURNING id, title, updated_at`,
            [title, fingerprint, file_name, session_json],
          )
        : await pool.query(
            `INSERT INTO excel_analytics_projects (user_id, title, fingerprint, file_name, session_json)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING id, title, updated_at`,
            [scope.userId, title, fingerprint, file_name, session_json],
          );
    return json(201, { project: ins.rows[0] });
  } catch (e) {
    if (isNotNullUserIdExcelProjectsError(e)) return jsonExcelProjectsSchemaMigrationNeeded();
    throw e;
  }
}

async function handleDeleteExcelAnalyticsProject(pool, user, viaAdminKey, sessionUser, id) {
  const denied = requireProjectAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolveProjectOwner(user, viaAdminKey, sessionUser);
  const r =
    scope.apiKey === true
      ? await pool.query(`DELETE FROM excel_analytics_projects WHERE id = $1 AND user_id IS NULL RETURNING id`, [id])
      : await pool.query(`DELETE FROM excel_analytics_projects WHERE id = $1 AND user_id = $2 RETURNING id`, [
          id,
          scope.userId,
        ]);
  if (!r.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true, id: r.rows[0].id });
}

module.exports = {
  handleGetExcelAnalyticsProjects,
  handleGetExcelAnalyticsProject,
  handlePostExcelAnalyticsProject,
  handleDeleteExcelAnalyticsProject,
};

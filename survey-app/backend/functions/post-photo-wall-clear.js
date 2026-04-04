const { json, parseBody } = require('./lib/http');
const { purgePhotoWallObjectStorage, shouldUsePhotoWallStorage } = require('./lib/photo-wall-s3');

/**
 * Управление стеной: массовое удаление записей (только админ / API-ключ).
 * body: { confirm: true, scope: 'approved' | 'pending' | 'rejected' | 'all'
 *        [, purge_object_storage: true] } — последнее только при scope=all: удалить объекты photo-wall/ в бакете.
 */
async function handlePostPhotoWallClear(pool, event) {
  const body = parseBody(event) || {};
  if (body.confirm !== true) {
    return json(400, {
      error: 'confirm_required',
      message: 'Передайте confirm: true в теле запроса.',
    });
  }
  const scope = String(body.scope || 'approved').toLowerCase();
  const allowed = new Set(['approved', 'pending', 'rejected', 'all']);
  if (!allowed.has(scope)) {
    return json(400, {
      error: 'invalid_scope',
      message: 'scope должен быть: approved, pending, rejected или all.',
    });
  }
  const wantPurge = scope === 'all' && body.purge_object_storage === true;

  try {
    let deleted;
    if (scope === 'all') {
      const r = await pool.query('DELETE FROM photo_wall_uploads');
      deleted = r.rowCount;
    } else {
      const r = await pool.query(
        `DELETE FROM photo_wall_uploads WHERE moderation_status = $1::text`,
        [scope],
      );
      deleted = r.rowCount;
    }

    let storage_deleted = 0;
    let storage_skipped = false;
    let storage_error = null;
    if (wantPurge) {
      if (!shouldUsePhotoWallStorage()) {
        storage_skipped = true;
      } else {
        try {
          const pr = await purgePhotoWallObjectStorage();
          storage_deleted = pr.deleted;
          storage_skipped = Boolean(pr.skipped);
        } catch (e) {
          console.error('[post-photo-wall-clear] s3 purge', e);
          storage_error = String(e && e.message ? e.message : e);
        }
      }
    }

    return json(200, {
      ok: true,
      deleted: Number(deleted || 0),
      scope,
      ...(wantPurge
        ? { storage_deleted, storage_skipped, ...(storage_error ? { storage_error } : {}) }
        : {}),
    });
  } catch (e) {
    console.error('[post-photo-wall-clear]', e);
    return json(500, {
      error: 'photo_wall_clear_failed',
      message: String(e && e.message ? e.message : e),
    });
  }
}

module.exports = { handlePostPhotoWallClear };

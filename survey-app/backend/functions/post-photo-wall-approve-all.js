const { json } = require('./lib/http');

/** Все pending → approved (админ / API-ключ). */
async function handlePostPhotoWallApproveAll(pool) {
  try {
    const r = await pool.query(
      `UPDATE photo_wall_uploads SET moderation_status = 'approved' WHERE moderation_status = 'pending'`,
    );
    return json(200, { ok: true, updated: Number(r.rowCount || 0) });
  } catch (e) {
    console.error('[post-photo-wall-approve-all]', e);
    return json(500, {
      error: 'photo_wall_approve_all_failed',
      message: String(e && e.message ? e.message : e),
    });
  }
}

module.exports = { handlePostPhotoWallApproveAll };

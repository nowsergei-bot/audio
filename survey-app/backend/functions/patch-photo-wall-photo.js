const { json, parseBody } = require('./lib/http');

async function handlePatchPhotoWallPhoto(pool, event, photoId) {
  const body = parseBody(event) || {};
  const status = body.moderation_status != null ? String(body.moderation_status).trim() : '';
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return json(400, { error: 'moderation_status: ожидается pending, approved или rejected' });
  }
  const r = await pool.query(
    `UPDATE photo_wall_uploads SET moderation_status = $1::text WHERE id = $2 RETURNING id`,
    [status, photoId],
  );
  if (!r.rows.length) return json(404, { error: 'Not found' });
  return json(200, { ok: true, id: photoId, moderation_status: status });
}

module.exports = { handlePatchPhotoWallPhoto };

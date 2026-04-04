const { json } = require('./lib/http');
const { isPhotoWallTableMissingError } = require('./lib/photo-wall-fallback');

function isMissingUrlColumnError(e) {
  const m = String(e && e.message ? e.message : e);
  return (
    (e && e.code === '42703' && /image_public_url/i.test(m)) ||
    (/image_public_url/i.test(m) && /does not exist/i.test(m))
  );
}

/** Одно полное фото для модерации: сначала публичный URL (статика), иначе data URL из БД. */
async function handleGetPhotoWallPhotoFull(pool, id) {
  try {
    let r;
    try {
      r = await pool.query(
        `SELECT id, image_public_url, image_data FROM photo_wall_uploads WHERE id = $1::int LIMIT 1`,
        [id],
      );
    } catch (e) {
      if (isMissingUrlColumnError(e)) {
        r = await pool.query(
          `SELECT id, image_data FROM photo_wall_uploads WHERE id = $1::int LIMIT 1`,
          [id],
        );
      } else {
        throw e;
      }
    }
    if (!r.rows.length) return json(404, { error: 'Not found' });
    const row = r.rows[0];
    const pub = row.image_public_url != null ? String(row.image_public_url).trim() : '';
    if (pub) {
      return json(200, { id: row.id, image_url: pub });
    }
    return json(200, { id: row.id, image_data: row.image_data });
  } catch (e) {
    console.error('[get-photo-wall-photo-full]', e);
    if (isPhotoWallTableMissingError(e)) {
      return json(404, { error: 'Not found' });
    }
    return json(500, {
      error: 'photo_wall_full_failed',
      message: String(e && e.message ? e.message : e),
    });
  }
}

module.exports = { handleGetPhotoWallPhotoFull };

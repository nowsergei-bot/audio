const { json } = require('./lib/http');
const { isMissingThumbColumnError, isPhotoWallTableMissingError } = require('./lib/photo-wall-fallback');

const MAX_ADMIN_ROWS = 120;

/** Новые колонки URL + встраиваемые data URL (миграции 011–012). */
const LIST_WITH_URLS_SQL = `
SELECT id,
       respondent_id,
       created_at,
       moderation_status,
       NULLIF(trim(COALESCE(thumb_public_url, '')), '') AS thumb_public_url,
       NULLIF(trim(COALESCE(image_public_url, '')), '') AS image_public_url,
       NULLIF(trim(COALESCE(thumb_data, '')), '') AS thumb_data_embed,
       NULLIF(trim(COALESCE(image_data, '')), '') AS image_data_embed
FROM photo_wall_uploads
ORDER BY
  CASE moderation_status
    WHEN 'pending' THEN 0
    WHEN 'approved' THEN 1
    ELSE 2
  END,
  created_at ASC
LIMIT $1::int`;

const LIST_WITH_THUMB_SQL = `
SELECT id,
       respondent_id,
       created_at,
       moderation_status,
       NULLIF(trim(COALESCE(thumb_data, '')), '') AS preview_data,
       (NULLIF(trim(COALESCE(thumb_data, '')), '') IS NULL) AS needs_full_image
FROM photo_wall_uploads
ORDER BY
  CASE moderation_status
    WHEN 'pending' THEN 0
    WHEN 'approved' THEN 1
    ELSE 2
  END,
  created_at ASC
LIMIT $1::int`;

const LIST_NO_THUMB_SQL = `
SELECT id,
       respondent_id,
       created_at,
       moderation_status
FROM photo_wall_uploads
ORDER BY
  CASE moderation_status
    WHEN 'pending' THEN 0
    WHEN 'approved' THEN 1
    ELSE 2
  END,
  created_at ASC
LIMIT $1::int`;

function mapRowsWithUrls(rows) {
  return rows.map((row) => {
    const preview_data =
      row.thumb_public_url ||
      row.thumb_data_embed ||
      row.image_public_url ||
      '';
    const needs_full_image = !preview_data && Boolean(row.image_data_embed);
    return {
      id: row.id,
      respondent_id: row.respondent_id,
      created_at: row.created_at,
      moderation_status: row.moderation_status,
      preview_data,
      needs_full_image,
    };
  });
}

function mapRowsWithThumb(rows) {
  return rows.map((row) => ({
    id: row.id,
    respondent_id: row.respondent_id,
    created_at: row.created_at,
    moderation_status: row.moderation_status,
    preview_data: row.preview_data || '',
    needs_full_image: Boolean(row.needs_full_image),
  }));
}

function mapRowsNoThumb(rows) {
  return rows.map((row) => ({
    id: row.id,
    respondent_id: row.respondent_id,
    created_at: row.created_at,
    moderation_status: row.moderation_status,
    preview_data: '',
    needs_full_image: true,
  }));
}

function isMissingUrlColumnError(e) {
  const m = String(e && e.message ? e.message : e);
  return (
    (e && e.code === '42703' && /thumb_public_url|image_public_url/i.test(m)) ||
    (/(thumb_public_url|image_public_url)/i.test(m) && /does not exist/i.test(m))
  );
}

async function handleGetPhotoWallPhotos(pool) {
  try {
    const r = await pool.query(LIST_WITH_URLS_SQL, [MAX_ADMIN_ROWS]);
    return json(200, { photos: mapRowsWithUrls(r.rows) });
  } catch (e) {
    console.error('[get-photo-wall-photos]', e);
    if (isPhotoWallTableMissingError(e)) {
      return json(200, { photos: [] });
    }
    if (isMissingUrlColumnError(e)) {
      try {
        const r2 = await pool.query(LIST_WITH_THUMB_SQL, [MAX_ADMIN_ROWS]);
        return json(200, { photos: mapRowsWithThumb(r2.rows) });
      } catch (e2) {
        if (isMissingThumbColumnError(e2)) {
          try {
            const r3 = await pool.query(LIST_NO_THUMB_SQL, [MAX_ADMIN_ROWS]);
            return json(200, { photos: mapRowsNoThumb(r3.rows) });
          } catch (e3) {
            console.error('[get-photo-wall-photos] fallback', e3);
            return json(500, {
              error: 'photo_wall_list_failed',
              message: String(e3 && e3.message ? e3.message : e3),
            });
          }
        }
        console.error('[get-photo-wall-photos] thumb-only', e2);
        return json(500, {
          error: 'photo_wall_list_failed',
          message: String(e2 && e2.message ? e2.message : e2),
        });
      }
    }
    return json(500, {
      error: 'photo_wall_list_failed',
      message: String(e && e.message ? e.message : e),
    });
  }
}

module.exports = { handleGetPhotoWallPhotos };

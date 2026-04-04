const { json } = require('./lib/http');
const { isMissingThumbColumnError, isPhotoWallTableMissingError } = require('./lib/photo-wall-fallback');

const MAX_APPROVED_WITH_URLS = 400;
const MAX_APPROVED_WITH_THUMB = 72;
const MAX_APPROVED_LEGACY_FULL = 12;

const WITH_URLS_SQL = `
SELECT id,
       COALESCE(
         NULLIF(trim(image_public_url), ''),
         NULLIF(trim(image_data), '')
       ) AS image_data
FROM photo_wall_uploads
WHERE moderation_status = 'approved'
  AND (
    NULLIF(trim(image_public_url), '') IS NOT NULL
    OR NULLIF(trim(image_data), '') IS NOT NULL
  )
ORDER BY created_at DESC
LIMIT $1::int`;

const WITH_THUMB_SQL = `
SELECT id,
       COALESCE(NULLIF(trim(COALESCE(thumb_data, '')), ''), image_data) AS image_data
FROM photo_wall_uploads
WHERE moderation_status = 'approved'
ORDER BY
  CASE WHEN NULLIF(trim(COALESCE(thumb_data, '')), '') IS NULL THEN 1 ELSE 0 END ASC,
  created_at DESC
LIMIT $1::int`;

const LEGACY_SQL = `
SELECT id, image_data
FROM photo_wall_uploads
WHERE moderation_status = 'approved'
ORDER BY created_at DESC
LIMIT $1::int`;

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/** Когда все снимки — короткие URL (не base64), можно кэшировать ответ в браузере — меньше запросов к функции и к Neon. */
const LIGHT_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=25',
};

const PAYLOAD_BUDGET_CHARS = Math.floor(2.65 * 1024 * 1024);

function isMissingUrlColumnError(e) {
  const m = String(e && e.message ? e.message : e);
  return (
    (e && e.code === '42703' && /image_public_url/i.test(m)) ||
    (/image_public_url/i.test(m) && /does not exist/i.test(m))
  );
}

function packPhotosWithinBudget(rows) {
  const photos = [];
  let used = 120;
  let truncated = false;
  for (const row of rows) {
    const id = row.id;
    const image_data = String(row.image_data || '');
    const rowBytes = image_data.length + String(id).length + 48;
    if (rowBytes > PAYLOAD_BUDGET_CHARS - 200) {
      truncated = true;
      continue;
    }
    if (used + rowBytes > PAYLOAD_BUDGET_CHARS) {
      truncated = true;
      break;
    }
    used += rowBytes;
    photos.push({ id, image_data });
  }
  if (!truncated && photos.length < rows.length) truncated = true;
  const payload = { photos };
  if (truncated) {
    payload.truncated = true;
    payload.photo_wall_hint =
      'Часть одобренных снимков не влезла в ответ. Включите PHOTO_WALL_STORAGE=1 и миграцию 012 (URL вместо base64 в JSON) или уменьшите число тяжёлых data URL в базе.';
  }
  return payload;
}

async function handleGetPublicPhotoWallApproved(pool) {
  try {
    const r = await pool.query(WITH_URLS_SQL, [MAX_APPROVED_WITH_URLS]);
    const allUrls =
      r.rows.length === 0 ||
      r.rows.every((row) => {
        const s = String(row.image_data || '');
        return s.startsWith('https://') || s.startsWith('http://');
      });
    if (allUrls) {
      return json(
        200,
        { photos: r.rows.map((row) => ({ id: row.id, image_data: row.image_data })) },
        LIGHT_CACHE_HEADERS,
      );
    }
    return json(200, packPhotosWithinBudget(r.rows), CACHE_HEADERS);
  } catch (e) {
    console.error('[get-public-photo-wall-approved]', e);
    const msg = String(e && e.message ? e.message : e);

    if (isPhotoWallTableMissingError(e)) {
      return json(200, { photos: [] }, CACHE_HEADERS);
    }

    if (isMissingUrlColumnError(e)) {
      try {
        const r1 = await pool.query(WITH_THUMB_SQL, [MAX_APPROVED_WITH_THUMB]);
        return json(200, packPhotosWithinBudget(r1.rows), CACHE_HEADERS);
      } catch (e1) {
        if (isMissingThumbColumnError(e1)) {
          try {
            const r2 = await pool.query(LEGACY_SQL, [MAX_APPROVED_LEGACY_FULL]);
            return json(200, packPhotosWithinBudget(r2.rows), CACHE_HEADERS);
          } catch (e2) {
            console.error('[get-public-photo-wall-approved] legacy', e2);
            if (isPhotoWallTableMissingError(e2)) {
              return json(200, { photos: [] }, CACHE_HEADERS);
            }
            return json(500, {
              error: 'photo_wall_approved_failed',
              message: String(e2 && e2.message ? e2.message : e2),
            });
          }
        }
        return json(500, {
          error: 'photo_wall_approved_failed',
          message: String(e1 && e1.message ? e1.message : e1),
        });
      }
    }

    if (/invalid string length|Maximum call stack/i.test(msg)) {
      return json(413, {
        error: 'photo_wall_payload_too_large',
        message:
          'Слишком тяжёлый ответ. Включите Object Storage для фотостены (PHOTO_WALL_STORAGE=1) или уменьшите число одобренных.',
      });
    }

    // Последний шанс: только id + image_data (схема миграции 009), если основной запрос упал по другой причине
    try {
      const r3 = await pool.query(LEGACY_SQL, [MAX_APPROVED_LEGACY_FULL]);
      return json(200, packPhotosWithinBudget(r3.rows), CACHE_HEADERS);
    } catch (e3) {
      console.error('[get-public-photo-wall-approved] legacy last-resort', e3);
      if (isPhotoWallTableMissingError(e3)) {
        return json(200, { photos: [] }, CACHE_HEADERS);
      }
    }

    return json(500, {
      error: 'photo_wall_approved_failed',
      message: msg,
    });
  }
}

module.exports = { handleGetPublicPhotoWallApproved };

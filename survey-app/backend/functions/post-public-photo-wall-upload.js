const crypto = require('crypto');
const { json, parseBody } = require('./lib/http');
const { isMissingThumbColumnError, isPhotoWallTableMissingError } = require('./lib/photo-wall-fallback');
const { shouldUsePhotoWallStorage, uploadPhotoWallPair } = require('./lib/photo-wall-s3');

const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
const MAX_THUMB_CHARS = 450 * 1024;

function validateImageData(s) {
  if (typeof s !== 'string') return 'Нужно поле image_data (data URL)';
  if (s.length > MAX_IMAGE_CHARS) return 'Файл слишком большой';
  const low = s.slice(0, 48).toLowerCase();
  if (!low.startsWith('data:image/')) return 'Ожидается data URL (data:image/…)';
  if (!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/.test(low)) {
    return 'Допустимы только JPEG, PNG, GIF или WebP в кодировке base64';
  }
  return null;
}

function validateThumbData(s) {
  if (s == null || s === '') return null;
  if (typeof s !== 'string') return 'thumb_data должен быть строкой';
  if (s.length > MAX_THUMB_CHARS) return 'Превью слишком большое';
  const low = s.slice(0, 48).toLowerCase();
  if (!low.startsWith('data:image/')) return 'thumb_data: ожидается data URL';
  if (!/^data:image\/(jpeg|jpg);base64,/.test(low)) {
    return 'thumb_data: только JPEG data URL';
  }
  return null;
}

const SQL_STORAGE = `
  INSERT INTO photo_wall_uploads (
    respondent_id, image_data, thumb_data, thumb_public_url, image_public_url, moderation_status
  )
  VALUES ($1, NULL, NULL, $2, $3, 'pending')
  ON CONFLICT (respondent_id)
  DO UPDATE SET
    image_data = NULL,
    thumb_data = NULL,
    thumb_public_url = EXCLUDED.thumb_public_url,
    image_public_url = EXCLUDED.image_public_url,
    moderation_status = 'pending'`;

const sqlWithThumb = `
    INSERT INTO photo_wall_uploads (respondent_id, image_data, thumb_data, moderation_status)
    VALUES ($1, $2, $3, 'pending')
    ON CONFLICT (respondent_id)
    DO UPDATE SET
      image_data = EXCLUDED.image_data,
      thumb_data = COALESCE(EXCLUDED.thumb_data, photo_wall_uploads.thumb_data),
      moderation_status = 'pending'`;
const sqlNoThumb = `
    INSERT INTO photo_wall_uploads (respondent_id, image_data, moderation_status)
    VALUES ($1, $2, 'pending')
    ON CONFLICT (respondent_id)
    DO UPDATE SET image_data = EXCLUDED.image_data, moderation_status = 'pending'`;

async function handlePostPublicPhotoWallUpload(pool, event) {
  const body = parseBody(event) || {};
  const respondent_id = body.respondent_id != null ? String(body.respondent_id).trim() : '';
  if (!respondent_id || respondent_id.length > 512) {
    return json(400, { error: 'respondent_id is required (max 512 chars)' });
  }

  const image_data = body.image_data != null ? String(body.image_data) : '';
  const verr = validateImageData(image_data);
  if (verr) {
    return json(400, { error: verr });
  }

  const thumb_raw = body.thumb_data != null ? String(body.thumb_data) : '';
  const terr = validateThumbData(thumb_raw);
  if (terr) {
    return json(400, { error: terr });
  }
  const thumb_data = thumb_raw.trim() ? thumb_raw : null;

  if (shouldUsePhotoWallStorage()) {
    try {
      const uploadId = crypto.randomUUID();
      const { image_public_url, thumb_public_url } = await uploadPhotoWallPair({
        uploadId,
        fullDataUrl: image_data,
        thumbDataUrl: thumb_data,
      });
      await pool.query(SQL_STORAGE, [respondent_id, thumb_public_url, image_public_url]);
    } catch (e) {
      console.error('[post-public-photo-wall-upload] storage', e);
      const msg = String(e && e.message ? e.message : e);
      if (isPhotoWallTableMissingError(e)) {
        return json(503, {
          error: 'photo_wall_table_missing',
          message: 'Выполните миграции backend/db/migrations/009_photo_wall_uploads.sql и далее (012 для Object Storage).',
        });
      }
      if (/column .* does not exist/i.test(msg) || e.code === '42703') {
        return json(503, {
          error: 'photo_wall_schema_outdated',
          message:
            'Для PHOTO_WALL_STORAGE=1 нужны миграции 011 (thumb_data) и 012 (thumb_public_url, image_public_url, image_data nullable).',
        });
      }
      return json(502, {
        error: 'photo_wall_storage_failed',
        message: msg,
      });
    }
    return json(201, { ok: true });
  }

  try {
    await pool.query(sqlWithThumb, [respondent_id, image_data, thumb_data]);
  } catch (e) {
    if (isMissingThumbColumnError(e)) {
      try {
        await pool.query(sqlNoThumb, [respondent_id, image_data]);
      } catch (e2) {
        console.error('[post-public-photo-wall-upload] no-thumb insert', e2);
        if (isPhotoWallTableMissingError(e2)) {
          return json(503, {
            error: 'photo_wall_table_missing',
            message: 'Выполните миграцию backend/db/migrations/009_photo_wall_uploads.sql',
          });
        }
        return json(500, {
          error: 'photo_wall_upload_failed',
          message: String(e2 && e2.message ? e2.message : e2),
        });
      }
    } else {
      console.error('[post-public-photo-wall-upload]', e);
      return json(500, {
        error: 'photo_wall_upload_failed',
        message: String(e && e.message ? e.message : e),
      });
    }
  }

  return json(201, { ok: true });
}

module.exports = { handlePostPublicPhotoWallUpload };

/** Колонка thumb_data ещё не создана (миграция 011). */
function isMissingThumbColumnError(e) {
  const code = e && e.code;
  const m = String(e && e.message ? e.message : e);
  if (code === '42703' && /thumb_data/i.test(m)) return true;
  if (/thumb_data/i.test(m) && /does not exist/i.test(m)) return true;
  return false;
}

/** Таблицы фотостены нет (миграция 009). */
function isPhotoWallTableMissingError(e) {
  const code = e && e.code;
  const m = String(e && e.message ? e.message : e);
  if (code === '42P01') return true;
  if (/photo_wall_uploads/i.test(m) && /does not exist/i.test(m)) return true;
  return false;
}

module.exports = { isMissingThumbColumnError, isPhotoWallTableMissingError };

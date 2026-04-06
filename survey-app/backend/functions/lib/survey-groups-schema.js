/**
 * До применения миграции survey_groups / survey_group_id запросы с JOIN падают.
 * 42P01 — undefined_table, 42703 — undefined_column (PostgreSQL).
 */
function isSurveyGroupSchemaError(err) {
  if (!err) return false;
  if (err.code === '42P01') return true;
  if (err.code === '42703') {
    const m = String(err.message || '');
    return /survey_group/i.test(m);
  }
  return false;
}

module.exports = { isSurveyGroupSchemaError };

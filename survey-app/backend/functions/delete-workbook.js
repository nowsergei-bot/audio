const { json } = require('./lib/http');

async function handleDeleteWorkbook(pool, surveyId, workbookId) {
  const r = await pool.query(
    `DELETE FROM survey_workbooks WHERE id = $1 AND survey_id = $2 RETURNING id`,
    [workbookId, surveyId]
  );
  if (!r.rows.length) return json(404, { error: 'Файл не найден' });
  return json(200, { ok: true });
}

module.exports = { handleDeleteWorkbook };

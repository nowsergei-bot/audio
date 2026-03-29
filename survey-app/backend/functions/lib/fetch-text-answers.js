const { loadSurveyWithQuestions } = require('../get-survey');

/**
 * Текст свободного ответа из answer_values.value (JSONB).
 * Учитывает: строку, число, массив (в т.ч. из импорта), объект, JSON-строку внутри строки.
 * Раньше [] / объекты давали String([])==="" и на дашборде был «1 ответ» при пустой выборке.
 */
function parseJsonbText(val, depth = 0) {
  if (val == null) return '';
  if (depth > 8) return '';

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return '';
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== val) {
        const inner = parseJsonbText(parsed, depth + 1);
        if (inner !== '') return inner;
      }
    } catch {
      /* не JSON — оставляем как сырой текст */
    }
    return val;
  }

  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }

  if (Array.isArray(val)) {
    return val
      .map((x) => parseJsonbText(x, depth + 1))
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  }

  if (typeof val === 'object') {
    if (val.text != null) return parseJsonbText(val.text, depth + 1);
    if (val.answer != null) return parseJsonbText(val.answer, depth + 1);
    if (val.value != null) return parseJsonbText(val.value, depth + 1);
    const vals = Object.values(val).filter((v) => v != null);
    if (vals.length === 0) return '';
    if (vals.length === 1) return parseJsonbText(vals[0], depth + 1);
    return vals
      .map((v) => parseJsonbText(v, depth + 1))
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  }

  return String(val).trim();
}

function escapeLike(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} surveyId
 * @param {{ question_id?: number | null, q?: string, limit?: number, offset?: number }} opts
 */
async function fetchTextAnswersPage(pool, surveyId, opts) {
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return { error: 'NOT_FOUND', rows: [], total: 0 };

  const textQIds = survey.questions.filter((q) => q.type === 'text').map((q) => Number(q.id));
  if (!textQIds.length) {
    return { rows: [], total: 0, question_ids: [] };
  }

  let filterIds = textQIds;
  const qid = opts.question_id;
  if (qid != null && Number.isFinite(Number(qid))) {
    const n = Number(qid);
    if (!textQIds.includes(n)) {
      return { error: 'BAD_QUESTION', rows: [], total: 0 };
    }
    filterIds = [n];
  }

  const limit = Math.min(150, Math.max(1, Number(opts.limit) || 40));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const searchRaw = String(opts.q || '').trim().slice(0, 200);
  const searchPattern = searchRaw ? `%${escapeLike(searchRaw).toLowerCase()}%` : null;

  /* #>> '{}' для скаляров ок; для массивов/объектов — полный ::text, иначе поиск и счёт «теряли» ответы */
  const searchClause = searchPattern
    ? ` AND LOWER(av.value::text) LIKE $3 ESCAPE '\\'`
    : '';

  const countSql = `
    SELECT COUNT(*)::int AS c
    FROM answer_values av
    INNER JOIN responses r ON r.id = av.response_id
    WHERE r.survey_id = $1
      AND av.question_id = ANY($2::int[])
      ${searchClause}
  `;
  const countParams = searchPattern ? [surveyId, filterIds, searchPattern] : [surveyId, filterIds];
  const totalRow = await pool.query(countSql, countParams);
  const total = totalRow.rows[0]?.c ?? 0;

  const limIdx = searchPattern ? 4 : 3;
  const offIdx = searchPattern ? 5 : 4;
  const dataSql = `
    SELECT av.question_id, av.value, r.submitted_at::text AS submitted_at
    FROM answer_values av
    INNER JOIN responses r ON r.id = av.response_id
    WHERE r.survey_id = $1
      AND av.question_id = ANY($2::int[])
      ${searchClause}
    ORDER BY r.submitted_at DESC NULLS LAST, av.id DESC
    LIMIT $${limIdx} OFFSET $${offIdx}
  `;
  const dataParams = searchPattern
    ? [surveyId, filterIds, searchPattern, limit, offset]
    : [surveyId, filterIds, limit, offset];

  const rowsRes = await pool.query(dataSql, dataParams);

  const rows = rowsRes.rows.map((row) => ({
    question_id: row.question_id,
    text: parseJsonbText(row.value).trim(),
    submitted_at: row.submitted_at || '',
  }));

  return { rows, total, question_ids: textQIds };
}

module.exports = { fetchTextAnswersPage, parseJsonbText };

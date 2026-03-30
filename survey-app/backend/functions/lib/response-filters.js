/**
 * Срезы результатов: пересечение ответов по условиям question_id + value.
 */

function buildJsonbMatchParam(question, valueStr) {
  const t = String(question.type);
  const s = String(valueStr ?? '').trim();
  if (!s) return null;
  if (t === 'scale' || t === 'rating') {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return JSON.stringify(n);
  }
  if (t === 'checkbox') {
    return JSON.stringify([s]);
  }
  return JSON.stringify(s);
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} surveyId
 * @param {Array<{ id: number; type: string; text?: string }>} questions
 * @param {Array<{ question_id: number; value: string }>} filters
 * @returns {Promise<Set<number> | null>} null = без фильтра (все ответы); пустой Set = нет совпадений
 */
async function resolveFilteredResponseIds(pool, surveyId, questions, filters) {
  const byId = new Map(questions.map((q) => [Number(q.id), q]));
  const normalized = [];
  for (const f of filters || []) {
    const qid = Number(f.question_id);
    if (!Number.isFinite(qid)) continue;
    const q = byId.get(qid);
    if (!q) continue;
    const param = buildJsonbMatchParam(q, f.value);
    if (!param) continue;
    normalized.push({ qid, q, param });
  }
  if (!normalized.length) return null;

  let idSet = null;
  for (const { qid, q, param } of normalized) {
    const isCheckbox = String(q.type) === 'checkbox';
    const sql = isCheckbox
      ? `SELECT r.id FROM responses r
         INNER JOIN answer_values av ON av.response_id = r.id
         WHERE r.survey_id = $1 AND av.question_id = $2 AND av.value @> $3::jsonb`
      : `SELECT r.id FROM responses r
         INNER JOIN answer_values av ON av.response_id = r.id
         WHERE r.survey_id = $1 AND av.question_id = $2 AND av.value = $3::jsonb`;
    const r = await pool.query(sql, [surveyId, qid, param]);
    const next = new Set(r.rows.map((x) => Number(x.id)));
    if (idSet === null) idSet = next;
    else idSet = new Set([...idSet].filter((id) => next.has(id)));
    if (idSet.size === 0) break;
  }
  return idSet;
}

function normalizeFiltersFromBody(body) {
  const raw = body && Array.isArray(body.filters) ? body.filters : [];
  const out = [];
  for (const f of raw) {
    const qid = Number(f.question_id);
    if (!Number.isFinite(qid)) continue;
    const value = String(f.value ?? '').trim();
    if (!value) continue;
    out.push({ question_id: qid, value });
  }
  return out;
}

module.exports = {
  resolveFilteredResponseIds,
  buildJsonbMatchParam,
  normalizeFiltersFromBody,
};

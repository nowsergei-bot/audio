'use strict';

const { parseJsonbText } = require('./fetch-text-answers');
const {
  lessonKeyFromParts,
  findResponseIdsForLessonKey,
  fetchResponseLessonRows,
} = require('./director-lesson-groups');

function normalizeKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»""„"]/g, '')
    .trim();
}

function labelsRoughEqual(a, b) {
  const x = normalizeKeyPart(a);
  const y = normalizeKeyPart(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function teacherTokensOverlap(teacherCell, blockTeachers) {
  const a = normalizeKeyPart(blockTeachers);
  const b = normalizeKeyPart(teacherCell);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const aw = a.split(/[^a-zа-яё]+/i).filter((w) => w.length >= 3);
  const bw = b.split(/[^a-zа-яё]+/i).filter((w) => w.length >= 3);
  return aw.some((x) => bw.some((y) => x === y || y.includes(x) || x.includes(y)));
}

/**
 * @param {import('pg').Pool} pool
 * @param {number[]} responseIds
 * @param {number[]} excludeQuestionIds
 */
async function fetchTextSnippetsByResponseIds(pool, responseIds, excludeQuestionIds) {
  if (!responseIds.length) return [];
  const ex = excludeQuestionIds && excludeQuestionIds.length ? excludeQuestionIds : [-1];
  const r = await pool.query(
    `SELECT av.response_id, q.text AS qtext, av.value
     FROM answer_values av
     INNER JOIN questions q ON q.id = av.question_id
     WHERE av.response_id = ANY($1::int[])
       AND q.type::text = 'text'
       AND NOT (q.id = ANY($2::int[]))`,
    [responseIds, ex],
  );
  const out = [];
  for (const row of r.rows) {
    const text = parseJsonbText(row.value).trim();
    if (!text) continue;
    out.push({
      response_id: Number(row.response_id),
      question: String(row.qtext || '').trim() || 'Вопрос',
      text,
    });
  }
  return out;
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} split
 * @param {{ id: string, conductingTeachers?: string, lessonCode?: string, parentClassLabel?: string }} block
 */
async function resolveResponseIdsForBlock(pool, surveyId, split, block) {
  if (split.mode === 'entire_survey') return [];

  const cls = String(block.parentClassLabel || '').trim();
  const key = lessonKeyFromParts(
    block.conductingTeachers || '',
    cls,
    block.lessonCode || '',
    split.mode,
  );
  if (key) {
    const ids = await findResponseIdsForLessonKey(pool, surveyId, split, key);
    if (ids && ids.length) return ids;
  }

  const rows = await fetchResponseLessonRows(pool, surveyId, split);
  const out = [];
  const codeB = normalizeKeyPart(block.lessonCode || '');
  const classB = normalizeKeyPart(cls);

  for (const row of rows) {
    const codeR = normalizeKeyPart(row.lessonCode || '');
    if (!codeB) continue;
    if (codeR !== codeB && !codeR.includes(codeB) && !codeB.includes(codeR)) continue;

    if (split.mode === 'triple') {
      if (!teacherTokensOverlap(row.teacher || '', block.conductingTeachers || '')) continue;
      if (classB && !labelsRoughEqual(cls, row.classLabel || '')) continue;
    } else if (split.mode === 'code_teacher') {
      if (!teacherTokensOverlap(row.teacher || '', block.conductingTeachers || '')) continue;
    } else if (split.mode === 'code_class') {
      if (classB && !labelsRoughEqual(cls, row.classLabel || '')) continue;
    }

    out.push(row.response_id);
  }
  return [...new Set(out)];
}

/**
 * Быстрая выборка текстовых ответов родителей по каждому блоку (только SQL, без LLM).
 * @param {import('pg').Pool} pool
 * @param {Array<{ id: string, conductingTeachers?: string, lessonCode?: string, parentClassLabel?: string }>} blocks
 */
async function buildParentCommentSnippetsByBlock(pool, surveyId, split, blocks) {
  const excludeQids = [split.teacherQuestionId, split.classQuestionId, split.lessonCodeQuestionId].filter(
    (x) => x != null && Number(x) > 0,
  );
  /** @type {Record<string, { question: string; text: string }[]>} */
  const result = {};
  for (const block of blocks) {
    if (!block || !block.id) continue;
    const ids = await resolveResponseIdsForBlock(pool, surveyId, split, block);
    if (!ids.length) {
      result[block.id] = [];
      continue;
    }
    const snippets = await fetchTextSnippetsByResponseIds(pool, ids, excludeQids);
    result[block.id] = snippets.map((s) => ({ question: s.question, text: s.text }));
  }
  return result;
}

module.exports = {
  buildParentCommentSnippetsByBlock,
};

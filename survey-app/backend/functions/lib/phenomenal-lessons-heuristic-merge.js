'use strict';

/**
 * Запасное сопоставление родительских ответов со строками чек-листа педагогов без LLM.
 * Используется при пустом ответе модели, сбое API или битом JSON.
 */

function normalizeLessonCode(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»""„"]/g, '')
    .trim();
}

function words3(s) {
  return (String(s).toLowerCase().match(/[a-zа-яё0-9]{3,}/gi) || []).map((w) => w.toLowerCase());
}

function teacherHintOverlap(hint, conductingTeachers) {
  const a = normalizeKeyPart(hint);
  const b = normalizeKeyPart(conductingTeachers);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const aw = words3(a);
  const bw = words3(b);
  const setB = new Set(bw);
  return aw.some((x) => setB.has(x) || b.includes(x));
}

/**
 * @param {Record<string, unknown>} answers_labeled
 */
function extractHints(answers_labeled) {
  let lessonCode = '';
  let teacherHint = '';
  let classLabel = '';
  for (const [k, v] of Object.entries(answers_labeled || {})) {
    const val = String(v ?? '').trim();
    if (!val) continue;
    const kl = String(k).toLowerCase();
    if (/шифр/i.test(k) || /код\s*урока/i.test(kl) || /номер\s*урока/i.test(kl)) {
      if (!lessonCode) lessonCode = val;
    } else if (/^урок\s*[:.]/i.test(String(k).trim()) && /шифр|код/i.test(kl)) {
      if (!lessonCode) lessonCode = val;
    }
    if ((/класс|паралел|литер/i.test(kl) || /^класс\s*[:.]/i.test(String(k).trim())) && !/урок/i.test(kl)) {
      if (!classLabel) classLabel = val;
    }
    /** Не брать «ФИО посетившего урок» — это родитель, а не ведущий. */
    const isParentVisitorFio = /посетивш|родител|законн|опекун/i.test(kl);
    if (isParentVisitorFio) continue;
    if (/ведущ|учител|преподавател/i.test(kl) || /кто\s+провел/i.test(kl)) {
      if (!teacherHint) teacherHint = val;
    } else if (/фио/i.test(kl) && !/посетивш|родител/i.test(kl)) {
      if (!teacherHint) teacherHint = val;
    }
  }
  return { lessonCode, teacherHint, classLabel };
}

function scoreTeacher(hints, teacher) {
  const pc = normalizeLessonCode(hints.lessonCode);
  const tc = normalizeLessonCode(teacher.lessonCode || '');
  let score = 0;
  if (pc && tc) {
    if (pc === tc) score += 100;
    else if (pc.includes(tc) || tc.includes(pc)) score += 72;
  }
  if (hints.teacherHint && teacher.conductingTeachers) {
    if (teacherHintOverlap(hints.teacherHint, teacher.conductingTeachers)) score += 38;
  }
  if (hints.classLabel && (pc || tc)) {
    const cl = normalizeLessonCode(hints.classLabel);
    if (cl.length >= 2) {
      if (pc && (pc.includes(cl) || cl.includes(pc))) score += 12;
      if (tc && (tc.includes(cl) || cl.includes(tc))) score += 12;
    }
  }
  return score;
}

function confidenceFromScore(score) {
  if (score >= 100) return 0.9;
  if (score >= 72) return 0.8;
  if (score >= 65) return 0.72;
  if (score >= 50) return 0.58;
  return 0;
}

/**
 * @param {number[]} parentIndices — pi
 * @param {Array<{ answers_labeled?: Record<string, unknown> }>} parentRows
 * @param {Array<{ lessonCode?: string, conductingTeachers?: string }>} teacherRows
 * @returns {Array<{ pi: number, ti: number|null, confidence: number, reason: string }>}
 */
function heuristicPairsForParentIndices(parentIndices, parentRows, teacherRows) {
  const pairs = [];
  for (const pi of parentIndices) {
    const row = parentRows[pi];
    const hints = extractHints(row?.answers_labeled || {});
    let bestTi = null;
    let bestScore = 0;
    for (let ti = 0; ti < teacherRows.length; ti++) {
      const sc = scoreTeacher(hints, teacherRows[ti]);
      if (sc > bestScore) {
        bestScore = sc;
        bestTi = ti;
      }
    }
    const minAssign = 50;
    const conf = confidenceFromScore(bestScore);
    if (bestTi != null && bestScore >= minAssign && conf > 0) {
      pairs.push({
        pi,
        ti: bestTi,
        confidence: conf,
        reason: `Автосопоставление без ИИ (шифр/ФИО), надёжность ${bestScore}`,
      });
    } else {
      pairs.push({
        pi,
        ti: null,
        confidence: 0,
        reason: 'Без ИИ: в ответе родителя не найдено однозначного шифра/учителя для пары',
      });
    }
  }
  return pairs;
}

module.exports = { heuristicPairsForParentIndices, extractHints };

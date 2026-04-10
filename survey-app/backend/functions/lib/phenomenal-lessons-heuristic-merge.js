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
 * Один столбец «сжато» / экспорт: класс и ФИО педагога спрятаны внутри текста ответа.
 */
function parseHintsFromAnswerBlob(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return { lessonCode: '', teacherHint: '', classLabel: '' };

  let lessonCode = '';
  let teacherHint = '';
  let classLabel = '';

  const tryCode =
    raw.match(/шифр[^\n:：]*[:\s]+([^\n]+)/i) ||
    raw.match(/код\s*урок[a-zа-яё]*\s*[:\s]+([^\n]+)/i) ||
    raw.match(/номер\s*урок[a-zа-яё]*\s*[:\s]+([^\n]+)/i);
  if (tryCode) lessonCode = tryCode[1].trim();

  const tryClass =
    raw.match(/класс\s*\/\s*групп[a-zа-яё\s]*\s*[:\s]+([^\n]+)/i) ||
    raw.match(/класс\s*\/\s*группа?\s*[:\s]+([^\n]+)/i) ||
    raw.match(/класс\s+групп[a-zа-яё]*\s*[:\s]+([^\n]+)/i);
  if (tryClass) classLabel = tryClass[1].trim();

  const tryTeach =
    raw.match(
      /фио\s*учител[a-zа-яё]*,?\s*проводивш[a-zа-яё]*[^\n:：]*[:\s]+([^\n]+)/i,
    ) ||
    raw.match(/фио\s*учител[а-яё]+?\s*[,:：]\s*([^\n]+)/i) ||
    raw.match(/учител[a-zа-яё]*,?\s*проводивш[a-zа-яё]*[^\n:：]*урок[a-zа-яё]*\s*[:\s]+([^\n]+)/i) ||
    raw.match(/ведущ[a-zа-яё]*\s*педагог[a-zа-яё]*\s*[:\s]+([^\n]+)/i) ||
    raw.match(/преподавател[a-zа-яё]*,?\s*проводивш[a-zа-яё]*\s*[:\s]+([^\n]+)/i);
  if (tryTeach) teacherHint = tryTeach[1].trim();

  return { lessonCode, teacherHint, classLabel };
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

  const blobParts = [];
  for (const v of Object.values(answers_labeled || {})) {
    const s = String(v ?? '').trim();
    if (s) blobParts.push(s);
  }
  const blobJoined = blobParts.join('\n');
  const fromBlob = parseHintsFromAnswerBlob(blobJoined);
  if (!lessonCode && fromBlob.lessonCode) lessonCode = fromBlob.lessonCode;
  if (!teacherHint && fromBlob.teacherHint) teacherHint = fromBlob.teacherHint;
  if (!classLabel && fromBlob.classLabel) classLabel = fromBlob.classLabel;

  return { lessonCode, teacherHint, classLabel };
}

function compactAlnum(s) {
  return normalizeLessonCode(s).replace(/\s+/g, '');
}

/**
 * Класс из ответа родителя vs строка педагога (шифр часто = «класс + код», в subjects может быть класс).
 */
function classMatchesTeacherRow(classLabel, teacher) {
  const cl = normalizeLessonCode(classLabel);
  if (!cl || cl.length < 2) return false;
  const bag = `${teacher.lessonCode || ''} ${teacher.subjects || ''} ${teacher.observerName || ''}`;
  const bagN = normalizeLessonCode(bag);
  if (!bagN) return false;
  const clC = compactAlnum(cl);
  const bagC = compactAlnum(bagN);
  if (bagN.includes(cl) || cl.includes(bagN.slice(0, 14))) return true;
  if (clC.length >= 2 && bagC.includes(clC)) return true;
  return false;
}

function teacherHaystack(teacher) {
  return [teacher.conductingTeachers, teacher.observerName, teacher.lessonCode, teacher.subjects]
    .filter(Boolean)
    .join(' ');
}

/** Первая значащая часть ФИО (обычно фамилия) длиной ≥ 4 — ищем в строке педагога. */
function surnameMatchesInHaystack(hint, haystack) {
  const parts = normalizeKeyPart(hint)
    .split(/\s+/)
    .filter(Boolean);
  const t = normalizeKeyPart(haystack);
  if (!t || !parts.length) return false;
  const s = parts[0];
  if (s.length < 4) return false;
  return t.includes(s);
}

function teacherNameMatchScore(hints, teacher) {
  if (!hints.teacherHint) return 0;
  const h = hints.teacherHint;
  const ct = teacher.conductingTeachers || '';
  let best = 0;
  if (ct && teacherHintOverlap(h, ct)) best = Math.max(best, 38);
  const hay = teacherHaystack(teacher);
  if (hay && teacherHintOverlap(h, hay)) best = Math.max(best, 36);
  if (surnameMatchesInHaystack(h, hay || ct)) best = Math.max(best, 41);
  return best;
}

function scoreTeacher(hints, teacher) {
  const pc = normalizeLessonCode(hints.lessonCode);
  const tc = normalizeLessonCode(teacher.lessonCode || '');
  let score = 0;
  if (pc && tc) {
    if (pc === tc) score += 100;
    else if (pc.includes(tc) || tc.includes(pc)) score += 72;
  }
  score += teacherNameMatchScore(hints, teacher);
  if (hints.classLabel) {
    const cl = normalizeLessonCode(hints.classLabel);
    if (cl.length >= 2) {
      if (pc && (pc.includes(cl) || cl.includes(pc))) score += 12;
      if (tc && (tc.includes(cl) || cl.includes(tc))) score += 12;
      if (classMatchesTeacherRow(hints.classLabel, teacher)) score += 46;
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
        reason:
          'Без ИИ: мало данных для пары (нужны шифр урока или совпадение ФИО педагога и класса; при «сжатом» ответе проверьте, что в тексте есть строки вида «Класс / Группа: …» и «ФИО учителей, проводивших урок: …»)',
      });
    }
  }
  return pairs;
}

module.exports = { heuristicPairsForParentIndices, extractHints };

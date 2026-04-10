'use strict';

const crypto = require('crypto');
const { parseJsonbText } = require('./fetch-text-answers');

const ENTIRE_SURVEY_MARKER = '\u0000entire_survey_v1\u0000';

function entireSurveyLessonKey() {
  return crypto.createHash('sha256').update(ENTIRE_SURVEY_MARKER, 'utf8').digest('hex');
}

function normalizeKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[«»""„"]/g, '')
    .trim();
}

function lessonKeyFromTriple(teacher, cls, code) {
  const t = normalizeKeyPart(teacher);
  const c = normalizeKeyPart(cls);
  const l = normalizeKeyPart(code);
  const payload = `${t}|${c}|${l}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Ключ урока по режиму (совпадает для строки ответа и для блока отчёта).
 * @param {'triple'|'code_teacher'|'code_class'|'code_only'} mode
 */
function lessonKeyFromParts(teacher, cls, code, mode) {
  const t = normalizeKeyPart(teacher);
  const c = normalizeKeyPart(cls);
  const l = normalizeKeyPart(code);
  if (mode === 'triple') {
    if (!t || !c || !l) return null;
    return lessonKeyFromTriple(teacher, cls, code);
  }
  if (mode === 'code_teacher') {
    if (!l || !t) return null;
    return crypto.createHash('sha256').update(`ct|${t}|${l}`, 'utf8').digest('hex');
  }
  if (mode === 'code_class') {
    if (!l || !c) return null;
    return crypto.createHash('sha256').update(`cc|${c}|${l}`, 'utf8').digest('hex');
  }
  if (mode === 'code_only') {
    if (!l) return null;
    return crypto.createHash('sha256').update(`c|${l}`, 'utf8').digest('hex');
  }
  return null;
}

function valueToString(val) {
  if (val == null) return '';
  return parseJsonbText(val).trim();
}

/** Вопрос про родителя/посетителя — не путать с ведущим педагогом. */
function isVisitorParentQuestionText(text) {
  return /посетивш|посетил\s+урок|кто\s+посетил|фио.*посетивш|родител.*посет|законн.*посет|опекун.*посет/i.test(
    String(text || ''),
  );
}

const TEACHER_RES = [
  /ведущ(ий|ие|их|его|ему)?\s+(педагог|учител|преподавател)/i,
  /педагог(ов|а|и)?\s*,\s*проводивш/i,
  /педагог(ов|а|и)?\s*,\s*котор/i,
  /проводивш(ий|их|его)?\s+урок/i,
  /учител(ь|я|ей|ю|ем)?\s*,\s*проводивш/i,
  /учител(ь|я)\s*\(/i,
  /фио\s+ведущ/i,
  /фио\s+педагог/i,
  /преподавател(ь|я)?\s*[,.)]/i,
  /name\s+of\s+the\s+teachers?\s+who\s+conducted/i,
  /teachers?\s+who\s+conducted/i,
  /who\s+taught/i,
];

const CLASS_RES = [
  /класс(а|е|ом)?\s*(ребёнка|ребенка|ученика|вашего)?/i,
  /в\s+каком\s+класс/i,
  /какой\s+класс/i,
  /укажите\s+класс/i,
  /^класс\s*[:.]/i,
  /^класс$/i,
  /parallel/i,
  /параллел/i,
  /литер/i,
  /\bclass\b.*\(/i,
];

const CODE_RES = [
  /шифр\s*урок/i,
  /шифр\s*открыт/i,
  /шифр\s*занят/i,
  /шифр\s*меропр/i,
  /шифр\s*[:(]/i,
  /lesson\s*code/i,
  /код\s*урок(а|у|е|ом|и)?/i,
  /код\s*занят/i,
  /код\s*меропр/i,
  /номер\s*урок(а|у|е|ом|и)?/i,
  /номер\s*открыт/i,
  /идентификатор.*урок/i,
  /идентификатор.*занят/i,
  /обозначени.*урок/i,
  /символьн.*код.*урок/i,
  /укажите\s+шифр/i,
  /введите\s+шифр/i,
  /cipher/i,
  /№\s*урок/i,
];

/**
 * Поля вроде приглашения / доступа — не считаем шифром урока.
 */
function isLikelyInviteOrAccessCodeQuestion(text) {
  return /приглас|инвайт|qr[\s-]*код|код\s+доступ|ссылк\w*\s+на\s+опрос|password|парол/i.test(
    String(text || ''),
  );
}

/**
 * Оценка «похоже на вопрос про шифр/код урока» (если regex-список не сработал).
 */
function scoreLessonCodeQuestionLikeness(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 220) return 0;
  let s = 0;
  if (/шифр/i.test(t)) s += 4;
  if (/код.*урок|урок.*код|код.*занят|код.*открыт/i.test(t)) s += 4;
  if (/номер.*урок|номер.*занят|номер.*открыт/i.test(t)) s += 3;
  if (/идентификатор.*(урок|занят|открыт)/i.test(t)) s += 3;
  if (/lesson.*code|code.*lesson/i.test(t)) s += 3;
  if (/обозначени.*(урок|занят)/i.test(t)) s += 2;
  if (/символьн.*(код|обознач)/i.test(t) && /урок|занят|открыт/i.test(t)) s += 2;
  if (/^\s*шифр\s*[:.)]?\s*$/i.test(t) || /^\s*код\s*урок/i.test(t)) s += 2;
  return s;
}

/**
 * @param {{ id: number, text: string, sort_order?: number }[]} questions
 * @param {Set<number>} excludeIds
 */
function bestLessonCodeQuestionByScore(questions, excludeIds) {
  const sorted = [...questions].sort((a, b) => {
    const so = (a.sort_order || 0) - (b.sort_order || 0);
    if (so) return so;
    return Number(a.id) - Number(b.id);
  });
  let bestId = null;
  let bestScore = 0;
  let bestLen = 9999;
  for (const q of sorted) {
    const id = Number(q.id);
    if (excludeIds.has(id)) continue;
    const text = String(q.text || '');
    if (isVisitorParentQuestionText(text)) continue;
    if (isLikelyInviteOrAccessCodeQuestion(text)) continue;
    const sc = scoreLessonCodeQuestionLikeness(text);
    if (sc < 3) continue;
    const len = text.length;
    if (sc > bestScore || (sc === bestScore && len < bestLen)) {
      bestScore = sc;
      bestLen = len;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * @param {{ id: number, text: string, sort_order?: number }[]} questions
 * @param {RegExp[]} regexes
 * @param {{ excludeIds?: Set<number>, skipText?: (t: string) => boolean }} opts
 */
function firstMatchingQuestionId(questions, regexes, opts = {}) {
  const excludeIds = opts.excludeIds || new Set();
  const skipText = opts.skipText;
  const sorted = [...questions].sort((a, b) => {
    const so = (a.sort_order || 0) - (b.sort_order || 0);
    if (so) return so;
    return Number(a.id) - Number(b.id);
  });
  for (const q of sorted) {
    const id = Number(q.id);
    if (excludeIds.has(id)) continue;
    const text = String(q.text || '');
    if (skipText && skipText(text)) continue;
    if (regexes.some((re) => re.test(text))) return id;
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} media
 * @returns {{ teacherQuestionId: number|null, classQuestionId: number|null, lessonCodeQuestionId: number|null, mode: string, source: string }}
 */
function resolveDirectorLessonSplit(questions, media) {
  const m = media && typeof media === 'object' ? media.directorLessonSplit : null;
  if (m && typeof m === 'object') {
    const t = Number(m.teacherQuestionId);
    const c = Number(m.classQuestionId);
    const l = Number(m.lessonCodeQuestionId);
    const hasT = Number.isFinite(t) && t > 0;
    const hasC = Number.isFinite(c) && c > 0;
    const hasL = Number.isFinite(l) && l > 0;
    if (hasL && hasT && hasC && t !== c && t !== l && c !== l) {
      return { teacherQuestionId: t, classQuestionId: c, lessonCodeQuestionId: l, mode: 'triple', source: 'manual' };
    }
    if (hasL && hasT && t !== l) {
      const mode = hasC && c !== t && c !== l ? 'triple' : 'code_teacher';
      if (mode === 'triple') {
        return { teacherQuestionId: t, classQuestionId: c, lessonCodeQuestionId: l, mode: 'triple', source: 'manual' };
      }
      return { teacherQuestionId: t, classQuestionId: null, lessonCodeQuestionId: l, mode: 'code_teacher', source: 'manual' };
    }
    if (hasL && hasC && c !== l) {
      return { teacherQuestionId: null, classQuestionId: c, lessonCodeQuestionId: l, mode: 'code_class', source: 'manual' };
    }
    if (hasL) {
      return { teacherQuestionId: null, classQuestionId: null, lessonCodeQuestionId: l, mode: 'code_only', source: 'manual' };
    }
  }

  const skipVisitor = (text) => isVisitorParentQuestionText(text);

  let codeId = firstMatchingQuestionId(questions, CODE_RES, {});
  if (!codeId) {
    codeId = firstMatchingQuestionId(
      questions,
      [/шифр/i, /номер.*урок/i, /номер.*занят/i, /идентификатор/i, /код.*урок/i],
      {
        skipText: (text) => skipVisitor(text) || isLikelyInviteOrAccessCodeQuestion(text),
      },
    );
  }
  if (!codeId) {
    codeId = bestLessonCodeQuestionByScore(questions, new Set());
  }

  const used = new Set();
  if (codeId) used.add(codeId);

  let teacherId = firstMatchingQuestionId(questions, TEACHER_RES, { excludeIds: used, skipText: skipVisitor });
  if (teacherId) used.add(teacherId);

  let classId = firstMatchingQuestionId(questions, CLASS_RES, { excludeIds: used });
  if (classId) used.add(classId);

  if (teacherId && classId && teacherId === classId) {
    classId = firstMatchingQuestionId(questions, CLASS_RES, { excludeIds: used });
    if (classId) used.add(classId);
  }

  if (!codeId) {
    return {
      teacherQuestionId: null,
      classQuestionId: null,
      lessonCodeQuestionId: null,
      mode: 'entire_survey',
      source: 'fallback',
    };
  }

  let mode = 'code_only';
  if (
    teacherId &&
    classId &&
    teacherId !== classId &&
    teacherId !== codeId &&
    classId !== codeId
  ) {
    mode = 'triple';
  } else if (teacherId && teacherId !== codeId) {
    mode = 'code_teacher';
  } else if (classId && classId !== codeId) {
    mode = 'code_class';
  }

  return {
    teacherQuestionId: mode === 'triple' || mode === 'code_teacher' ? teacherId : null,
    classQuestionId: mode === 'triple' || mode === 'code_class' ? classId : null,
    lessonCodeQuestionId: codeId,
    mode,
    source: 'inferred',
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} split
 */
async function fetchResponseLessonRows(pool, surveyId, split) {
  if (split.mode === 'entire_survey' || !split.lessonCodeQuestionId) {
    return [];
  }
  const tid = split.teacherQuestionId || 0;
  const cid = split.classQuestionId || 0;
  const lid = split.lessonCodeQuestionId;
  const qids = [tid, cid, lid].filter((x) => x > 0);
  if (!qids.length) return [];

  const r = await pool.query(
    `SELECT r.id AS response_id,
       max(CASE WHEN $2::int > 0 AND av.question_id = $2::int THEN av.value END) AS v_teacher,
       max(CASE WHEN $3::int > 0 AND av.question_id = $3::int THEN av.value END) AS v_class,
       max(CASE WHEN $4::int > 0 AND av.question_id = $4::int THEN av.value END) AS v_code
     FROM responses r
     LEFT JOIN answer_values av ON av.response_id = r.id AND av.question_id = ANY($5::int[])
     WHERE r.survey_id = $1
     GROUP BY r.id`,
    [surveyId, tid, cid, lid, qids],
  );
  return r.rows.map((row) => ({
    response_id: Number(row.response_id),
    teacher: valueToString(row.v_teacher),
    classLabel: valueToString(row.v_class),
    lessonCode: valueToString(row.v_code),
  }));
}

/**
 * @param {import('pg').Pool} pool
 */
async function buildLessonGroups(pool, surveyId, split) {
  if (split.mode === 'entire_survey') {
    const r = await pool.query(`SELECT COUNT(*)::int AS c FROM responses WHERE survey_id = $1`, [surveyId]);
    const cnt = r.rows[0]?.c ?? 0;
    const key = entireSurveyLessonKey();
    return [
      {
        lesson_key: key,
        teacher: 'Все ответы опроса',
        class_label: '—',
        lesson_code: '—',
        response_count: cnt,
      },
    ];
  }

  const rows = await fetchResponseLessonRows(pool, surveyId, split);
  const byKey = new Map();
  for (const row of rows) {
    const lesson_key = lessonKeyFromParts(row.teacher, row.classLabel, row.lessonCode, split.mode);
    if (!lesson_key) continue;
    if (!byKey.has(lesson_key)) {
      byKey.set(lesson_key, {
        lesson_key,
        teacher: row.teacher || '—',
        class_label: row.classLabel || '—',
        lesson_code: row.lessonCode || '—',
        response_ids: [],
      });
    }
    byKey.get(lesson_key).response_ids.push(row.response_id);
  }
  const groups = [...byKey.values()].map((g) => ({
    lesson_key: g.lesson_key,
    teacher: g.teacher,
    class_label: g.class_label,
    lesson_code: g.lesson_code,
    response_count: g.response_ids.length,
  }));
  groups.sort((a, b) => {
    const c1 = a.teacher.localeCompare(b.teacher, 'ru');
    if (c1) return c1;
    const c2 = a.class_label.localeCompare(b.class_label, 'ru');
    if (c2) return c2;
    return a.lesson_code.localeCompare(b.lesson_code, 'ru');
  });
  return groups;
}

/**
 * @param {import('pg').Pool} pool
 */
async function findResponseIdsForLessonKey(pool, surveyId, split, lessonKey) {
  const want = String(lessonKey || '').trim().toLowerCase();
  if (!want || !/^[a-f0-9]{64}$/.test(want)) return null;
  if (want === entireSurveyLessonKey().toLowerCase()) {
    const r = await pool.query(`SELECT id FROM responses WHERE survey_id = $1`, [surveyId]);
    return r.rows.map((x) => Number(x.id));
  }
  if (split.mode === 'entire_survey') return null;

  const rows = await fetchResponseLessonRows(pool, surveyId, split);
  const out = [];
  for (const row of rows) {
    const k = lessonKeyFromParts(row.teacher, row.classLabel, row.lessonCode, split.mode);
    if (k && k === want) out.push(row.response_id);
  }
  return out.length ? out : null;
}

module.exports = {
  resolveDirectorLessonSplit,
  buildLessonGroups,
  findResponseIdsForLessonKey,
  lessonKeyFromTriple,
  lessonKeyFromParts,
  entireSurveyLessonKey,
  fetchResponseLessonRows,
};

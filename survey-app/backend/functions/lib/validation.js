const QUESTION_TYPES = new Set(['radio', 'checkbox', 'scale', 'text', 'rating', 'date']);

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((o) => (typeof o === 'string' ? o : o && o.label != null ? String(o.label) : String(o)));
}

function isOtherPrefixed(v) {
  return typeof v === 'string' && /^другое\s*:/i.test(v.trim());
}

function validateAnswer(question, rawValue, opts = {}) {
  const { id, type, options } = question;
  const labels = normalizeOptions(options);
  const hasOther = labels.includes('Другое') || labels.includes('другое');
  const allowUnknownOptionsAsOther = opts.allowUnknownOptionsAsOther === true;
  /** Импорт из Excel: в БД поле TEXT; не режем по maxLength формы. */
  const relaxTextLengthForImport = opts.relaxTextLengthForImport === true;

  switch (type) {
    case 'radio': {
      if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
        return { ok: false, error: `Question ${id}: radio expects string` };
      }
      const v = String(rawValue).trim();
      if (labels.length && !labels.includes(v)) {
        if (allowUnknownOptionsAsOther) return { ok: true, value: `Другое: ${v}` };
        if (hasOther && isOtherPrefixed(v)) return { ok: true, value: v };
        return { ok: false, error: `Question ${id}: invalid option` };
      }
      return { ok: true, value: v };
    }
    case 'checkbox': {
      if (!Array.isArray(rawValue)) {
        return { ok: false, error: `Question ${id}: checkbox expects array` };
      }
      const arr = rawValue.map((x) => String(x).trim()).filter(Boolean);
      if (labels.length) {
        const out = [];
        for (const x of arr) {
          if (!labels.includes(x)) {
            if (allowUnknownOptionsAsOther) {
              out.push(`Другое: ${x}`);
              continue;
            }
            if (hasOther && isOtherPrefixed(x)) continue;
            return { ok: false, error: `Question ${id}: invalid option` };
          }
          out.push(x);
        }
        return { ok: true, value: out };
      }
      return { ok: true, value: arr };
    }
    case 'scale':
    case 'rating': {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `Question ${id}: number required` };
      }
      const min = options && typeof options.min === 'number' ? options.min : type === 'rating' ? 1 : 1;
      const max = options && typeof options.max === 'number' ? options.max : type === 'rating' ? 5 : 10;
      if (n < min || n > max) {
        return { ok: false, error: `Question ${id}: out of range ${min}–${max}` };
      }
      return { ok: true, value: n };
    }
    case 'text': {
      if (rawValue == null) {
        return { ok: false, error: `Question ${id}: text required` };
      }
      const s = String(rawValue).trim();
      if (!s.length) {
        return { ok: false, error: `Question ${id}: empty text` };
      }
      const maxLen = relaxTextLengthForImport
        ? 1048576
        : (options && options.maxLength) || 10000;
      if (s.length > maxLen) {
        return { ok: false, error: `Question ${id}: too long` };
      }
      return { ok: true, value: s };
    }
    case 'date': {
      if (rawValue == null) {
        return { ok: false, error: `Question ${id}: date required` };
      }
      const s = String(rawValue).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return { ok: false, error: `Question ${id}: invalid date format` };
      }
      return { ok: true, value: s };
    }
    default:
      return { ok: false, error: `Question ${id}: unknown type` };
  }
}

function validatePayload(questions, answersPayload) {
  if (!Array.isArray(answersPayload)) {
    return { ok: false, error: 'answers must be an array' };
  }
  const byId = new Map(questions.map((q) => [Number(q.id), q]));
  const seen = new Set();
  const normalized = [];

  for (const row of answersPayload) {
    const qid = Number(row.question_id);
    if (!Number.isFinite(qid) || !byId.has(qid)) {
      return { ok: false, error: `Unknown question_id: ${row.question_id}` };
    }
    if (seen.has(qid)) {
      return { ok: false, error: `Duplicate answer for question ${qid}` };
    }
    seen.add(qid);
    const q = byId.get(qid);
    const res = validateAnswer(q, row.value);
    if (!res.ok) return res;
    normalized.push({ question_id: qid, value: res.value });
  }

  for (const q of questions) {
    const qn = Number(q.id);
    if (!seen.has(qn)) {
      return { ok: false, error: `Missing answer for question ${q.id}` };
    }
  }

  return { ok: true, answers: normalized };
}

/**
 * Импорт из таблицы: в строке могут быть не все вопросы; пустые ячейки пропускаются.
 */
function validatePartialImportAnswers(questions, answersPayload) {
  if (!Array.isArray(answersPayload)) {
    return { ok: false, error: 'answers must be an array' };
  }
  const byId = new Map(questions.map((q) => [Number(q.id), q]));
  const seen = new Set();
  const normalized = [];

  for (const row of answersPayload) {
    const qid = Number(row.question_id);
    if (!Number.isFinite(qid) || !byId.has(qid)) {
      return { ok: false, error: `Unknown question_id: ${row.question_id}` };
    }
    const raw = row.value;
    if (raw == null) continue;
    if (typeof raw === 'string' && !raw.trim()) continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    if (seen.has(qid)) {
      return { ok: false, error: `Duplicate answer for question ${qid}` };
    }
    const q = byId.get(qid);
    const res = validateAnswer(q, raw, {
      allowUnknownOptionsAsOther: true,
      relaxTextLengthForImport: true,
    });
    if (!res.ok) return res;
    seen.add(qid);
    normalized.push({ question_id: qid, value: res.value });
  }

  if (normalized.length === 0) {
    return { ok: false, error: 'No valid answers in row' };
  }
  return { ok: true, answers: normalized };
}

module.exports = { QUESTION_TYPES, validatePayload, validatePartialImportAnswers, normalizeOptions };

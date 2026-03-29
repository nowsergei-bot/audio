/**
 * По первому листу Excel (headers + rows) строит черновик вопросов опроса.
 */

const SKIP_HEADER =
  /^(id|id\s|№|номер|почта|email|дата|время|timestamp|респондент|respondent|имя|фамилия|телефон|phone)$/i;

function toPrimitive(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (typeof cell === 'boolean') return cell;
  if (cell instanceof Date) return cell;
  return String(cell);
}

function inferColumn(headerText, samples) {
  const h = String(headerText || '').trim() || 'Вопрос';
  if (SKIP_HEADER.test(h)) return null;

  const vals = [];
  for (const cell of samples) {
    const v = toPrimitive(cell);
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    vals.push(v);
  }

  if (!vals.length) {
    return { text: h, type: 'text', options: { maxLength: 4000 } };
  }

  const strVals = vals.map((v) => String(v).trim()).filter(Boolean);
  const nums = vals
    .map((v) => (typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'))))
    .filter((n) => Number.isFinite(n));

  const numRatio = nums.length / vals.length;
  if (numRatio >= 0.88) {
    const integ = nums.every((n) => Number.isInteger(n));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (integ && min >= 1 && max <= 5) {
      return { text: h, type: 'rating', options: { min: 1, max: 5 } };
    }
    let lo = Math.floor(min);
    let hi = Math.ceil(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { text: h, type: 'scale', options: { min: 1, max: 10 } };
    }
    lo = Math.max(1, lo);
    hi = Math.max(lo + 1, hi);
    if (hi > 100) hi = 100;
    return { text: h, type: 'scale', options: { min: lo, max: hi } };
  }

  const multi = strVals.some((s) => /[,;|]/.test(s) && s.split(/[,;|]+/).filter(Boolean).length > 1);
  if (multi) {
    const set = new Set();
    for (const s of strVals) {
      for (const p of s.split(/[,;|\n\r]+/).map((x) => x.trim()).filter(Boolean)) {
        if (p) set.add(p);
      }
    }
    const opts = [...set].slice(0, 36).sort((a, b) => a.localeCompare(b, 'ru'));
    return { text: h, type: 'checkbox', options: opts.length ? opts : ['Вариант 1', 'Вариант 2'] };
  }

  const unique = [...new Set(strVals)];
  if (unique.length <= 14 && unique.length <= Math.max(3, Math.ceil(vals.length * 0.55)) && strVals.every((s) => s.length < 200)) {
    return { text: h, type: 'radio', options: unique.sort((a, b) => a.localeCompare(b, 'ru')) };
  }

  return { text: h, type: 'text', options: { maxLength: 4000 } };
}

/**
 * @param {{ headers: string[], rows: any[][] }} sheet
 * @returns {{ colIndex: number, text: string, type: string, options: unknown }[]}
 */
function inferQuestionsFromSheet(sheet) {
  const { headers, rows } = sheet;
  if (!headers?.length) return [];

  const out = [];
  for (let c = 0; c < headers.length; c++) {
    const samples = [];
    const take = Math.min(rows.length, 220);
    for (let r = 0; r < take; r++) {
      samples.push(rows[r] ? rows[r][c] : null);
    }
    const spec = inferColumn(headers[c], samples);
    if (spec) out.push({ colIndex: c, ...spec });
  }
  return out;
}

function coerceCellForQuestion(cell, question) {
  const v = toPrimitive(cell);
  if (v == null) return null;
  const { type, options } = question;

  if (type === 'text') {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
    return s.length ? s : null;
  }
  if (type === 'radio') {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
    return s.length ? s : null;
  }
  if (type === 'scale' || type === 'rating') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'checkbox') {
    const s = String(v).trim();
    if (!s) return null;
    const parts = s.split(/[,;|\n\r]+/).map((x) => x.trim()).filter(Boolean);
    return parts.length ? parts : null;
  }
  return null;
}

module.exports = { inferQuestionsFromSheet, coerceCellForQuestion, SKIP_HEADER };

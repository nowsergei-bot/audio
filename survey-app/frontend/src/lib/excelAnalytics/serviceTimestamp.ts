import { parseAnalyticsDate } from './engine';
import type { CellPrimitive } from './parse';
import type { ColumnRole } from './types';

const SAMPLE = 280;

/** Метка времени ответа / отправки формы / голосования — не дата урока. */
const SERVICE_TIMESTAMP_HEADER =
  /голосован|время\s*ответ|время\s*заполн|время\s*отправ|время\s*голос|ответа?\s*врем|дата\s*ответ|дата\s*отправ|дата\s*заполн|дата\s*получен|submitted|submission|completed\s*at|заполнен|отправлен|получен\s*ответ|штамп|timestamp|date\s*time|дата\s*и\s*время|когда\s*ответ|завершен|начал\w*\s*опрос|конец\s*опрос|дата\s*регистрац|дата\s*создан|created\s*at|modified\s*at|записан\w*\s*в\s*баз/i;

/** Скорее дата события (урока), не служебная отметка формы. */
const LESSON_OR_EVENT_DATE_HEADER =
  /дата\s*урок|дата\s*провед|дата\s*занят|lesson\s*date|дата\s*мероприят|дата\s*событ|дата\s*наблюден/i;

function normHeader(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function excelSerialToMs(n: number): number {
  return (n - 25569) * 86400 * 1000;
}

/** Есть заметная временная часть (не только календарный день). */
export function cellHasSignificantTime(c: CellPrimitive): boolean {
  if (c == null || c === '') return false;
  if (c instanceof Date) {
    return (
      c.getHours() !== 0 ||
      c.getMinutes() !== 0 ||
      c.getSeconds() !== 0 ||
      c.getMilliseconds() !== 0
    );
  }
  if (typeof c === 'number' && Number.isFinite(c)) {
    const frac = Math.abs(c % 1);
    if (frac > 1e-5) return true;
    const d = new Date(excelSerialToMs(Math.floor(c)));
    if (!Number.isFinite(d.getTime())) return false;
    return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  }
  const s = String(c).trim();
  if (/\d{1,2}[:.]\d{2}/.test(s)) return true;
  if (/T\d{2}:\d{2}/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}/.test(s)) return true;
  return false;
}

function columnDateStats(rows: CellPrimitive[][], col: number) {
  const slice = rows.slice(0, SAMPLE);
  let filled = 0;
  let dateOk = 0;
  let timePart = 0;
  let numCells = 0;
  let numParseableAsDate = 0;
  const uniq = new Set<string>();

  for (const line of slice) {
    const c = line[col];
    if (c == null || c === '') continue;
    filled++;
    if (parseAnalyticsDate(c) != null) dateOk++;
    if (cellHasSignificantTime(c)) timePart++;
    if (typeof c === 'number' && Number.isFinite(c)) {
      numCells++;
      if (parseAnalyticsDate(c) != null) numParseableAsDate++;
    }
    const s = c instanceof Date ? c.toISOString() : String(c).trim();
    if (s) uniq.add(s.toLowerCase());
  }

  const dateRatio = filled ? dateOk / filled : 0;
  const timeRatio = filled ? timePart / filled : 0;
  const uniqueRatio = filled ? uniq.size / filled : 0;
  const numericLooksLikeDate =
    numCells > filled * 0.65 && numParseableAsDate > numCells * 0.82 && filled >= 8;

  return { filled, dateRatio, timeRatio, uniqueRatio, numericLooksLikeDate };
}

/**
 * Оценка «это служебная метка времени (одна на таблицу)». Чем выше, тем увереннее.
 */
export function scoreServiceTimestampColumn(headers: string[], rows: CellPrimitive[][], col: number): number {
  const h = normHeader(headers[col] ?? '');
  if (!h && rows.length === 0) return -999;

  let score = 0;
  if (SERVICE_TIMESTAMP_HEADER.test(h)) score += 96;
  if (LESSON_OR_EVENT_DATE_HEADER.test(h)) score -= 125;

  const st = columnDateStats(rows, col);
  if (st.filled < 5) return score - 50;

  if (st.dateRatio >= 0.5) score += 38;
  if (st.dateRatio >= 0.72) score += 12;
  if (st.timeRatio >= 0.22) score += 42;
  if (st.timeRatio >= 0.45) score += 22;
  if (st.uniqueRatio >= 0.82 && st.dateRatio >= 0.48) score += 34;
  if (st.uniqueRatio >= 0.9 && st.filled >= 20) score += 18;
  if (st.numericLooksLikeDate) score += 36;

  return score;
}

function ensureDateRoleIfMissing(headers: string[], rows: CellPrimitive[][], roles: ColumnRole[]): ColumnRole[] {
  if (roles.includes('date')) return roles;
  const next = [...roles];
  let bestI = -1;
  let bestScore = -1;
  for (let i = 0; i < headers.length; i++) {
    if (next[i] !== 'ignore') continue;
    const st = columnDateStats(rows, i);
    const score = st.dateRatio * 100 + (st.filled / SAMPLE) * 8;
    if (st.dateRatio >= 0.42 && score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  }
  if (bestI >= 0) next[bestI] = 'date';
  return next;
}

const MIN_SCORE_TO_STRIP = 90;

/**
 * Не больше одной колонки: лучший кандидат на служебную метку времени → ignore.
 * Если это была единственная «дата», пытаемся назначить date другому столбцу среди ignore.
 */
export function applyServiceTimestampIgnore(
  headers: string[],
  rows: CellPrimitive[][],
  roles: ColumnRole[],
): { roles: ColumnRole[]; strippedIndex: number | null } {
  const n = headers.length;
  if (!n || !rows.length) return { roles, strippedIndex: null };

  let bestI = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    if (roles[i] === 'ignore') continue;
    const sc = scoreServiceTimestampColumn(headers, rows, i);
    if (sc > bestScore) {
      bestScore = sc;
      bestI = i;
    }
  }

  if (bestI < 0 || bestScore < MIN_SCORE_TO_STRIP) {
    return { roles, strippedIndex: null };
  }

  const next = [...roles];
  next[bestI] = 'ignore';
  const withDate = ensureDateRoleIfMissing(headers, rows, next);
  return { roles: withDate, strippedIndex: bestI };
}

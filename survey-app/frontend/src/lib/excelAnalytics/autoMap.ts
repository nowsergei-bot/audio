import { parseAnalyticsDate, parseNumber } from './engine';
import type { CellPrimitive } from './parse';
import type { ColumnRole } from './types';
import { roleAllowsDuplicate, validateRoles } from './types';
import { applyServiceTimestampIgnore } from './serviceTimestamp';

const SAMPLE = 200;

function norm(h: string): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type ColStats = {
  dateRatio: number;
  numericRatio: number;
  nonEmptyRatio: number;
  uniqueStrCount: number;
  medianStrLen: number;
  filledStrCount: number;
};

function cellStr(c: CellPrimitive): string {
  if (c == null || c === '') return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

function computeStats(rows: CellPrimitive[][], col: number): ColStats {
  const slice = rows.slice(0, SAMPLE);
  let n = 0;
  let dates = 0;
  let nums = 0;
  const uniq = new Set<string>();
  const lengths: number[] = [];
  for (const line of slice) {
    const c = line[col];
    if (c == null || c === '') continue;
    n++;
    if (parseAnalyticsDate(c) != null) dates++;
    if (parseNumber(c) != null) nums++;
    const s = cellStr(c);
    if (s) {
      uniq.add(s.toLowerCase());
      lengths.push(s.length);
    }
  }
  const total = slice.length || 1;
  lengths.sort((a, b) => a - b);
  const medianStrLen = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  return {
    dateRatio: n ? dates / n : 0,
    numericRatio: n ? nums / n : 0,
    nonEmptyRatio: n / total,
    uniqueStrCount: uniq.size,
    medianStrLen,
    filledStrCount: lengths.length,
  };
}

type HeaderMatch = { role: ColumnRole; priority: number };

/** Чем выше priority, тем раньше претендует на уникальную роль. */
function matchHeader(header: string): HeaderMatch | null {
  const h = norm(header);
  if (!h) return null;

  const rules: [ColumnRole, RegExp, number][] = [
    /** «проведен» в общем виде не используем — иначе «Формат проведения урока» ошибочно становится «датой». */
    [
      'date',
      /дата\s*посещ|дата\s*урока?|дата\s*наблюден|дата\s*мероприят|дата\s*проведени\w*\s*урок|lesson\s*date|date\s*of\s*visit/i,
      99,
    ],
    ['date', /отметка\s*времени|время\s*ответ|время\s*отправ|время\s*заполн|submitted\s*at|created\s*at|дата\s*ответ|дата\s*отправ/i, 82],
    ['date', /\bдата\b(?!\s*ответ)|\bdate\b|timestamp|когда\b/i, 87],
    ['filter_teacher_code', /шифр|код\s*педагог|код\s*учител|teacher|педагог.*код|id\s*педагог/i, 92],
    ['filter_parallel', /параллел|parallel/i, 90],
    ['filter_class', /(^|[^а-я])класс|class|группа\s*\d/i, 90],
    ['filter_subject', /предмет|дисциплин|тема\s*урок|subject|курс(?!\s*оцен)/i, 88],
    [
      'filter_format',
      /формат|модаль|вид\s*урок|вид\s*занят|дистанц|очно|онлайн|гибрид|смеш|удалён|удален|remote|hybrid|zoom|teams|офлайн|офис|присутств/i,
      86,
    ],
    ['text_ai_recommendations', /рекомендац|что\s*улучшить|на\s*что\s*обратить/i, 84],
    ['text_ai_summary', /вывод|резюме|итог|заключен|обобщ|комментарий\s*эксперт|самоанализ/i, 83],
    ['text_list_features', /услови|тег|через\s*запят|перечисл|критери.*списк/i, 81],
    ['metric_ordinal_text', /уровен|категория\s*качеств|качество\s*\(|шкала\s*\(|тип\s*оценк/i, 80],
    ['row_label', /название|наименован|тема(?!\s*урок)|урок(?!\s*\d)|описание/i, 78],
    ['id_row', /^id$|^№$|^номер$|^n$/i, 75],
    ['filter_custom_1', /кампус|площадк|здание/i, 70],
    ['filter_custom_2', /тип\s*мероприят|мероприят/i, 69],
    ['filter_custom_3', /дополнит|прочее|примечан/i, 68],
  ];

  let best: HeaderMatch | null = null;
  for (const [role, re, priority] of rules) {
    if (re.test(h)) {
      if (!best || priority > best.priority) best = { role, priority };
    }
  }
  return best;
}

/** Типичные подписи формата: очно / дистанционно / онлайн и т.п. */
const FORMAT_VALUE_HINT =
  /очно|офлайн|офис|в\s*класс|присутств|дистанц|удалён|удален|онлайн|online|remote|zoom|teams|дистант|смеш|гибрид|hybrid|виртуал|видеосвяз|видео\s*урок|синхрон|асинхрон/i;

function collectDistinctStrings(rows: CellPrimitive[][], col: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < rows.length && r < SAMPLE; r++) {
    const c = rows[r][col];
    if (c == null || c === '') continue;
    const t = cellStr(c).toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

function headerHintsFormat(header: string): boolean {
  return /формат|модаль|вид\s*урок|вид\s*занят|проведен|дистанц|очно|онлайн|удалён|удален/i.test(norm(header));
}

/** Насколько столбец похож на «формат проведения» (метка, не числовая метрика). */
function scoreFormatLikeness(vals: Set<string>, header: string): number {
  if (vals.size < 2 || vals.size > 14) return 0;
  const hh = headerHintsFormat(header);
  const only = [...vals].sort();
  if (only.length === 2 && only.every((x) => /^[01]$/.test(x)) && hh) return 70;
  if (only.length <= 3 && only.every((x) => /^[012]$/.test(x)) && hh) return 55;

  let hits = 0;
  for (const v of vals) {
    if (FORMAT_VALUE_HINT.test(v)) hits++;
  }
  const ratio = hits / vals.size;
  if (ratio >= 0.55) return 55 + ratio * 45 + (hh ? 10 : 0);
  if (vals.size <= 3 && hits >= 2) return 50 + (hh ? 10 : 0);
  return 0;
}

function firstFreeFilterCustom(out: ColumnRole[]): ColumnRole | null {
  for (const fk of ['filter_custom_1', 'filter_custom_2', 'filter_custom_3'] as ColumnRole[]) {
    if (!out.includes(fk)) return fk;
  }
  return null;
}

/** Типичные заголовки критериев в листах наблюдения за уроком. */
const STRONG_OBSERVATION_RUBRIC =
  /методическ\w*\s*грамотност|общекультурн\w*\s*компетенц|взаимодействи\w*\s*участник|содержател\w*\s*урок|результативност|управлен\w*\s*деятельност|дидактич/i;

/**
 * Всё, что осталось «игнор», подключаем к дашборду: критерии, даты, короткие справочники, длинные тексты.
 * Несколько текстовых колонок допускается (см. roleAllowsDuplicate для text_*).
 */
function inclusiveFillIgnored(headers: string[], rows: CellPrimitive[][], out: ColumnRole[]): void {
  const n = headers.length;
  const stats = headers.map((_, i) => computeStats(rows, i));

  for (let i = 0; i < n; i++) {
    if (out[i] !== 'ignore') continue;
    const s = stats[i];
    const h = norm(headers[i] ?? '');

    if (s.nonEmptyRatio < 0.015) continue;

    if (STRONG_OBSERVATION_RUBRIC.test(h)) {
      out[i] = 'metric_numeric';
      continue;
    }
    if (s.numericRatio >= 0.2) {
      out[i] = 'metric_numeric';
      continue;
    }
    if (!out.includes('date') && s.dateRatio >= 0.38) {
      out[i] = 'date';
      continue;
    }
    if (
      s.numericRatio < 0.2 &&
      s.uniqueStrCount >= 2 &&
      s.uniqueStrCount <= 42 &&
      s.medianStrLen < 50 &&
      s.nonEmptyRatio > 0.08
    ) {
      const fk = firstFreeFilterCustom(out);
      if (fk) {
        out[i] = fk;
        continue;
      }
    }
    if (s.medianStrLen >= 24) {
      out[i] = 'text_ai_summary';
      continue;
    }
    if (s.medianStrLen >= 8) {
      out[i] = 'text_list_features';
      continue;
    }
    out[i] = 'text_ai_summary';
  }
}

/**
 * Подбор ролей по названиям столбцов и первым строкам данных.
 * Уникальные роли не дублируются; несколько столбцов могут быть metric_numeric и несколько — с ролями text_*.
 */
export function suggestColumnRoles(headers: string[], rows: CellPrimitive[][]): ColumnRole[] {
  const n = headers.length;
  const out: ColumnRole[] = Array(n).fill('ignore');
  const usedUnique = new Set<ColumnRole>();

  function takeUnique(role: ColumnRole, i: number): boolean {
    if (roleAllowsDuplicate(role)) {
      out[i] = role;
      return true;
    }
    if (usedUnique.has(role)) return false;
    out[i] = role;
    usedUnique.add(role);
    return true;
  }

  const headerCands: { i: number; role: ColumnRole; p: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = matchHeader(headers[i]);
    if (m) headerCands.push({ i, role: m.role, p: m.priority });
  }
  headerCands.sort((a, b) => b.p - a.p);
  for (const c of headerCands) {
    if (out[c.i] !== 'ignore') continue;
    takeUnique(c.role, c.i);
  }

  const stats = headers.map((_, i) => computeStats(rows, i));

  /** Формат проведения (очно / дистанционно): по заголовку уже могли назначить; иначе — по содержимому ячеек */
  if (!usedUnique.has('filter_format')) {
    let bestI = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] !== 'ignore') continue;
      const s = stats[i];
      if (s.numericRatio > 0.85) continue;
      const distinct = collectDistinctStrings(rows, i);
      const dataScore = scoreFormatLikeness(distinct, headers[i] ?? '');
      const score = dataScore;
      if (score > bestScore && dataScore > 0) {
        bestScore = score;
        bestI = i;
      }
    }
    if (bestI >= 0) takeUnique('filter_format', bestI);
  }

  /** Лучший столбец для даты по данным */
  if (!usedUnique.has('date')) {
    let bestI = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] !== 'ignore') continue;
      const s = stats[i];
      const score = s.dateRatio * 100 + s.nonEmptyRatio * 10;
      if (s.dateRatio >= 0.45 && score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    if (bestI >= 0) takeUnique('date', bestI);
  }

  /** Числовые пункты: столбцы с преобладанием чисел */
  for (let i = 0; i < n; i++) {
    if (out[i] !== 'ignore') continue;
    const s = stats[i];
    if (s.numericRatio >= 0.48 && s.filledStrCount > 0) {
      out[i] = 'metric_numeric';
    }
  }

  /** Текстовая шкала: немного разных коротких строк */
  if (!usedUnique.has('metric_ordinal_text')) {
    let bestI = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (out[i] !== 'ignore') continue;
      const s = stats[i];
      if (s.uniqueStrCount >= 2 && s.uniqueStrCount <= 18 && s.nonEmptyRatio > 0.35 && s.medianStrLen < 45) {
        const score = s.nonEmptyRatio * 50 - s.uniqueStrCount;
        if (score > bestScore) {
          bestScore = score;
          bestI = i;
        }
      }
    }
    if (bestI >= 0) takeUnique('metric_ordinal_text', bestI);
  }

  /** Длинные тексты — по очереди роли */
  const textRoles: ColumnRole[] = ['text_ai_summary', 'text_ai_recommendations', 'text_list_features'];
  let tr = 0;
  const longTextCols = headers
    .map((_, i) => ({ i, s: stats[i] }))
    .filter(({ i, s }) => out[i] === 'ignore' && s.medianStrLen >= 35 && s.nonEmptyRatio > 0.2)
    .sort((a, b) => b.s.medianStrLen - a.s.medianStrLen);

  for (const { i } of longTextCols) {
    if (tr < textRoles.length) {
      takeUnique(textRoles[tr], i);
      tr++;
    } else {
      takeUnique('text_ai_summary', i);
    }
  }

  /** Подпись строки: первый осмысленный текстовый столбец без роли */
  if (!usedUnique.has('row_label')) {
    for (let i = 0; i < n; i++) {
      if (out[i] !== 'ignore') continue;
      const s = stats[i];
      if (s.medianStrLen > 8 && s.medianStrLen < 120 && s.nonEmptyRatio > 0.4) {
        if (takeUnique('row_label', i)) break;
      }
    }
  }

  /** Оставшиеся столбцы с числами — тоже пункты */
  for (let i = 0; i < n; i++) {
    if (out[i] !== 'ignore') continue;
    const s = stats[i];
    if (s.numericRatio >= 0.28) out[i] = 'metric_numeric';
  }

  inclusiveFillIgnored(headers, rows, out);

  if (!validateRoles(out).ok) {
    let placed = false;
    for (let i = 0; i < n; i++) {
      if (out[i] === 'ignore') {
        out[i] = 'metric_numeric';
        placed = true;
        break;
      }
    }
    if (!placed && n > 0) out[0] = 'metric_numeric';
  }

  const { roles: afterStrip } = applyServiceTimestampIgnore(headers, rows, out);
  return afterStrip;
}

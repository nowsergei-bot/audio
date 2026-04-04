import type { CellPrimitive } from './parse';
import type { ColumnRole, CustomFilterLabels } from './types';

function excelSerialToIsoDate(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseAnalyticsDate(cell: CellPrimitive): string | null {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) return Number.isFinite(cell.getTime()) ? cell.toISOString().slice(0, 10) : null;
  if (typeof cell === 'number') return excelSerialToIsoDate(cell);
  const s = String(cell).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

export function parseNumber(cell: CellPrimitive): number | null {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  const n = Number(String(cell).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function filterKeyForRole(role: ColumnRole, labels: CustomFilterLabels): string {
  if (role === 'filter_custom_1' && labels.filter_custom_1?.trim()) return labels.filter_custom_1.trim();
  if (role === 'filter_custom_2' && labels.filter_custom_2?.trim()) return labels.filter_custom_2.trim();
  if (role === 'filter_custom_3' && labels.filter_custom_3?.trim()) return labels.filter_custom_3.trim();
  return role;
}

const FILTER_ROLES: ColumnRole[] = [
  'filter_teacher_code',
  'filter_parallel',
  'filter_class',
  'filter_subject',
  'filter_format',
  'filter_custom_1',
  'filter_custom_2',
  'filter_custom_3',
];

export function isFilterRole(r: ColumnRole): boolean {
  return FILTER_ROLES.includes(r);
}

export type AnalyticRow = {
  idx: number;
  /** Если в ячейке «наставники» было несколько ФИО, это номер фрагмента (1…N) */
  splitPart?: number;
  date: string | null;
  rowLabel: string | null;
  metricsNumeric: { colIndex: number; header: string; value: number | null }[];
  metricOrdinal: number | null;
  texts: { kind: ColumnRole; header: string; text: string }[];
  /** для фильтрации */
  filterValues: Record<string, string>;
};

function cellText(cell: CellPrimitive): string {
  if (cell == null || cell === '') return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/**
 * ordinalLevels: порядок уровней от «худшего» к «лучшему»; значение получает rank 1..N
 */
export function buildOrdinalRankMap(levelsOrdered: string[]): Map<string, number> {
  const m = new Map<string, number>();
  levelsOrdered.forEach((raw, i) => {
    const k = raw.trim().toLowerCase();
    if (k && !m.has(k)) m.set(k, i + 1);
  });
  return m;
}

export function ordinalRankForCell(
  cell: CellPrimitive,
  rankMap: Map<string, number>,
): number | null {
  const t = cellText(cell).toLowerCase();
  if (!t) return null;
  return rankMap.get(t) ?? null;
}

export function buildAnalyticRows(
  headers: string[],
  rows: CellPrimitive[][],
  roles: ColumnRole[],
  customLabels: CustomFilterLabels,
  ordinalLevelsOrdered: string[],
): AnalyticRow[] {
  const ordinalCol = roles.findIndex((r) => r === 'metric_ordinal_text');
  const rankMap = ordinalCol >= 0 ? buildOrdinalRankMap(ordinalLevelsOrdered) : new Map<string, number>();

  const metricNumericCols: { i: number; h: string }[] = [];
  roles.forEach((r, i) => {
    if (r === 'metric_numeric') metricNumericCols.push({ i, h: headers[i] || `Колонка ${i + 1}` });
  });

  const out: AnalyticRow[] = [];
  rows.forEach((line, idx) => {
    const filterValues: Record<string, string> = {};
    for (let c = 0; c < roles.length; c++) {
      const role = roles[c];
      if (!isFilterRole(role)) continue;
      const key = filterKeyForRole(role, customLabels);
      const raw = cellText(line[c]);
      filterValues[key] = raw || '(не указано)';
    }

    const dateCol = roles.indexOf('date');
    const labelCol = roles.indexOf('row_label');

    const metricsNumeric = metricNumericCols.map(({ i, h }) => ({
      colIndex: i,
      header: h,
      value: parseNumber(line[i]),
    }));

    let metricOrdinal: number | null = null;
    if (ordinalCol >= 0) {
      metricOrdinal = ordinalRankForCell(line[ordinalCol], rankMap);
    }

    const texts: { kind: ColumnRole; header: string; text: string }[] = [];
    roles.forEach((r, c) => {
      if (r === 'text_ai_summary' || r === 'text_ai_recommendations' || r === 'text_list_features') {
        const t = cellText(line[c]);
        if (t) texts.push({ kind: r, header: headers[c] || `Колонка ${c + 1}`, text: t });
      }
    });

    out.push({
      idx,
      date: dateCol >= 0 ? parseAnalyticsDate(line[dateCol]) : null,
      rowLabel: labelCol >= 0 ? cellText(line[labelCol]) || null : null,
      metricsNumeric,
      metricOrdinal,
      texts,
      filterValues,
    });
  });

  return out;
}

/** Разделители в ячейке с несколькими наставниками / ФИО */
export function splitMultiValues(raw: string): string[] {
  return raw
    .split(/[,;|]|\/|\n|\r+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Одна ячейка с несколькими значениями через запятую (Google Forms и т.п.) → несколько аналитических строк
 * с теми же метриками; в фильтрах и графиках каждое значение — отдельный «пойнт».
 * Для колонки наставника сохраняется нумерация splitPart (как раньше).
 * Порядок развёртки — слева направо по колонкам в таблице (роли в массиве roles).
 */
function expandOneFilterColumn(rows: AnalyticRow[], key: string, role: ColumnRole): AnalyticRow[] {
  const isTeacher = role === 'filter_teacher_code';
  const next: AnalyticRow[] = [];
  for (const row of rows) {
    const raw = row.filterValues[key];
    if (raw == null || raw === '' || raw === '(не указано)') {
      next.push(row);
      continue;
    }
    const parts = splitMultiValues(raw);
    if (parts.length <= 1) {
      next.push({
        ...row,
        splitPart: isTeacher ? undefined : row.splitPart,
        filterValues: { ...row.filterValues, [key]: parts[0] ?? raw },
      });
      continue;
    }
    parts.forEach((p, si) => {
      next.push({
        ...row,
        splitPart: isTeacher ? si + 1 : row.splitPart,
        filterValues: { ...row.filterValues, [key]: p },
      });
    });
  }
  return next;
}

export function expandRowsForMultiValueFilterColumns(
  rows: AnalyticRow[],
  roles: ColumnRole[],
  customLabels: CustomFilterLabels,
): AnalyticRow[] {
  let out = rows;
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    if (!isFilterRole(r)) continue;
    const key = filterKeyForRole(r, customLabels);
    out = expandOneFilterColumn(out, key, r);
  }
  return out;
}

/** Одна колонка наставников (обратная совместимость). */
export function expandRowsForMultiTeacher(rows: AnalyticRow[], teacherFilterKey: string): AnalyticRow[] {
  return expandOneFilterColumn(rows, teacherFilterKey, 'filter_teacher_code');
}

export type FilterSelection = Record<string, string[] | null>;
/** null = все значения (нет ограничения) */

export function applyFilters(rows: AnalyticRow[], selection: FilterSelection): AnalyticRow[] {
  return rows.filter((row) => {
    for (const [key, allowed] of Object.entries(selection)) {
      if (allowed == null) continue;
      if (allowed.length === 0) return false;
      const v = row.filterValues[key];
      if (v == null) return false;
      if (!allowed.includes(v)) return false;
    }
    return true;
  });
}

/** Срез по всем фильтрам, кроме одного ключа (для него «все значения») — основа каскадных списков. */
export function applyFiltersExceptKey(rows: AnalyticRow[], selection: FilterSelection, exceptKey: string): AnalyticRow[] {
  const partial: FilterSelection = { ...selection };
  if (exceptKey in partial) partial[exceptKey] = null;
  return applyFilters(rows, partial);
}

/**
 * Убирает из выбора значения, несовместимые с остальными фильтрами (итеративно до стабилизации).
 * Пустой массив [] по ключу = «ничего не выбрано» — не трогаем.
 */
export function pruneFilterSelection(
  rows: AnalyticRow[],
  selection: FilterSelection,
  filterKeys: string[],
): FilterSelection {
  let current: FilterSelection = { ...selection };
  for (let iter = 0; iter < 14; iter++) {
    let changed = false;
    const next: FilterSelection = { ...current };
    for (const key of filterKeys) {
      const cur = next[key];
      if (cur == null) continue;
      if (Array.isArray(cur) && cur.length === 0) continue;

      const base = applyFiltersExceptKey(rows, next, key);
      const allowed = new Set(uniqueFilterValues(base, key));
      const kept = cur.filter((v) => allowed.has(v));
      if (kept.length === 0) {
        next[key] = null;
        changed = true;
      } else if (kept.length < cur.length) {
        next[key] = kept;
        changed = true;
      }
    }
    if (!changed) return next;
    current = next;
  }
  return current;
}

export function filterSelectionsEqual(a: FilterSelection, b: FilterSelection, keys: string[]): boolean {
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (x == null && y == null) continue;
    if (x == null || y == null) return false;
    if (!Array.isArray(x) || !Array.isArray(y)) return false;
    if (x.length !== y.length) return false;
    const xs = [...x].sort((u, v) => u.localeCompare(v, 'ru'));
    const ys = [...y].sort((u, v) => u.localeCompare(v, 'ru'));
    if (!xs.every((v, i) => v === ys[i])) return false;
  }
  return true;
}

export function uniqueFilterValues(rows: AnalyticRow[], key: string): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    const v = r.filterValues[key];
    if (v != null) s.add(v);
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Гистограмма для первой числовой метрики с индексом colIndex (из mapping) */
export function histogramNumeric(
  rows: AnalyticRow[],
  colIndex: number,
  bins: number,
): { label: string; count: number }[] {
  const vals = rows
    .map((r) => r.metricsNumeric.find((m) => m.colIndex === colIndex)?.value)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return [{ label: String(min.toFixed(2)), count: vals.length }];
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    let i = Math.floor((v - min) / step);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    counts[i]++;
  }
  return counts.map((count, i) => {
    const a = min + i * step;
    const b = min + (i + 1) * step;
    return { label: `${a.toFixed(1)}–${b.toFixed(1)}`, count };
  });
}

export function countsByMonth(rows: AnalyticRow[]): { month: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.date) continue;
    const month = r.date.slice(0, 7);
    m.set(month, (m.get(month) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

export function ordinalDistribution(
  rows: AnalyticRow[],
  ordinalLevelsOrdered: string[],
): { level: string; count: number }[] {
  const m = new Map<number, number>();
  for (const r of rows) {
    if (r.metricOrdinal == null) continue;
    m.set(r.metricOrdinal, (m.get(r.metricOrdinal) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, count]) => ({
      level: ordinalLevelsOrdered[rank - 1]?.trim() || `Уровень ${rank}`,
      count,
    }));
}

export function meanMinMax(rows: AnalyticRow[], colIndex: number): { mean: number; min: number; max: number; n: number } | null {
  const vals = rows
    .map((r) => r.metricsNumeric.find((m) => m.colIndex === colIndex)?.value)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean, min, max, n: vals.length };
}

/** Сумма всех числовых пунктов в строке (пропуски не входят). */
export function rowNumericSum(row: AnalyticRow): number | null {
  const parts = row.metricsNumeric.map((m) => m.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0);
}

export function sumTotalStats(rows: AnalyticRow[]): { mean: number; min: number; max: number; n: number } | null {
  const sums = rows.map(rowNumericSum).filter((v): v is number => v != null);
  if (sums.length === 0) return null;
  const min = Math.min(...sums);
  const max = Math.max(...sums);
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  return { mean, min, max, n: sums.length };
}

/** Среднее по каждому числовому столбцу — для сравнительной диаграммы. */
export function meanByNumericColumn(
  rows: AnalyticRow[],
  colIndices: number[],
  headerByIndex: (i: number) => string,
): { name: string; mean: number; colIndex: number }[] {
  return colIndices
    .map((colIndex) => {
      const mm = meanMinMax(rows, colIndex);
      if (!mm) return null;
      return { name: headerByIndex(colIndex), mean: mm.mean, colIndex };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

/** Средние по каждому наставнику по всем числовым пунктам — для групповой диаграммы. */
export function meanByTeacherGrouped(
  rows: AnalyticRow[],
  teacherKey: string,
  metricColIndices: number[],
): Array<Record<string, string | number | null>> {
  const teachers = uniqueFilterValues(rows, teacherKey).filter((t) => t && t !== '(не указано)');
  return teachers
    .map((teacher) => {
      const sub = rows.filter((r) => r.filterValues[teacherKey] === teacher);
      const row: Record<string, string | number | null> = { mentor: teacher };
      for (const mi of metricColIndices) {
        const mm = meanMinMax(sub, mi);
        row[`m${mi}`] = mm?.mean ?? null;
      }
      return row;
    })
    .sort((a, b) => String(a.mentor).localeCompare(String(b.mentor), 'ru'));
}

const TEXT_KIND_LABEL: Partial<Record<ColumnRole, string>> = {
  text_ai_summary: 'выводы / резюме',
  text_ai_recommendations: 'рекомендации',
  text_list_features: 'списки / теги',
};

function excerpt(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Одна аналитическая строка на запись урока (первая по idx) — чтобы средние и шкалы не раздувались развёрткой тегов/наставников. */
export function dedupeRowsByLessonIdx(rows: AnalyticRow[]): AnalyticRow[] {
  const seen = new Set<number>();
  const out: AnalyticRow[] = [];
  for (const r of rows) {
    if (seen.has(r.idx)) continue;
    seen.add(r.idx);
    out.push(r);
  }
  return out;
}

function normLessonKeyPart(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

/**
 * Логический «урок»/событие для счётчиков на дашборде: дата + подпись строки + все фильтры,
 * кроме колонки наставника (несколько ФИО в ячейке дают несколько аналитических строк одного урока).
 * Если признаков мало (одна координата), к ключу добавляется idx — не склеиваем разные строки импорта.
 */
export function lessonSemanticKey(row: AnalyticRow, excludeTeacherFilterKey: string | null): string {
  const segs: string[] = [];
  if (row.date) segs.push(`d:${row.date}`);
  if (row.rowLabel?.trim()) segs.push(`lbl:${normLessonKeyPart(row.rowLabel)}`);
  const keys = Object.keys(row.filterValues).sort((a, b) => a.localeCompare(b, 'ru'));
  for (const k of keys) {
    if (excludeTeacherFilterKey && k === excludeTeacherFilterKey) continue;
    const v = row.filterValues[k];
    if (!v || v === '(не указано)') continue;
    segs.push(`${k}:${normLessonKeyPart(String(v))}`);
  }
  if (segs.length <= 1) {
    return `${segs.join('|')}|idx:${row.idx}`;
  }
  return segs.join('|');
}

export function countUniqueLessonSemantics(rows: AnalyticRow[], excludeTeacherFilterKey: string | null): number {
  const s = new Set<string>();
  for (const r of rows) {
    s.add(lessonSemanticKey(r, excludeTeacherFilterKey));
  }
  return s.size;
}

/** Число уникальных физических строк импорта (idx) в выборке. */
export function countUniqueImportRows(rows: AnalyticRow[]): number {
  return new Set(rows.map((r) => r.idx)).size;
}

/** Ключ для объединения почти одинаковых подписей («Математика» / «математика »). */
export function normalizeFacetAggregateKey(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s || s === '(не указано)') return s;
  return s.toLocaleLowerCase('ru');
}

export type FilterBucketCounts = {
  display: string;
  /** Уникальные логические уроки (семантический ключ, без двойного счёта дубликатов строк Excel) */
  uniqueLessons: number;
  /** Сколько аналитических строк после развёртки мультизначений */
  expandedRows: number;
};

/**
 * Срез по фильтру: считает уникальные логические уроки и строки развёртки; сливает варианты с одинаковой нормализованной подписью.
 * excludeTeacherFilterKey — ключ колонки наставника в filterValues (исключается из семантического ключа урока).
 */
export function topFilterBucketsByUniqueLesson(
  rows: AnalyticRow[],
  key: string,
  topN: number,
  excludeTeacherFilterKey: string | null,
): FilterBucketCounts[] {
  const m = new Map<string, { display: string; lessonKeys: Set<string>; expandedRows: number }>();
  for (const r of rows) {
    const raw = (r.filterValues[key] ?? '(не указано)').trim() || '(не указано)';
    const k = normalizeFacetAggregateKey(raw);
    const lk = lessonSemanticKey(r, excludeTeacherFilterKey);
    const cur = m.get(k);
    if (!cur) {
      m.set(k, { display: raw, lessonKeys: new Set([lk]), expandedRows: 1 });
    } else {
      cur.lessonKeys.add(lk);
      cur.expandedRows += 1;
    }
  }
  return [...m.values()]
    .map((v) => ({
      display: v.display,
      uniqueLessons: v.lessonKeys.size,
      expandedRows: v.expandedRows,
    }))
    .sort((a, b) => b.uniqueLessons - a.uniqueLessons || b.expandedRows - a.expandedRows)
    .slice(0, topN);
}

function formatFilterBucketLine(b: FilterBucketCounts): string {
  if (b.expandedRows === b.uniqueLessons) {
    return `  • ${b.display}: ${b.uniqueLessons}`;
  }
  return `  • ${b.display}: ${b.uniqueLessons} уник. записей урока (${b.expandedRows} строк после развёртки мультизначений в ячейках)`;
}

/**
 * Развёрнутая выгрузка фактов для ИИ: срезы по фильтрам, распределение шкалы, шифры педагогов с числом строк,
 * больше текстовых цитат — чтобы модель могла писать отчёт уровня «комплексного анализа», а не пересказ одной строки.
 */
export function buildRichLlmContextRu(
  allRows: AnalyticRow[],
  filtered: AnalyticRow[],
  opts: {
    dateLabel: string;
    numericMetrics: { colIndex: number; label: string }[];
    hasOrdinal: boolean;
    ordinalLevels: string[];
    teacherFilterKey: string | null;
    filterKeys: string[];
    filterLabels: Record<string, string>;
  },
): string {
  const lines: string[] = [];
  const filteredOneLesson = dedupeRowsByLessonIdx(filtered);
  const semAll = countUniqueLessonSemantics(allRows, opts.teacherFilterKey);
  const semFiltered = countUniqueLessonSemantics(filtered, opts.teacherFilterKey);
  const idxAll = countUniqueImportRows(allRows);
  const idxFiltered = countUniqueImportRows(filtered);
  lines.push('=== ВЫГРУЗКА ДЛЯ АНАЛИТИЧЕСКОГО ОТЧЁТА (факты по текущему срезу) ===');
  lines.push(
    `В файле: ${semAll} уникальных уроков по смыслу (дата, подпись строки, все срезы кроме наставника; совпадающие строки Excel с одним событием схлопываются); ${idxAll} строк импорта; ${allRows.length} аналитических строк после развёртки ячеек.`,
  );
  lines.push(
    `В текущем срезе: ${semFiltered} уроков по смыслу; ${idxFiltered} строк импорта; ${filtered.length} аналитических строк.`,
  );
  lines.push(
    'Средние по числам и доли по шкале ниже — по одной строке импорта на вес (idx), без раздувания от развёртки. Срезы по фильтрам: первое число — логические уроки с этим значением; в скобках — строки развёртки при необходимости.',
  );

  if (opts.dateLabel) {
    const dates = filteredOneLesson.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (dates.length) {
      dates.sort();
      lines.push(`Период (колонка «${opts.dateLabel}»): с ${dates[0]} по ${dates[dates.length - 1]}.`);
    }
  }

  if (opts.teacherFilterKey) {
    const buckets = topFilterBucketsByUniqueLesson(filtered, opts.teacherFilterKey, 200, opts.teacherFilterKey);
    const known = buckets.filter((x) => x.display !== '(не указано)');
    lines.push('');
    lines.push(
      `Педагоги по полю «${opts.filterLabels[opts.teacherFilterKey] ?? opts.teacherFilterKey}» (сначала уникальные уроки с этим кодом/ФИО; при развёртке — сколько аналитических строк):`,
    );
    for (const b of known) {
      lines.push(formatFilterBucketLine(b));
    }
    if (known.length === 0) lines.push('  (нет заполненных шифров в срезе)');
  }

  for (const fk of opts.filterKeys) {
    if (opts.teacherFilterKey && fk === opts.teacherFilterKey) continue;
    const label = opts.filterLabels[fk] ?? fk;
    const top = topFilterBucketsByUniqueLesson(filtered, fk, 18, opts.teacherFilterKey);
    if (top.length === 0) continue;
    lines.push('');
    lines.push(`Срез по «${label}» (топ по числу уникальных уроков; похожие написания объединены):`);
    for (const b of top) {
      lines.push(formatFilterBucketLine(b));
    }
  }

  if (opts.numericMetrics.length > 0) {
    lines.push('');
    lines.push(
      'Числовые критерии по уникальным записям урока (чем выше значение, тем лучше по смыслу пункта; название столбца = формулировка критерия):',
    );
    for (const { colIndex, label } of opts.numericMetrics) {
      const mm = meanMinMax(filteredOneLesson, colIndex);
      if (mm) {
        lines.push(
          `  • «${label}»: среднее ${mm.mean.toFixed(2)}, мин. ${mm.min.toFixed(2)}, макс. ${mm.max.toFixed(2)} (уроков с числом: ${mm.n}).`,
        );
      } else {
        lines.push(`  • «${label}»: нет чисел в срезе.`);
      }
    }
    if (opts.numericMetrics.length > 1) {
      const st = sumTotalStats(filteredOneLesson);
      if (st) {
        lines.push(
          `Сумма всех числовых пунктов по строке (пустые не входят): среднее ${st.mean.toFixed(2)}, мин. ${st.min.toFixed(2)}, макс. ${st.max.toFixed(2)} (уроков с ≥1 числом: ${st.n}).`,
        );
      }
    }
  }

  if (opts.hasOrdinal && opts.ordinalLevels.length > 0) {
    const dist = ordinalDistribution(filteredOneLesson, opts.ordinalLevels);
    lines.push('');
    lines.push('Распределение по текстовой шкале (доли по уникальным урокам):');
    if (dist.length === 0) {
      lines.push('  (нет заполненных значений шкалы)');
    } else {
      const total = dist.reduce((s, x) => s + x.count, 0);
      for (const { level, count } of dist) {
        const pct = total > 0 ? ((100 * count) / total).toFixed(1) : '0';
        lines.push(`  • ${level}: ${count} уроков (${pct}%)`);
      }
    }
  } else if (opts.hasOrdinal) {
    const withO = filteredOneLesson.filter((r) => r.metricOrdinal != null).length;
    lines.push('');
    lines.push(`Текстовая шкала: заполнено в ${withO} уроках (порядок уровней в интерфейсе не передан).`);
  }

  const textByHeader = new Map<string, { kind: ColumnRole; snippets: string[] }>();
  const maxSnippets = 12;
  for (const row of filteredOneLesson) {
    for (const { kind, header, text } of row.texts) {
      const key = `${kind}\t${header}`;
      const cur = textByHeader.get(key) ?? { kind, snippets: [] as string[] };
      if (cur.snippets.length < maxSnippets && !cur.snippets.includes(text)) cur.snippets.push(text);
      textByHeader.set(key, cur);
    }
  }
  if (textByHeader.size > 0) {
    lines.push('');
    lines.push('Текстовые поля (выдержки для смыслового анализа; не дословное воспроизведение всей базы):');
    const sorted = [...textByHeader.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    for (const [key, { kind, snippets }] of sorted) {
      const header = key.split('\t')[1] ?? '';
      const kindRu = TEXT_KIND_LABEL[kind] ?? 'текст';
      lines.push(`  «${header}» (${kindRu}):`);
      snippets.forEach((t, i) => {
        lines.push(`    ${i + 1}) ${excerpt(t, 320)}`);
      });
    }
  }

  lines.push('');
  lines.push('=== КОНЕЦ ВЫГРУЗКИ ===');
  return lines.join('\n');
}

/**
 * Краткий текст без внешнего ИИ. Коды педагогов не перечисляем поимённо.
 * Все числовые пункты перечисляются с названиями столбцов; текстовые поля — краткие выдержки.
 */
export function buildQuickSummaryRu(
  rows: AnalyticRow[],
  filtered: AnalyticRow[],
  opts: {
    hasTeacherFilter: boolean;
    /** Ключ filterValues колонки наставника (исключается из семантического ключа урока). */
    mentorFilterKey: string | null;
    dateLabel: string;
    /** Все столбцы с ролью «числовая метрика» — каждый отражается в тексте. */
    numericMetrics: { colIndex: number; label: string }[];
    hasOrdinal: boolean;
  },
): string {
  const lines: string[] = [];
  const f1 = dedupeRowsByLessonIdx(filtered);
  const semRows = countUniqueLessonSemantics(rows, opts.mentorFilterKey);
  const semFilt = countUniqueLessonSemantics(filtered, opts.mentorFilterKey);
  const idxRows = countUniqueImportRows(rows);
  const idxFilt = countUniqueImportRows(filtered);
  lines.push(
    `Уникальных уроков по смыслу: ${semRows} в файле (${idxRows} строк импорта); в срезе: ${semFilt} (${idxFilt} строк импорта). Аналитических строк после развёртки: ${rows.length} (в срезе ${filtered.length}).`,
  );
  lines.push(
    'Средние по числам и шкала — по одной строке импорта на вес (idx), без двойного учёта развёртки наставников/тегов.',
  );
  if (opts.dateLabel) {
    const dates = f1.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (dates.length) {
      dates.sort();
      lines.push(`Период (по колонке «${opts.dateLabel}»): с ${dates[0]} по ${dates[dates.length - 1]}.`);
    }
  }
  if (opts.hasTeacherFilter && opts.mentorFilterKey) {
    const mk = opts.mentorFilterKey;
    const teachers = new Set(filtered.map((r) => r.filterValues[mk]).filter((x) => x && x !== '(не указано)'));
    lines.push(
      `Наставников в выборке: ${teachers.size}. Сводные средние по каждому — на графике «По наставникам»; ФИО в тексте не перечисляем.`,
    );
  }

  if (opts.numericMetrics.length > 0) {
    lines.push('');
    lines.push(
      'Числовые пункты (по каждому столбцу: чем выше значение, тем лучше по этому критерию; название столбца — формулировка пункта):',
    );
    for (const { colIndex, label } of opts.numericMetrics) {
      const mm = meanMinMax(f1, colIndex);
      if (mm) {
        lines.push(
          `  • «${label}»: среднее ${mm.mean.toFixed(2)}, мин. ${mm.min.toFixed(2)}, макс. ${mm.max.toFixed(2)} (уроков с числом: ${mm.n}).`,
        );
      } else {
        lines.push(`  • «${label}»: нет числовых значений в выборке.`);
      }
    }
    if (opts.numericMetrics.length > 1) {
      const st = sumTotalStats(f1);
      if (st) {
        lines.push(
          `Сумма всех перечисленных пунктов по строке (сложение набранных баллов по строкам, пустые ячейки не входят): среднее ${st.mean.toFixed(2)}, мин. ${st.min.toFixed(2)}, макс. ${st.max.toFixed(2)} (уроков с хотя бы одним числом: ${st.n}).`,
        );
      }
    }
  }

  if (opts.hasOrdinal) {
    const withO = f1.filter((r) => r.metricOrdinal != null).length;
    lines.push('');
    lines.push(`Текстовая шкала: заполнено в ${withO} уроках.`);
  }

  const textByHeader = new Map<string, { kind: ColumnRole; snippets: string[] }>();
  for (const row of f1) {
    for (const { kind, header, text } of row.texts) {
      const key = `${kind}\t${header}`;
      const cur = textByHeader.get(key) ?? { kind, snippets: [] as string[] };
      if (cur.snippets.length < 3 && !cur.snippets.includes(text)) cur.snippets.push(text);
      textByHeader.set(key, cur);
    }
  }
  if (textByHeader.size > 0) {
    lines.push('');
    lines.push('Текстовый анализ (содержание полей — выдержки из выборки после фильтров):');
    const sorted = [...textByHeader.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    for (const [key, { kind, snippets }] of sorted) {
      const header = key.split('\t')[1] ?? '';
      const kindRu = TEXT_KIND_LABEL[kind] ?? 'текст';
      lines.push(`  • «${header}» (${kindRu}), примеры формулировок:`);
      snippets.forEach((t, i) => {
        lines.push(`    ${i + 1}) ${excerpt(t)}`);
      });
    }
  }

  return lines.join('\n');
}

/** Пакет фактов для ИИ-записки директору по одному педагогу (или педагог+предмет). */
export type DirectorFactPacket = {
  segmentId: string;
  teacher: string;
  subject: string | null;
  factsSummary: string;
  rowCount: number;
};

function buildDirectorSegmentFactsLines(
  subRows: AnalyticRow[],
  opts: {
    teacher: string;
    subject: string | null;
    teacherHeader: string;
    subjectHeader: string;
    dateLabel: string;
    numericMetrics: { colIndex: number; label: string }[];
    hasOrdinal: boolean;
    ordinalLevels: string[];
    teacherFilterKey: string;
  },
): string {
  const lines: string[] = [];
  const uniqueSemantic = countUniqueLessonSemantics(subRows, opts.teacherFilterKey);
  const uniqueImport = countUniqueImportRows(subRows);
  const subOne = dedupeRowsByLessonIdx(subRows);
  lines.push(`Педагог: ${opts.teacher} (колонка «${opts.teacherHeader}»).`);
  if (opts.subject != null) {
    lines.push(`Предмет / тематика: ${opts.subject} (колонка «${opts.subjectHeader}»).`);
  }
  lines.push(
    `Строк в сегменте: ${subRows.length}. Уроков по смыслу: ${uniqueSemantic}. Строк импорта (idx): ${uniqueImport}.`,
  );
  if (subOne.length < subRows.length) {
    lines.push('Средние и шкала ниже — по уникальным урокам (без двойного учёта из-за развёртки мультизначений).');
  }

  if (opts.dateLabel) {
    const dates = subOne.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (dates.length) {
      dates.sort();
      lines.push(`Период (колонка «${opts.dateLabel}»): с ${dates[0]} по ${dates[dates.length - 1]}.`);
    }
  }

  if (opts.numericMetrics.length > 0) {
    lines.push('');
    lines.push('Числовые пункты (по столбцам; для шкалы «больше = лучше»):');
    for (const { colIndex, label } of opts.numericMetrics) {
      const mm = meanMinMax(subOne, colIndex);
      if (mm) {
        lines.push(
          `  • «${label}»: среднее ${mm.mean.toFixed(2)}, мин. ${mm.min.toFixed(2)}, макс. ${mm.max.toFixed(2)} (уроков с числом: ${mm.n}).`,
        );
      } else {
        lines.push(`  • «${label}»: нет числовых значений в этом сегменте.`);
      }
    }
    if (opts.numericMetrics.length > 1) {
      const st = sumTotalStats(subOne);
      if (st) {
        lines.push(
          `Сумма пунктов по строке (пустые ячейки не входят): среднее ${st.mean.toFixed(2)}, мин. ${st.min.toFixed(2)}, макс. ${st.max.toFixed(2)} (уроков с хотя бы одним числом: ${st.n}).`,
        );
      }
    }
  }

  if (opts.hasOrdinal) {
    const withO = subOne.filter((r) => r.metricOrdinal != null).length;
    lines.push('');
    lines.push(`Текстовая шкала: заполнено в ${withO} уроках.`);
    if (opts.ordinalLevels.length > 0) {
      const dist = ordinalDistribution(subOne, opts.ordinalLevels);
      if (dist.length) {
        lines.push('Распределение по уровням шкалы (по уникальным урокам):');
        for (const { level, count } of dist) {
          lines.push(`  • ${level}: ${count}`);
        }
      }
    }
  }

  const textByHeader = new Map<string, { kind: ColumnRole; snippets: string[] }>();
  for (const row of subOne) {
    for (const { kind, header, text } of row.texts) {
      const key = `${kind}\t${header}`;
      const cur = textByHeader.get(key) ?? { kind, snippets: [] as string[] };
      if (cur.snippets.length < 4 && !cur.snippets.includes(text)) cur.snippets.push(text);
      textByHeader.set(key, cur);
    }
  }
  if (textByHeader.size > 0) {
    lines.push('');
    lines.push('Текстовые поля (выдержки из этого сегмента):');
    const sorted = [...textByHeader.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
    for (const [key, { kind, snippets }] of sorted) {
      const header = key.split('\t')[1] ?? '';
      const kindRu = TEXT_KIND_LABEL[kind] ?? 'текст';
      lines.push(`  • «${header}» (${kindRu}), примеры:`);
      snippets.forEach((t, i) => {
        lines.push(`    ${i + 1}) ${excerpt(t, 220)}`);
      });
    }
  }

  return lines.join('\n');
}

const DEFAULT_DIRECTOR_MAX_SEGMENTS = 36;

/**
 * Разбивает текущую выборку на сегменты по педагогу; если задан колонка предмета — по паре педагог+предмет.
 * Пустой код педагога в строке пропускается.
 */
export function buildDirectorFactPackets(
  filtered: AnalyticRow[],
  opts: {
    teacherKey: string;
    subjectKey: string | null;
    teacherHeader: string;
    subjectHeader: string;
    dateLabel: string;
    numericMetrics: { colIndex: number; label: string }[];
    hasOrdinal: boolean;
    ordinalLevels: string[];
    maxSegments?: number;
  },
): { packets: DirectorFactPacket[]; truncated: boolean; totalGroups: number } {
  const maxSeg = opts.maxSegments ?? DEFAULT_DIRECTOR_MAX_SEGMENTS;
  const groups = new Map<string, AnalyticRow[]>();
  for (const r of filtered) {
    const t = r.filterValues[opts.teacherKey];
    if (!t || t === '(не указано)') continue;
    const key = opts.subjectKey
      ? `${t}\u0000${r.filterValues[opts.subjectKey] ?? '(не указано)'}`
      : t;
    const cur = groups.get(key);
    if (cur) cur.push(r);
    else groups.set(key, [r]);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
  const totalGroups = sortedKeys.length;
  const limitedKeys = sortedKeys.slice(0, maxSeg);
  const packets: DirectorFactPacket[] = limitedKeys.map((key, idx) => {
    const sub = groups.get(key) ?? [];
    let teacher: string;
    let subject: string | null;
    if (opts.subjectKey) {
      const i = key.indexOf('\u0000');
      teacher = i >= 0 ? key.slice(0, i) : key;
      subject = i >= 0 ? key.slice(i + 1) : null;
    } else {
      teacher = key;
      subject = null;
    }
    const factsSummary = buildDirectorSegmentFactsLines(sub, {
      teacher,
      subject,
      teacherHeader: opts.teacherHeader,
      subjectHeader: opts.subjectHeader,
      dateLabel: opts.dateLabel,
      numericMetrics: opts.numericMetrics,
      hasOrdinal: opts.hasOrdinal,
      ordinalLevels: opts.ordinalLevels,
      teacherFilterKey: opts.teacherKey,
    });
    return {
      segmentId: `seg_${idx}`,
      teacher,
      subject,
      factsSummary,
      rowCount: sub.length,
    };
  });

  return { packets, truncated: totalGroups > maxSeg, totalGroups };
}

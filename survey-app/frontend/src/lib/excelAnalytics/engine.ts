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
 * Одна строка Excel с «Иванов, Петров» в колонке педагога → две аналитические строки с одними метриками урока.
 * Ключ фильтра — как в filterKeyForRole для filter_teacher_code.
 */
export function expandRowsForMultiTeacher(rows: AnalyticRow[], teacherFilterKey: string): AnalyticRow[] {
  const out: AnalyticRow[] = [];
  for (const row of rows) {
    const raw = row.filterValues[teacherFilterKey];
    if (!raw || raw === '(не указано)') {
      out.push(row);
      continue;
    }
    const parts = splitMultiValues(raw);
    if (parts.length <= 1) {
      out.push({
        ...row,
        splitPart: undefined,
        filterValues: { ...row.filterValues, [teacherFilterKey]: parts[0] ?? raw },
      });
      continue;
    }
    parts.forEach((teacher, si) => {
      out.push({
        ...row,
        splitPart: si + 1,
        filterValues: { ...row.filterValues, [teacherFilterKey]: teacher },
      });
    });
  }
  return out;
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

/**
 * Краткий текст без внешнего ИИ. Коды педагогов не перечисляем поимённо.
 * Все числовые пункты перечисляются с названиями столбцов; текстовые поля — краткие выдержки.
 */
export function buildQuickSummaryRu(
  rows: AnalyticRow[],
  filtered: AnalyticRow[],
  opts: {
    hasTeacherFilter: boolean;
    dateLabel: string;
    /** Все столбцы с ролью «числовая метрика» — каждый отражается в тексте. */
    numericMetrics: { colIndex: number; label: string }[];
    hasOrdinal: boolean;
    /** Уникальных строк Excel (уроков); если меньше rows.length — была развёртка наставников */
    uniqueLessons?: number;
  },
): string {
  const lines: string[] = [];
  if (opts.uniqueLessons != null && opts.uniqueLessons < rows.length) {
    lines.push(
      `Уроков (строк в таблице): ${opts.uniqueLessons}. Точек после развёртки наставников (несколько ФИО в ячейке): ${rows.length}. После фильтров: ${filtered.length}.`,
    );
  } else {
    lines.push(`Строк в файле: ${rows.length}. После фильтров: ${filtered.length}.`);
  }
  if (opts.dateLabel) {
    const dates = filtered.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (dates.length) {
      dates.sort();
      lines.push(`Период (по колонке «${opts.dateLabel}»): с ${dates[0]} по ${dates[dates.length - 1]}.`);
    }
  }
  if (opts.hasTeacherFilter) {
    const key = 'filter_teacher_code';
    const teachers = new Set(filtered.map((r) => r.filterValues[key]).filter((x) => x && x !== '(не указано)'));
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
      const mm = meanMinMax(filtered, colIndex);
      if (mm) {
        lines.push(
          `  • «${label}»: среднее ${mm.mean.toFixed(2)}, мин. ${mm.min.toFixed(2)}, макс. ${mm.max.toFixed(2)} (заполнено числом в ${mm.n} строках).`,
        );
      } else {
        lines.push(`  • «${label}»: нет числовых значений в выборке.`);
      }
    }
    if (opts.numericMetrics.length > 1) {
      const st = sumTotalStats(filtered);
      if (st) {
        lines.push(
          `Сумма всех перечисленных пунктов по строке (сложение набранных баллов по строкам, пустые ячейки не входят): среднее ${st.mean.toFixed(2)}, мин. ${st.min.toFixed(2)}, макс. ${st.max.toFixed(2)} (строк с хотя бы одним числом: ${st.n}).`,
        );
      }
    }
  }

  if (opts.hasOrdinal) {
    const withO = filtered.filter((r) => r.metricOrdinal != null).length;
    lines.push('');
    lines.push(`Текстовая шкала: заполнено в ${withO} строках.`);
  }

  const textByHeader = new Map<string, { kind: ColumnRole; snippets: string[] }>();
  for (const row of filtered) {
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

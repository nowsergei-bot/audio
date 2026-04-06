import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  Cell,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  postExcelDirectorDossier,
  postExcelFilterSections,
  postExcelFilterValueGroups,
  postExcelNarrativeSummary,
} from '../api/client';
import PulseExcelChat from '../components/PulseExcelChat';
import { formatBilingualCellLabel } from '../lib/excelAnalytics/excelDisplayLabel';
import { fadeIn } from '../motion/resultsMotion';
import {
  applyFilters,
  applyFiltersExceptKey,
  augmentRowsWithDerivedParallel,
  buildAnalyticRows,
  buildDirectorFactPackets,
  buildQuickSummaryRu,
  buildRichLlmContextRu,
  countUniqueImportRows,
  countUniqueLessonSemantics,
  countsByMonth,
  dedupeRowsByLessonIdx,
  expandRowsForMultiValueFilterColumns,
  filterKeyForRole,
  filterSelectionsEqual,
  histogramNumericBins,
  isFilterRole,
  meanByNumericColumn,
  meanByTeacherGrouped,
  meanMinMax,
  meanNumericByMonth,
  meanNumericByMonthAllMetrics,
  meanOrdinalRankByMonth,
  normalizeFacetAggregateKey,
  ordinalDistribution,
  parseAnalyticsDate,
  PULSE_PARALLEL_AUTO_KEY,
  pruneFilterSelection,
  rowNumericSum,
  sumTotalStats,
  topFilterBucketsByUniqueLesson,
  uniqueFilterValues,
  listFeatureTagCounts,
  listFeatureTagFrequencyByTeacher,
  listFeatureTagUniverse,
  teacherListFeatureCoverage,
  teachersInMetricBin,
  type AnalyticRow,
  type FilterSelection,
  type HistogramBinDetail,
} from '../lib/excelAnalytics/engine';
import { applyServiceTimestampIgnore } from '../lib/excelAnalytics/serviceTimestamp';
import { extractWorkbookCodebookRu } from '../lib/excelAnalytics/decoderSheets';
import {
  extractHeadersAndRows,
  getSheetMatrix,
  readWorkbookMeta,
  type CellPrimitive,
} from '../lib/excelAnalytics/parse';
import { suggestColumnRoles } from '../lib/excelAnalytics/autoMap';
import { buildAutoFilterSections, type FilterColumnForSections } from '../lib/excelAnalytics/filterSectionPlanner';
import type { ExcelFilterSectionPlan, ExcelFilterValueGroup } from '../types';
import {
  COLUMN_ROLE_OPTIONS,
  loadTemplates,
  normalizeHeader,
  saveTemplates,
  validateRoles,
  type ColumnRole,
  type CustomFilterLabels,
  type SavedMappingTemplate,
} from '../lib/excelAnalytics/types';

const MAX_ROWS = 8000;
const DIRECTOR_DOSSIER_CHUNK = 8;
const METRIC_HIST_BINS = 8;
const DRILL_MINI_SUMMARY_CHARS = 960;

function ExcelDrillMiniSummary({
  teacherName,
  quickText,
  onOpenFacts,
}: {
  teacherName: string;
  quickText: string;
  onOpenFacts: () => void;
}) {
  const preview =
    quickText.length > DRILL_MINI_SUMMARY_CHARS
      ? `${quickText.slice(0, DRILL_MINI_SUMMARY_CHARS)}…`
      : quickText;
  return (
    <div className="excel-metric-drill-mini-summary">
      <h4 className="excel-metric-drill-mini-summary-title">Сводка по срезу: {teacherName}</h4>
      <p className="muted excel-metric-drill-mini-summary-lead">Краткий машинный пересказ выборки (можно развернуть полный блок ниже).</p>
      <div className="excel-metric-drill-mini-summary-body">{preview}</div>
      <button type="button" className="btn excel-metric-drill-mini-summary-btn" onClick={onOpenFacts}>
        Полный текст в «Исходные факты»
      </button>
    </div>
  );
}

function buildFilterKeyLabels(
  roles: ColumnRole[],
  headers: string[],
  customLabels: CustomFilterLabels,
): Record<string, string> {
  const m: Record<string, string> = {};
  roles.forEach((r, i) => {
    if (!isFilterRole(r)) return;
    const fk = filterKeyForRole(r, customLabels);
    m[fk] = headers[i]?.trim() || fk;
  });
  if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
    m[PULSE_PARALLEL_AUTO_KEY] = 'Параллель (из класса)';
  }
  return m;
}

function splitNarrativeParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const MONTH_LABELS_RU = [
  'янв.',
  'фев.',
  'мар.',
  'апр.',
  'май',
  'июн.',
  'июл.',
  'авг.',
  'сен.',
  'окт.',
  'ноя.',
  'дек.',
];

function formatMonthRu(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return ym;
  const mi = parseInt(m[2], 10) - 1;
  const label = MONTH_LABELS_RU[mi] ?? m[2];
  return `${label} ${m[1]}`;
}

function mentorHeatColor(v: number, min: number, max: number): string {
  const span = max - min || 1;
  const t = Math.max(0, Math.min(1, (v - min) / span));
  const a = 0.14 + t * 0.52;
  return `rgba(227, 6, 19, ${a})`;
}

const DASH_BAR_COLORS = [
  '#e30613',
  '#b91c1c',
  '#7f1d1d',
  '#dc2626',
  '#f87171',
  '#991b1b',
  '#c2410c',
  '#9a3412',
  '#ca8a04',
  '#a16207',
  '#4b5563',
  '#374151',
];

function newTemplateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}`;
}

function collectOrdinalValues(rows: CellPrimitive[][], colIndex: number): string[] {
  const s = new Set<string>();
  for (const line of rows) {
    const c = line[colIndex];
    if (c == null || c === '') continue;
    const t = c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim();
    if (t) s.add(t);
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

export default function ExcelAnalyticsPage() {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [headerRow1Based, setHeaderRow1Based] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<CellPrimitive[][]>([]);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [customLabels, setCustomLabels] = useState<CustomFilterLabels>({});
  const [ordinalLevels, setOrdinalLevels] = useState<string[]>([]);
  const [templates, setTemplates] = useState<SavedMappingTemplate[]>(() => loadTemplates());
  const [templateName, setTemplateName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const [analyticRows, setAnalyticRows] = useState<AnalyticRow[]>([]);
  const [filterSelection, setFilterSelection] = useState<FilterSelection>({});
  const [metricPickIndex, setMetricPickIndex] = useState<number | null>(null);
  /** Клик по столбцу гистограммы метрики: интервал + список педагогов */
  const [metricDrill, setMetricDrill] = useState<{
    colIndex: number;
    header: string;
    bin: HistogramBinDetail;
    bins: number;
    histMin: number;
    histMax: number;
  } | null>(null);
  /** Раскрытие блока «Исходные факты» (в т.ч. после выбора педагога из дрилла) */
  const [excelFactsOpen, setExcelFactsOpen] = useState(false);
  /** При загрузке листа сразу подбирать роли по заголовкам и данным */
  const [autoMapOnLoad, setAutoMapOnLoad] = useState(false);
  /** Подписи из ячеек: по умолчанию только часть до «//» (рус.), иначе часть после «//». */
  const [showEnglishExcelLabels, setShowEnglishExcelLabels] = useState(false);
  /** Сообщение, если при анализе отсечена служебная колонка времени */
  const [serviceStripNote, setServiceStripNote] = useState<string | null>(null);
  const [summaryNarrative, setSummaryNarrative] = useState<string | null>(null);
  const [summaryNarrativeLoading, setSummaryNarrativeLoading] = useState(false);
  const [summaryNarrativeWords, setSummaryNarrativeWords] = useState<number | null>(null);
  const [summaryNarrativeApiHint, setSummaryNarrativeApiHint] = useState<string | null>(null);

  /** Полный «глубокий» отчёт по тому же срезу (вручную; параметры = фильтры). */
  const [deepNarrative, setDeepNarrative] = useState<string | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepHint, setDeepHint] = useState<string | null>(null);
  const [deepWords, setDeepWords] = useState<number | null>(null);
  const [deepUserFocus, setDeepUserFocus] = useState('');

  /** ИИ: альтернативная группировка разделов боковой панели (поверх авто). */
  const [aiSectionLayout, setAiSectionLayout] = useState<ExcelFilterSectionPlan[] | null>(null);
  const [aiSectionsBusy, setAiSectionsBusy] = useState(false);
  const [aiSectionsHint, setAiSectionsHint] = useState<string | null>(null);
  /** ИИ: смысловые подгруппы внутри длинных списков значений по ключу фильтра. */
  const [facetGroupsByKey, setFacetGroupsByKey] = useState<Record<string, ExcelFilterValueGroup[]>>({});
  const [facetGroupsBusy, setFacetGroupsBusy] = useState(false);
  const [facetGroupsHint, setFacetGroupsHint] = useState<string | null>(null);

  /** ИИ: записки для директора по каждому педагогу (и предмету, если колонка задана). */
  const [directorDossier, setDirectorDossier] = useState<
    { segmentId: string; teacher: string; subject: string | null; narrative: string | null }[] | null
  >(null);
  const [directorDossierBusy, setDirectorDossierBusy] = useState(false);
  const [directorDossierHint, setDirectorDossierHint] = useState<string | null>(null);
  const [directorDossierMeta, setDirectorDossierMeta] = useState<{ truncated: boolean; totalGroups: number } | null>(
    null,
  );

  /** Какой фильтр показывать на графике «распределение по срезу» (null = первый из списка). */
  const [userFilterChartKey, setUserFilterChartKey] = useState<string | null>(null);

  /** Педагог для блоков «список через запятую»: покрытие X из Y и топ отметок. */
  const [listFeatureMentorPick, setListFeatureMentorPick] = useState('');

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setErr('Нужен файл .xlsx');
      return;
    }
    setErr(null);
    try {
      const buf = await f.arrayBuffer();
      const meta = readWorkbookMeta(buf);
      setBuffer(buf);
      setFileName(f.name);
      setSheetNames(meta.sheetNames);
      setSheet(meta.sheetNames[0] ?? '');
      setHeaders([]);
      setRawRows([]);
      setRoles([]);
      setAnalyticRows([]);
      setFilterSelection({});
      setServiceStripNote(null);
      setSummaryNarrative(null);
      setSummaryNarrativeLoading(false);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Не удалось прочитать файл');
    }
  }, []);

  const applySuggestedRoles = useCallback((h: string[], rows: CellPrimitive[][]) => {
    const suggested = suggestColumnRoles(h, rows);
    setRoles(suggested);
    const oc = suggested.indexOf('metric_ordinal_text');
    if (oc >= 0) setOrdinalLevels(collectOrdinalValues(rows, oc));
    else setOrdinalLevels([]);
  }, []);

  const onApplySheet = () => {
    if (!buffer || !sheet) return;
    setErr(null);
    try {
      const matrix = getSheetMatrix(buffer, sheet);
      const { headers: h, rows } = extractHeadersAndRows(matrix, headerRow1Based, MAX_ROWS);
      setHeaders(h);
      setRawRows(rows);
      setAnalyticRows([]);
      setFilterSelection({});
      setServiceStripNote(null);
      setSummaryNarrative(null);
      setSummaryNarrativeLoading(false);
      setMetricPickIndex(null);
      if (autoMapOnLoad) applySuggestedRoles(h, rows);
      else {
        setRoles(h.map(() => 'ignore'));
        setOrdinalLevels([]);
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Ошибка разбора листа');
    }
  };

  const setRoleAt = (colIndex: number, role: ColumnRole) => {
    setRoles((prev) => {
      const next = [...prev];
      next[colIndex] = role;
      return next;
    });
    if (role === 'metric_ordinal_text') {
      setOrdinalLevels(collectOrdinalValues(rawRows, colIndex));
    }
  };

  const datePreview = useMemo(() => {
    const di = roles.indexOf('date');
    if (di < 0 || !rawRows.length) return [];
    const out: string[] = [];
    for (let i = 0; i < rawRows.length && out.length < 5; i++) {
      const d = parseAnalyticsDate(rawRows[i][di]);
      if (d) out.push(d);
    }
    return out;
  }, [roles, rawRows]);

  const metricNumericCols = useMemo(() => {
    const idxs: number[] = [];
    roles.forEach((r, i) => {
      if (r === 'metric_numeric') idxs.push(i);
    });
    return idxs;
  }, [roles]);

  const roleSummaryLines = useMemo(() => {
    if (!headers.length) return [];
    const lines: string[] = [];
    roles.forEach((r, i) => {
      if (r === 'ignore') return;
      const roleLabel = COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
      lines.push(`${headers[i] || `Колонка ${i + 1}`} → ${roleLabel}`);
    });
    return lines;
  }, [headers, roles]);

  const filteredRows = useMemo(() => {
    return applyFilters(analyticRows, filterSelection);
  }, [analyticRows, filterSelection]);

  /** Одна строка на урок: средние, гистограммы и шкала без лишнего веса после развёртки тегов/наставников. */
  const filteredRowsOnePerLesson = useMemo(
    () => dedupeRowsByLessonIdx(filteredRows),
    [filteredRows],
  );

  const teacherFilterKey = useMemo(() => {
    if (!roles.includes('filter_teacher_code')) return null;
    return filterKeyForRole('filter_teacher_code', customLabels);
  }, [roles, customLabels]);

  const resetAllFilters = useCallback(() => {
    setFilterSelection((prev) => {
      const next: FilterSelection = {};
      for (const k of Object.keys(prev)) next[k] = null;
      return next;
    });
  }, []);

  const mentorChartData = useMemo(() => {
    if (!teacherFilterKey || metricNumericCols.length === 0) return [];
    return meanByTeacherGrouped(filteredRows, teacherFilterKey, metricNumericCols);
  }, [filteredRows, teacherFilterKey, metricNumericCols]);

  /** Уроки по смыслу (дата + подпись + срезы без наставника); дубликаты строк Excel схлопываются. */
  const kpiLessons = useMemo(
    () => countUniqueLessonSemantics(filteredRows, teacherFilterKey),
    [filteredRows, teacherFilterKey],
  );
  const uniqueLessonCount = useMemo(
    () => countUniqueLessonSemantics(analyticRows, teacherFilterKey),
    [analyticRows, teacherFilterKey],
  );
  const kpiImportRowsFiltered = useMemo(() => countUniqueImportRows(filteredRows), [filteredRows]);
  const kpiImportRowsTotal = useMemo(() => countUniqueImportRows(analyticRows), [analyticRows]);

  const kpiMentors = useMemo(() => {
    if (!teacherFilterKey) return 0;
    return uniqueFilterValues(filteredRows, teacherFilterKey).filter((x) => x !== '(не указано)').length;
  }, [filteredRows, teacherFilterKey]);

  const filterKeys = useMemo(() => {
    const keys = new Set<string>();
    roles.forEach((r) => {
      if (isFilterRole(r)) keys.add(filterKeyForRole(r, customLabels));
    });
    if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
      keys.add(PULSE_PARALLEL_AUTO_KEY);
    }
    return [...keys];
  }, [roles, customLabels]);

  const filterSectionColumns = useMemo((): FilterColumnForSections[] => {
    const base = roles
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => isFilterRole(r))
      .map(({ r, i }) => ({
        filterKey: filterKeyForRole(r, customLabels),
        role: r,
        header: headers[i] || '',
        colIndex: i,
      }));
    if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
      base.unshift({
        filterKey: PULSE_PARALLEL_AUTO_KEY,
        role: 'filter_parallel',
        header: 'Параллель (из класса: 7А, 7B → 7)',
        colIndex: -1,
      });
    }
    return base;
  }, [roles, headers, customLabels]);

  const autoFilterSections = useMemo(() => buildAutoFilterSections(filterSectionColumns), [filterSectionColumns]);
  const filterSections = aiSectionLayout ?? autoFilterSections;

  const filterKeysSig = useMemo(() => [...filterKeys].sort().join('\u0001'), [filterKeys]);

  const filterKeyDisplayLabel = useMemo(() => {
    const m: Record<string, string> = {};
    roles.forEach((r, i) => {
      if (!isFilterRole(r)) return;
      const fk = filterKeyForRole(r, customLabels);
      const h = headers[i]?.trim();
      m[fk] = h || fk;
    });
    if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
      m[PULSE_PARALLEL_AUTO_KEY] = 'Параллель (из класса)';
    }
    return m;
  }, [roles, headers, customLabels]);

  const filterKeyDisplayLabelUi = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(filterKeyDisplayLabel)) {
      m[k] = formatBilingualCellLabel(v, mode);
    }
    return m;
  }, [filterKeyDisplayLabel, showEnglishExcelLabels]);

  const dashboardDateRange = useMemo(() => {
    const dates = filteredRowsOnePerLesson.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (!dates.length) return null;
    dates.sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [filteredRowsOnePerLesson]);

  const filterSnapshotRows = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    const rows: { label: string; value: string }[] = [];
    for (const k of filterKeys) {
      const sel = filterSelection[k];
      const label = filterKeyDisplayLabelUi[k] ?? k;
      if (sel === null) {
        rows.push({ label, value: 'Все значения' });
      } else if (Array.isArray(sel)) {
        if (sel.length === 0) rows.push({ label, value: 'Нет (срез по столбцу пуст)' });
        else rows.push({ label, value: sel.map((x) => formatBilingualCellLabel(x, mode)).join('; ') });
      }
    }
    return rows;
  }, [filterKeys, filterSelection, filterKeyDisplayLabelUi, showEnglishExcelLabels]);

  const filterSnapshotAllOpen = useMemo(
    () => filterSnapshotRows.length > 0 && filterSnapshotRows.every((r) => r.value === 'Все значения'),
    [filterSnapshotRows],
  );

  const singleTeacherFilterName = useMemo(() => {
    if (!teacherFilterKey) return null;
    const s = filterSelection[teacherFilterKey];
    if (Array.isArray(s) && s.length === 1) return s[0];
    return null;
  }, [teacherFilterKey, filterSelection]);

  /** Текст для ИИ: фильтры = параметры среза. */
  const filterParameterSummaryRu = useMemo(() => {
    if (!analyticRows.length) return '';
    const lines: string[] = [];
    lines.push(`Файл: ${fileName || '—'}, лист: ${sheet || '—'}`);
    lines.push(
      `Объём среза: ${kpiLessons} уроков по смыслу (${kpiImportRowsFiltered} строк импорта Excel); ${filteredRows.length} аналитических строк после возможной развёртки мультизначений в ячейках.`,
    );
    if (teacherFilterKey && kpiMentors > 0) {
      lines.push(`Уникальных кодов/значений наставника в срезе: ${kpiMentors}.`);
    }
    lines.push('Активные фильтры (параметры отбора в дашборде):');
    for (const r of filterSnapshotRows) {
      lines.push(`— ${r.label}: ${r.value}`);
    }
    return lines.join('\n');
  }, [
    analyticRows.length,
    fileName,
    sheet,
    kpiLessons,
    kpiImportRowsFiltered,
    filteredRows.length,
    filterSnapshotRows,
    teacherFilterKey,
    kpiMentors,
  ]);

  const metricsTableRows = useMemo(() => {
    return metricNumericCols.map((mi) => {
      const mm = meanMinMax(filteredRowsOnePerLesson, mi);
      return {
        col: mi,
        name: headers[mi] ?? `Колонка ${mi + 1}`,
        mean: mm?.mean ?? null,
        min: mm?.min ?? null,
        max: mm?.max ?? null,
        n: mm?.n ?? 0,
      };
    });
  }, [filteredRowsOnePerLesson, metricNumericCols, headers]);

  const sumStatsRow = useMemo(() => sumTotalStats(filteredRowsOnePerLesson), [filteredRowsOnePerLesson]);

  const histogramBinsForPick = useMemo(() => {
    if (metricPickIndex == null) return [];
    return histogramNumericBins(filteredRowsOnePerLesson, metricPickIndex, METRIC_HIST_BINS);
  }, [filteredRowsOnePerLesson, metricPickIndex]);

  const metricDrillTeachers = useMemo(() => {
    if (!metricDrill || !teacherFilterKey) return [];
    return teachersInMetricBin(
      filteredRowsOnePerLesson,
      metricDrill.colIndex,
      metricDrill.bin,
      metricDrill.histMin,
      metricDrill.histMax,
      metricDrill.bins,
      teacherFilterKey,
    );
  }, [metricDrill, teacherFilterKey, filteredRowsOnePerLesson]);

  const monthData = useMemo(() => countsByMonth(filteredRowsOnePerLesson), [filteredRowsOnePerLesson]);

  const ordinalChartData = useMemo(() => {
    if (roles.indexOf('metric_ordinal_text') < 0) return [];
    return ordinalDistribution(filteredRowsOnePerLesson, ordinalLevels);
  }, [filteredRowsOnePerLesson, ordinalLevels, roles]);

  const ordinalChartDisplay = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    return ordinalChartData.map((r) => ({
      ...r,
      level: formatBilingualCellLabel(r.level, mode),
    }));
  }, [ordinalChartData, showEnglishExcelLabels]);

  const metricHeaderLabel = metricPickIndex != null ? headers[metricPickIndex] ?? 'Метрика' : '';
  const metricHeaderLabelUi = useMemo(
    () => formatBilingualCellLabel(metricHeaderLabel, showEnglishExcelLabels ? 'en' : 'ru'),
    [metricHeaderLabel, showEnglishExcelLabels],
  );

  const metricColLegendLabel = useCallback(
    (colIndex: number, fallback: string) => {
      const raw = headers[colIndex] ?? fallback;
      return formatBilingualCellLabel(raw, showEnglishExcelLabels ? 'en' : 'ru') || fallback;
    },
    [headers, showEnglishExcelLabels],
  );

  const numericMetricsForSummary = useMemo(
    () => metricNumericCols.map((mi) => ({ colIndex: mi, label: headers[mi] ?? `Колонка ${mi + 1}` })),
    [metricNumericCols, headers],
  );

  const meanByColumnData = useMemo(() => {
    if (metricNumericCols.length < 2) return [];
    return meanByNumericColumn(filteredRowsOnePerLesson, metricNumericCols, (i) => headers[i] ?? `Колонка ${i + 1}`);
  }, [filteredRowsOnePerLesson, metricNumericCols, headers]);

  const meanChartRows = useMemo(
    () =>
      meanByColumnData.map((d) => ({
        short: d.name.length > 42 ? `${d.name.slice(0, 39)}…` : d.name,
        fullName: d.name,
        mean: d.mean,
      })),
    [meanByColumnData],
  );

  const meanChartDisplay = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    return meanChartRows.map((d) => {
      const full = formatBilingualCellLabel(d.fullName, mode);
      return {
        short: full.length > 42 ? `${full.slice(0, 39)}…` : full,
        fullName: full,
        mean: d.mean,
      };
    });
  }, [meanChartRows, showEnglishExcelLabels]);

  const effectiveFilterChartKey =
    userFilterChartKey && filterKeys.includes(userFilterChartKey) ? userFilterChartKey : filterKeys[0] ?? null;

  const filterBarChartData = useMemo(() => {
    if (!effectiveFilterChartKey) return [];
    return topFilterBucketsByUniqueLesson(filteredRows, effectiveFilterChartKey, 18, teacherFilterKey).map((b) => ({
      short: b.display.length > 42 ? `${b.display.slice(0, 39)}…` : b.display,
      fullName: b.display,
      uniqueLessons: b.uniqueLessons,
    }));
  }, [filteredRows, effectiveFilterChartKey, teacherFilterKey]);

  const filterBarChartDisplay = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    return filterBarChartData.map((b) => {
      const full = formatBilingualCellLabel(b.fullName, mode);
      return {
        short: full.length > 42 ? `${full.slice(0, 39)}…` : full,
        fullName: full,
        uniqueLessons: b.uniqueLessons,
      };
    });
  }, [filterBarChartData, showEnglishExcelLabels]);

  const listFeatureHeaders = useMemo(() => {
    const out: string[] = [];
    roles.forEach((r, i) => {
      if (r === 'text_list_features') out.push(headers[i] || `Колонка ${i + 1}`);
    });
    return out;
  }, [roles, headers]);

  const listFeatureMentorOptions = useMemo(() => {
    if (!teacherFilterKey) return [] as string[];
    return uniqueFilterValues(filteredRows, teacherFilterKey).filter((x) => x && x !== '(не указано)');
  }, [teacherFilterKey, filteredRows]);

  const listFeatureMentorEffective = useMemo(() => {
    if (!teacherFilterKey || listFeatureMentorOptions.length === 0) return '';
    if (listFeatureMentorPick && listFeatureMentorOptions.includes(listFeatureMentorPick)) {
      return listFeatureMentorPick;
    }
    return listFeatureMentorOptions[0] ?? '';
  }, [teacherFilterKey, listFeatureMentorOptions, listFeatureMentorPick]);

  const listFeatureDetailBundles = useMemo(() => {
    return listFeatureHeaders.map((header) => {
      const universe = listFeatureTagUniverse(filteredRowsOnePerLesson, header);
      const universeKeys = new Set(universe.map((u) => u.key));
      const globalFreq = listFeatureTagCounts(filteredRowsOnePerLesson, header, 28);
      const globalFreqChart = globalFreq.map((r) => ({
        short: r.display.length > 36 ? `${r.display.slice(0, 33)}…` : r.display,
        fullName: r.display,
        uniqueLessons: r.uniqueLessons,
      }));
      let teacherFreqChart: { short: string; fullName: string; lessonCount: number }[] = [];
      let coverage: { collected: number; total: number } | null = null;
      if (teacherFilterKey && listFeatureMentorEffective) {
        const tf = listFeatureTagFrequencyByTeacher(
          filteredRows,
          teacherFilterKey,
          listFeatureMentorEffective,
          header,
          28,
        );
        teacherFreqChart = tf.map((r) => ({
          short: r.display.length > 36 ? `${r.display.slice(0, 33)}…` : r.display,
          fullName: r.display,
          lessonCount: r.lessonCount,
        }));
        const cov = teacherListFeatureCoverage(
          filteredRows,
          teacherFilterKey,
          listFeatureMentorEffective,
          header,
          universeKeys,
        );
        coverage = { collected: cov.collectedUnique, total: cov.totalUniverse };
      }
      return { header, universe, globalFreqChart, teacherFreqChart, coverage };
    });
  }, [
    listFeatureHeaders,
    filteredRowsOnePerLesson,
    filteredRows,
    teacherFilterKey,
    listFeatureMentorEffective,
  ]);

  const listFeatureChartsPrepared = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    return listFeatureDetailBundles
      .filter((b) => b.universe.length > 0)
      .map((b) => {
        const grouped = b.globalFreqChart.map((g) => {
          const gk = normalizeFacetAggregateKey(g.fullName);
          const t = b.teacherFreqChart.find((x) => normalizeFacetAggregateKey(x.fullName) === gk);
          const full = formatBilingualCellLabel(g.fullName, mode);
          return {
            short: full.length > 42 ? `${full.slice(0, 39)}…` : full,
            fullName: full,
            slice: g.uniqueLessons,
            teacher: t?.lessonCount ?? 0,
          };
        });
        return {
          header: formatBilingualCellLabel(b.header, mode),
          universeDisplay: b.universe.map((u) => ({
            key: u.key,
            display: formatBilingualCellLabel(u.display, mode),
          })),
          grouped,
          coverage: b.coverage,
          hasTeacher: Boolean(teacherFilterKey && listFeatureMentorEffective),
          mentorName: listFeatureMentorEffective,
        };
      });
  }, [listFeatureDetailBundles, showEnglishExcelLabels, teacherFilterKey, listFeatureMentorEffective]);

  const meanByMonthData = useMemo(() => {
    if (metricPickIndex == null) return [];
    return meanNumericByMonth(filteredRowsOnePerLesson, metricPickIndex);
  }, [filteredRowsOnePerLesson, metricPickIndex]);

  const meanByMonthChartRows = useMemo(
    () => meanByMonthData.map((r) => ({ ...r, monthLabel: formatMonthRu(r.month) })),
    [meanByMonthData],
  );

  const multiMetricMonthRows = useMemo(() => {
    if (metricNumericCols.length === 0) return [];
    const raw = meanNumericByMonthAllMetrics(filteredRowsOnePerLesson, metricNumericCols);
    return raw.map((row) => {
      const rec: Record<string, string | number | null> = {
        month: row.month,
        monthLabel: formatMonthRu(row.month),
      };
      for (const mi of metricNumericCols) {
        rec[`m${mi}`] = row.means[mi] ?? null;
      }
      return rec;
    });
  }, [filteredRowsOnePerLesson, metricNumericCols]);

  const ordinalTrendByMonthRows = useMemo(() => {
    if (roles.indexOf('metric_ordinal_text') < 0) return [];
    return meanOrdinalRankByMonth(filteredRowsOnePerLesson).map((r) => ({
      ...r,
      monthLabel: formatMonthRu(r.month),
    }));
  }, [filteredRowsOnePerLesson, roles]);

  const mentorColRanges = useMemo(() => {
    if (!mentorChartData.length || !metricNumericCols.length) return [];
    return metricNumericCols.map((mi) => {
      const vals = mentorChartData
        .map((row) => row[`m${mi}`])
        .filter((v): v is number => v != null && Number.isFinite(Number(v)))
        .map(Number);
      const min = vals.length ? Math.min(...vals) : 0;
      const max = vals.length ? Math.max(...vals) : 1;
      return { mi, min, max: max <= min ? min + 1e-6 : max };
    });
  }, [mentorChartData, metricNumericCols]);

  const quickText = useMemo(() => {
    if (!analyticRows.length) return '';
    const di = roles.indexOf('date');
    return buildQuickSummaryRu(analyticRows, filteredRows, {
      hasTeacherFilter: roles.includes('filter_teacher_code'),
      mentorFilterKey: teacherFilterKey,
      dateLabel: di >= 0 ? headers[di] : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
    });
  }, [analyticRows, filteredRows, roles, headers, numericMetricsForSummary, teacherFilterKey]);

  /** Развёрнутая фактическая база для ИИ (срезы, шкала, шифры, больше цитат) — как вход для «комплексного отчёта». */
  const richLlmContext = useMemo(() => {
    if (!analyticRows.length) return '';
    const di = roles.indexOf('date');
    return buildRichLlmContextRu(analyticRows, filteredRows, {
      dateLabel: di >= 0 ? headers[di] : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
      ordinalLevels,
      teacherFilterKey,
      filterKeys,
      filterLabels: filterKeyDisplayLabel,
    });
  }, [
    analyticRows,
    filteredRows,
    roles,
    headers,
    numericMetricsForSummary,
    ordinalLevels,
    teacherFilterKey,
    filterKeys,
    filterKeyDisplayLabel,
  ]);

  /** Варианты по каждому фильтру с учётом уже выбранных остальных (каскад / логическая цепочка). */
  const pulseFacetOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const k of filterKeys) {
      const base = applyFiltersExceptKey(analyticRows, filterSelection, k);
      m[k] = uniqueFilterValues(base, k).slice(0, 72);
    }
    return m;
  }, [filterKeys, analyticRows, filterSelection]);

  const pulseFacetLabels = useMemo(() => {
    const m: Record<string, string> = {};
    roles.forEach((r, i) => {
      if (!isFilterRole(r)) return;
      const k = filterKeyForRole(r, customLabels);
      m[k] = headers[i] || k;
    });
    if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
      m[PULSE_PARALLEL_AUTO_KEY] = 'Параллель (из класса)';
    }
    return m;
  }, [roles, customLabels, headers]);

  const workbookCodebookRu = useMemo(() => {
    if (!buffer || !sheet) return '';
    try {
      return extractWorkbookCodebookRu(buffer, sheet);
    } catch {
      return '';
    }
  }, [buffer, sheet]);

  const pulseExtraContext = useMemo(() => {
    if (!teacherFilterKey || metricNumericCols.length === 0) return '';
    const rows = meanByTeacherGrouped(filteredRows, teacherFilterKey, metricNumericCols);
    const maxLines = 220;
    const lines = rows.slice(0, maxLines).map((row) => {
      const mentor = String(row.mentor ?? '');
      const parts = metricNumericCols.map((mi) => {
        const v = row[`m${mi}`];
        return `${headers[mi] ?? String(mi)}: ${v != null ? Number(v).toFixed(2) : '—'}`;
      });
      return `${mentor}: ${parts.join('; ')}`;
    });
    const tail =
      rows.length > maxLines
        ? `\n… Показаны ${maxLines} из ${rows.length} педагогов; остальные средние — на графике «По наставникам».`
        : '';
    return `Средние по наставникам (текущая выборка после фильтров):\n${lines.join('\n')}${tail}`;
  }, [teacherFilterKey, metricNumericCols, filteredRows, headers]);

  /** Справочник шифр→ФИО с других листов + средние по наставникам — уходит в ИИ первым блоком в extraContext. */
  const pulseLlmExtraBundle = useMemo(() => {
    const parts = [workbookCodebookRu.trim(), pulseExtraContext.trim()].filter(Boolean);
    return parts.join('\n\n');
  }, [workbookCodebookRu, pulseExtraContext]);

  const applyPulseFilters = useCallback(
    (update: (prev: FilterSelection) => FilterSelection) => {
      setFilterSelection((prev) => {
        const draft = update(prev);
        return pruneFilterSelection(analyticRows, draft, filterKeys);
      });
    },
    [analyticRows, filterKeys],
  );

  const openExcelFactsAndScroll = useCallback(() => {
    setExcelFactsOpen(true);
    requestAnimationFrame(() => {
      document.getElementById('excel-drill-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const drillSelectTeacher = useCallback(
    (name: string) => {
      if (!teacherFilterKey) return;
      setExcelFactsOpen(true);
      applyPulseFilters((prev) => ({ ...prev, [teacherFilterKey]: [name] }));
      requestAnimationFrame(() => {
        document.getElementById('excel-drill-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [teacherFilterKey, applyPulseFilters],
  );

  const onHistogramBinClick = useCallback((colIdx: number, header: string, bins: HistogramBinDetail[], pt: HistogramBinDetail) => {
    const histMin = Math.min(...bins.map((x) => x.minInclusive));
    const histMax = Math.max(...bins.map((x) => x.maxInclusive));
    setMetricDrill({
      colIndex: colIdx,
      header,
      bin: pt,
      bins: METRIC_HIST_BINS,
      histMin,
      histMax,
    });
  }, []);

  /**
   * Подчищаем срез только при смене данных или набора ключей фильтров.
   * Не зависим от filterSelection — иначе возможны лишние проходы и конфликт с кликами по чипам.
   * Локальные обновления чипов и ПУЛЬС дополнительно прогоняют prune сами.
   */
  useEffect(() => {
    if (!analyticRows.length || !filterKeys.length) return;
    setFilterSelection((prev) => {
      const next = pruneFilterSelection(analyticRows, prev, filterKeys);
      return filterSelectionsEqual(prev, next, filterKeys) ? prev : next;
    });
  }, [analyticRows, filterKeysSig]);

  /** Пустой срез — убираем ИИ-разметку (при новом «Построить» сброс делается в runAnalysis). */
  useEffect(() => {
    if (analyticRows.length) return;
    setAiSectionLayout(null);
    setAiSectionsHint(null);
    setFacetGroupsByKey({});
    setFacetGroupsHint(null);
  }, [analyticRows.length]);

  useEffect(() => {
    setMetricDrill(null);
  }, [metricPickIndex]);

  /** Смена среза — сбрасываем записи для директора (нужно сформировать заново). */
  useEffect(() => {
    setDirectorDossier(null);
    setDirectorDossierHint(null);
    setDirectorDossierMeta(null);
  }, [analyticRows, filterSelection]);

  const runAiFilterSectionsFor = useCallback(
    async (rows: AnalyticRow[], rolesArg: ColumnRole[], sel: FilterSelection, keys: string[]) => {
      if (!rows.length || !keys.length) return;
      setAiSectionsBusy(true);
      setAiSectionsHint(null);
      try {
        const columns = rolesArg
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => isFilterRole(r))
          .map(({ r, i }) => {
            const fk = filterKeyForRole(r, customLabels);
            const base = applyFiltersExceptKey(rows, sel, fk);
            return {
              filterKey: fk,
              role: r,
              roleLabel: COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r,
              header: headers[i] || fk,
              samples: uniqueFilterValues(base, fk).slice(0, 14),
            };
          });
        const res = await postExcelFilterSections({ filterKeys: keys, columns });
        if (res.source === 'llm' && res.sections?.length) {
          setAiSectionLayout(res.sections);
          setAiSectionsHint(null);
        } else {
          setAiSectionsHint(
            res.hint?.trim() ||
              'Модель не вернула разделы. Проверьте ключи LLM на Cloud Function (см. BACKEND_AND_API.md).',
          );
        }
      } catch (e) {
        setAiSectionsHint(e instanceof Error ? e.message : 'Не удалось запросить ИИ');
      } finally {
        setAiSectionsBusy(false);
      }
    },
    [customLabels, headers],
  );

  const runAiValueGroupsFor = useCallback(
    async (rows: AnalyticRow[], sel: FilterSelection, keys: string[], labels: Record<string, string>) => {
      if (!rows.length || !keys.length) return;
      setFacetGroupsBusy(true);
      setFacetGroupsHint(null);
      const acc: Record<string, ExcelFilterValueGroup[]> = {};
      const hints: string[] = [];
      try {
        let anyLong = false;
        for (const key of keys) {
          const all = uniqueFilterValues(applyFiltersExceptKey(rows, sel, key), key);
          if (all.length < 18) continue;
          anyLong = true;
          const res = await postExcelFilterValueGroups({
            filterKey: key,
            header: labels[key] ?? key,
            values: all,
          });
          if (res.source === 'llm' && res.groups?.length) {
            acc[key] = res.groups;
          } else if (res.hint) {
            hints.push(`${labels[key] ?? key}: ${res.hint}`);
          }
        }
        setFacetGroupsByKey(acc);
        if (!anyLong) {
          setFacetGroupsHint(
            'При текущем срезе нет столбцов с 18+ вариантами — расширьте фильтры или загрузите другой фрагмент.',
          );
        } else if (hints.length) {
          setFacetGroupsHint(hints.slice(0, 4).join(' · '));
        } else if (Object.keys(acc).length === 0) {
          setFacetGroupsHint('ИИ не вернул группы ни для одного столбца.');
        } else {
          setFacetGroupsHint(null);
        }
      } catch (e) {
        setFacetGroupsByKey({});
        setFacetGroupsHint(e instanceof Error ? e.message : 'Ошибка запроса');
      } finally {
        setFacetGroupsBusy(false);
      }
    },
    [],
  );

  const fetchAiFilterSections = useCallback(() => {
    void runAiFilterSectionsFor(analyticRows, roles, filterSelection, filterKeys);
  }, [runAiFilterSectionsFor, analyticRows, roles, filterSelection, filterKeys]);

  const fetchAiValueGroups = useCallback(() => {
    void runAiValueGroupsFor(analyticRows, filterSelection, filterKeys, filterKeyDisplayLabel);
  }, [runAiValueGroupsFor, analyticRows, filterSelection, filterKeys, filterKeyDisplayLabel]);

  const runAnalysis = useCallback(() => {
    const v = validateRoles(roles);
    if (!v.ok) {
      setErr(v.message ?? 'Проверьте маппинг');
      return;
    }
    const ordCol = roles.indexOf('metric_ordinal_text');
    if (ordCol >= 0 && ordinalLevels.length === 0) {
      setErr('Для текстовой шкалы задайте порядок уровней (или нажмите «Подставить из данных»).');
      return;
    }

    const { roles: rolesForRun, strippedIndex } = applyServiceTimestampIgnore(headers, rawRows, roles);
    const vRun = validateRoles(rolesForRun);
    if (!vRun.ok) {
      setErr(
        vRun.message
          ? `После автоотсечения служебной колонки: ${vRun.message}`
          : 'Проверьте маппинг после автоотсечения служебной колонки.',
      );
      return;
    }

    setErr(null);
    setAiSectionLayout(null);
    setAiSectionsHint(null);
    setFacetGroupsByKey({});
    setFacetGroupsHint(null);
    setMetricDrill(null);
    setExcelFactsOpen(false);

    if (strippedIndex != null) {
      setServiceStripNote(
        `Столбец «${headers[strippedIndex] || strippedIndex + 1}» распознан как служебная метка времени (например, момент голосования) и исключён из анализа. Роли колонок обновлены.`,
      );
    } else {
      setServiceStripNote(null);
    }

    if (rolesForRun.some((r, i) => r !== roles[i])) {
      setRoles(rolesForRun);
    }

    let built = buildAnalyticRows(headers, rawRows, rolesForRun, customLabels, ordinalLevels);
    built = expandRowsForMultiValueFilterColumns(built, rolesForRun, customLabels);
    built = augmentRowsWithDerivedParallel(built, rolesForRun, customLabels);
    setAnalyticRows(built);

    const sel: FilterSelection = {};
    const keys = new Set<string>();
    rolesForRun.forEach((r) => {
      if (isFilterRole(r)) keys.add(filterKeyForRole(r, customLabels));
    });
    if (rolesForRun.includes('filter_class') && !rolesForRun.includes('filter_parallel')) {
      keys.add(PULSE_PARALLEL_AUTO_KEY);
    }
    keys.forEach((k) => {
      sel[k] = null;
    });
    setFilterSelection(sel);

    const firstMetric =
      rolesForRun.map((r, i) => (r === 'metric_numeric' ? i : -1)).find((i) => i >= 0) ?? null;
    setMetricPickIndex(firstMetric);

    const keysArr = [...keys];
    const labelsM = buildFilterKeyLabels(rolesForRun, headers, customLabels);
    void (async () => {
      await runAiFilterSectionsFor(built, rolesForRun, sel, keysArr);
      await runAiValueGroupsFor(built, sel, keysArr, labelsM);
    })();
  }, [
    roles,
    ordinalLevels,
    headers,
    rawRows,
    customLabels,
    runAiFilterSectionsFor,
    runAiValueGroupsFor,
  ]);

  const fetchDirectorDossier = useCallback(async () => {
    if (!teacherFilterKey) {
      setDirectorDossierHint('Назначьте колонке роль «Код/шифр педагога», чтобы строить записки по педагогам.');
      return;
    }
    if (!filteredRows.length) return;
    const ti = roles.indexOf('filter_teacher_code');
    const si = roles.indexOf('filter_subject');
    const di = roles.indexOf('date');
    const subjectKey = si >= 0 ? filterKeyForRole('filter_subject', customLabels) : null;
    const { packets, truncated, totalGroups } = buildDirectorFactPackets(filteredRows, {
      teacherKey: teacherFilterKey,
      subjectKey,
      teacherHeader: ti >= 0 ? headers[ti] ?? 'Педагог' : 'Педагог',
      subjectHeader: si >= 0 ? headers[si] ?? 'Предмет' : '',
      dateLabel: di >= 0 ? headers[di] ?? '' : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
      ordinalLevels,
    });
    if (packets.length === 0) {
      setDirectorDossier(null);
      setDirectorDossierMeta(null);
      setDirectorDossierHint('В текущем срезе нет строк с заполненным педагогом.');
      return;
    }
    setDirectorDossierBusy(true);
    setDirectorDossierMeta({ truncated, totalGroups });
    const narrativeById = new Map<string, string>();
    let lastFallback: string | null = null;
    const totalChunks = Math.ceil(packets.length / DIRECTOR_DOSSIER_CHUNK);
    try {
      for (let i = 0; i < packets.length; i += DIRECTOR_DOSSIER_CHUNK) {
        const chunk = packets.slice(i, i + DIRECTOR_DOSSIER_CHUNK);
        if (totalChunks > 1) {
          setDirectorDossierHint(`Запрос к модели… фрагмент ${Math.floor(i / DIRECTOR_DOSSIER_CHUNK) + 1} из ${totalChunks}`);
        } else {
          setDirectorDossierHint('Запрос к модели…');
        }
        const res = await postExcelDirectorDossier({
          sharedCodebook: workbookCodebookRu.trim().slice(0, 4500) || undefined,
          packets: chunk.map((p) => ({
            segmentId: p.segmentId,
            teacher: p.teacher,
            subject: p.subject,
            factsSummary: p.factsSummary,
          })),
        });
        if (res.source === 'llm' && res.items?.length) {
          for (const it of res.items) {
            if (it.narrative?.trim()) narrativeById.set(it.segmentId, it.narrative.trim());
          }
        } else if (res.hint) {
          lastFallback = res.hint;
        }
      }
      const rows = packets.map((p) => ({
        segmentId: p.segmentId,
        teacher: p.teacher,
        subject: p.subject,
        narrative: narrativeById.get(p.segmentId) ?? null,
      }));
      setDirectorDossier(rows);
      const missing = rows.filter((r) => !r.narrative).length;
      if (narrativeById.size === 0) {
        setDirectorDossierHint(lastFallback || 'Модель не вернула тексты. Проверьте ключи LLM на функции.');
      } else if (truncated) {
        setDirectorDossierHint(
          `Сформировано ${rows.length} из ${totalGroups} сегментов (лимит на странице). Сузьте фильтры, чтобы охватить остальных.` +
            (missing ? ` Не получен текст: ${missing} сегм.` : ''),
        );
      } else if (missing) {
        setDirectorDossierHint(`Часть сегментов без ответа (${missing}). Повторите запрос или сократите выборку.`);
      } else {
        setDirectorDossierHint(null);
      }
    } catch (e) {
      setDirectorDossier(null);
      setDirectorDossierMeta(null);
      setDirectorDossierHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setDirectorDossierBusy(false);
    }
  }, [
    teacherFilterKey,
    filteredRows,
    roles,
    customLabels,
    headers,
    numericMetricsForSummary,
    ordinalLevels,
    workbookCodebookRu,
  ]);

  const renderFilterChipsForKey = useCallback(
    (key: string, all: string[]) => {
      const sel = filterSelection[key];
      const groups = facetGroupsByKey[key];
      if (all.length === 0) {
        return (
          <p className="muted excel-analytics-filter-empty">Нет вариантов при текущем срезе по другим фильтрам.</p>
        );
      }
      const chip = (val: string) => {
        const checked = Array.isArray(sel) && sel.includes(val);
        return (
          <label key={val} className="excel-analytics-chip">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                setFilterSelection((prev) => {
                  const cur = prev[key];
                  let nextVal: string[] | null;
                  if (cur == null) {
                    nextVal = [val];
                  } else {
                    const set = new Set(cur);
                    if (set.has(val)) set.delete(val);
                    else set.add(val);
                    const arr = [...set];
                    if (arr.length === 0) nextVal = null;
                    else if (arr.length === all.length) nextVal = null;
                    else nextVal = arr;
                  }
                  const updated = { ...prev, [key]: nextVal };
                  return pruneFilterSelection(analyticRows, updated, filterKeys);
                });
              }}
            />
            <span>{val}</span>
          </label>
        );
      };
      if (groups?.length) {
        return (
          <div className="excel-filter-value-groups">
            {groups.map((g) => (
              <details key={g.id} className="excel-filter-value-group" open>
                <summary className="excel-filter-value-group-summary">
                  {g.label} <span className="muted">({g.values.length})</span>
                </summary>
                <div className="excel-analytics-filter-chips excel-analytics-filter-chips--nested">{g.values.map(chip)}</div>
              </details>
            ))}
          </div>
        );
      }
      return <div className="excel-analytics-filter-chips">{all.map(chip)}</div>;
    },
    [filterSelection, facetGroupsByKey, analyticRows, filterKeys],
  );

  useEffect(() => {
    setDeepNarrative(null);
    setDeepHint(null);
    setDeepWords(null);
  }, [richLlmContext]);

  useEffect(() => {
    if (!richLlmContext.trim()) {
      setSummaryNarrative(null);
      setSummaryNarrativeLoading(false);
      setSummaryNarrativeWords(null);
      setSummaryNarrativeApiHint(null);
      return;
    }
    let cancelled = false;
    setSummaryNarrative(null);
    setSummaryNarrativeWords(null);
    setSummaryNarrativeApiHint(null);
    setSummaryNarrativeLoading(true);
    void postExcelNarrativeSummary({
      context: {
        numericSummary: richLlmContext.slice(0, 22000),
        extraContext: pulseLlmExtraBundle.trim() || undefined,
        facetLabels: pulseFacetLabels,
        filterSummary: filterParameterSummaryRu.trim() || undefined,
        meta: { filteredRowCount: filteredRows.length, uniqueLessonCount: kpiLessons },
      },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.source === 'llm' && res.narrative?.trim()) {
          setSummaryNarrative(res.narrative.trim());
          setSummaryNarrativeWords(typeof res.wordCount === 'number' ? res.wordCount : null);
          setSummaryNarrativeApiHint(null);
        } else {
          setSummaryNarrative(null);
          setSummaryNarrativeWords(null);
          setSummaryNarrativeApiHint(res.hint?.trim() || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummaryNarrative(null);
          setSummaryNarrativeWords(null);
          setSummaryNarrativeApiHint(
            'Запрос к API не выполнен (сеть, API Gateway, таймаут или HTTP-ошибка). Если ключи LLM уже заданы на функции — проверьте шлюз и логи; иначе см. BACKEND_AND_API.md (OpenRouter: OPENAI_API_KEY + OPENAI_BASE_URL).',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSummaryNarrativeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [richLlmContext, pulseLlmExtraBundle, pulseFacetLabels, filteredRows.length, filterParameterSummaryRu, kpiLessons]);

  const fetchDeepDashboardAnalysis = useCallback(async () => {
    if (!richLlmContext.trim()) return;
    setDeepLoading(true);
    setDeepHint(null);
    setDeepWords(null);
    try {
      const res = await postExcelNarrativeSummary({
        context: {
          analysisMode: 'deep',
          numericSummary: richLlmContext.slice(0, 24000),
          extraContext: pulseLlmExtraBundle.trim() || undefined,
          facetLabels: pulseFacetLabels,
          filterSummary: filterParameterSummaryRu.trim() || undefined,
          userFocus: deepUserFocus.trim() || undefined,
          meta: { filteredRowCount: filteredRows.length, uniqueLessonCount: kpiLessons },
        },
      });
      if (res.source === 'llm' && res.narrative?.trim()) {
        setDeepNarrative(res.narrative.trim());
        setDeepWords(typeof res.wordCount === 'number' ? res.wordCount : null);
        setDeepHint(null);
      } else {
        setDeepNarrative(null);
        setDeepWords(null);
        setDeepHint(res.hint?.trim() || 'Не удалось получить отчёт.');
      }
    } catch {
      setDeepNarrative(null);
      setDeepWords(null);
      setDeepHint('Ошибка запроса к API.');
    } finally {
      setDeepLoading(false);
    }
  }, [
    richLlmContext,
    pulseLlmExtraBundle,
    pulseFacetLabels,
    filterParameterSummaryRu,
    deepUserFocus,
    filteredRows.length,
    kpiLessons,
  ]);

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      setErr('Введите имя шаблона');
      return;
    }
    if (!headers.length) return;
    const headerMap: Record<string, ColumnRole> = {};
    headers.forEach((h, i) => {
      headerMap[normalizeHeader(h)] = roles[i] ?? 'ignore';
    });
    const t: SavedMappingTemplate = {
      id: newTemplateId(),
      name,
      headerMap,
      customLabels: { ...customLabels },
      createdAt: new Date().toISOString(),
    };
    const next = [...templates, t];
    setTemplates(next);
    saveTemplates(next);
    setTemplateName('');
  };

  const applyTemplate = (t: SavedMappingTemplate) => {
    if (!headers.length) return;
    const nextRoles = headers.map((h) => t.headerMap[normalizeHeader(h)] ?? 'ignore');
    setRoles(nextRoles);
    setCustomLabels({ ...t.customLabels });
    const ordCol = nextRoles.indexOf('metric_ordinal_text');
    if (ordCol >= 0) setOrdinalLevels(collectOrdinalValues(rawRows, ordCol));
  };

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page excel-analytics-page" {...fadeIn}>
        <motion.header
          className="card excel-analytics-hero glass-surface"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="admin-dash-kicker">Модуль аналитики · Excel</p>
          <h1 className="admin-dash-title">Наблюдения из таблицы</h1>
          <p className="muted admin-dash-lead">
            Загрузите таблицу, укажите лист и строку заголовков, сопоставьте колонки с ролями. Если в той же книге на
            другом листе есть расшифровка шифра в ФИО (столбцы вроде «ШИФР» и «ФИО»), она автоматически подмешивается в
            контекст для ИИ. Данные обрабатываются в браузере; шаблоны маппинга хранятся локально на этом устройстве.
          </p>
        </motion.header>

        <section className="card import-workbook-drop glass-surface excel-analytics-section">
          <h2 className="admin-dash-h2">1. Файл</h2>
          <label className="btn primary import-workbook-file-btn">
            Выбрать .xlsx
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(ev) => void onFile(ev)}
            />
          </label>
          {fileName && <p className="muted excel-analytics-filename">{fileName}</p>}
          {fileName && (
            <label className="excel-analytics-check excel-analytics-file-lang-check">
              <input
                type="checkbox"
                checked={showEnglishExcelLabels}
                onChange={(e) => setShowEnglishExcelLabels(e.target.checked)}
              />
              Показывать английские подписи из таблицы (часть после «//»)
            </label>
          )}
        </section>

        {buffer && (
          <section className="card glass-surface excel-analytics-section">
            <h2 className="admin-dash-h2">2. Лист и строка заголовков</h2>
            <div className="excel-analytics-row">
              <label className="excel-analytics-field">
                Лист
                <select className="excel-analytics-select" value={sheet} onChange={(e) => setSheet(e.target.value)}>
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="excel-analytics-field">
                Строка заголовков (1 = первая)
                <input
                  type="number"
                  min={1}
                  className="excel-analytics-input"
                  value={headerRow1Based}
                  onChange={(e) => setHeaderRow1Based(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <button type="button" className="btn primary" onClick={onApplySheet}>
                Загрузить лист
              </button>
            </div>
          </section>
        )}

        {headers.length > 0 && (
          <section className="card glass-surface excel-analytics-section">
            <h2 className="admin-dash-h2">3. Как столбец участвует в дашборде</h2>
            <p className="excel-analytics-lead">
              Это <strong>не «выбросить данные»</strong>, а только тип поля для графиков, фильтров и ИИ: число — в средние и
              диаграммы, длинный текст — в выводы, класс/предмет — в срезы. Все столбцы наблюдений после кнопки ниже по
              возможности подключаются сами (включая несколько критериев-оценок и несколько текстовых полей). Колонку{' '}
              <strong>«Формат»</strong> (очно / онлайн) система ищет по заголовку и по значениям; «Дата посещения» не
              путается с «Форматом проведения». Проверьте список и при необходимости смените роль в строке.
            </p>
            <div className="excel-analytics-auto-row">
              <button
                type="button"
                className="btn primary excel-analytics-auto-btn"
                onClick={() => {
                  applySuggestedRoles(headers, rawRows);
                  setErr(null);
                }}
              >
                Подключить все столбцы автоматически
              </button>
              <label className="excel-analytics-check">
                <input
                  type="checkbox"
                  checked={autoMapOnLoad}
                  onChange={(e) => setAutoMapOnLoad(e.target.checked)}
                />
                Подбирать роли при каждой загрузке листа
              </label>
            </div>
            {roleSummaryLines.length > 0 && (
              <div className="excel-analytics-role-summary">
                <div className="excel-analytics-role-summary-title">Сейчас выбрано (проверьте)</div>
                <ul className="excel-analytics-role-summary-list">
                  {roleSummaryLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="muted">
              Несколько столбцов с ролью «числовой пункт» — отдельные критерии (чем больше набрано, тем лучше): все
              попадут в таблицу, графики и текстовую сводку. Подробные названия ролей — в выпадающем списке в таблице
              ниже.
            </p>
            <p className="muted">
              Колонка <strong>«Код/шифр педагога»</strong> (наставники): если в одной ячейке несколько ФИО через запятую,
              строка урока автоматически разворачивается — у каждого наставника будут свои точки на графиках и строки в
              таблице (оценки урока те же, что в Excel).
            </p>
            <p className="muted">
              Подписи доп. фильтров 1–3 (как в отчёте):{' '}
              <input
                className="excel-analytics-input excel-analytics-inline"
                placeholder="Фильтр 1"
                value={customLabels.filter_custom_1 ?? ''}
                onChange={(e) => setCustomLabels((s) => ({ ...s, filter_custom_1: e.target.value }))}
              />{' '}
              <input
                className="excel-analytics-input excel-analytics-inline"
                placeholder="Фильтр 2"
                value={customLabels.filter_custom_2 ?? ''}
                onChange={(e) => setCustomLabels((s) => ({ ...s, filter_custom_2: e.target.value }))}
              />{' '}
              <input
                className="excel-analytics-input excel-analytics-inline"
                placeholder="Фильтр 3"
                value={customLabels.filter_custom_3 ?? ''}
                onChange={(e) => setCustomLabels((s) => ({ ...s, filter_custom_3: e.target.value }))}
              />
            </p>

            <div className="excel-analytics-templates">
              <span className="muted">Шаблоны:</span>
              <select
                className="excel-analytics-select"
                defaultValue=""
                onChange={(e) => {
                  const id = e.target.value;
                  const t = templates.find((x) => x.id === id);
                  if (t) applyTemplate(t);
                  e.target.value = '';
                }}
              >
                <option value="">Применить сохранённый…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                className="excel-analytics-input"
                placeholder="Имя нового шаблона"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <button type="button" className="btn primary" onClick={saveTemplate}>
                Сохранить шаблон
              </button>
            </div>

            <div className="excel-analytics-table-wrap">
              <table className="excel-analytics-table">
                <thead>
                  <tr>
                    <th>Колонка</th>
                    <th>Роль</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={`${i}-${h}`}>
                      <td>{h || `(${i + 1})`}</td>
                      <td>
                        <select
                          className="excel-analytics-select excel-analytics-select-wide"
                          value={roles[i] ?? 'ignore'}
                          onChange={(e) => setRoleAt(i, e.target.value as ColumnRole)}
                        >
                          {COLUMN_ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.group}: {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {roles.includes('metric_ordinal_text') && (
              <div className="excel-analytics-ordinal">
                <p className="muted">Порядок уровней текстовой шкалы (сверху к низу — от худшего к лучшему, или наоборот):</p>
                <textarea
                  className="excel-analytics-textarea"
                  rows={6}
                  value={ordinalLevels.join('\n')}
                  onChange={(e) => setOrdinalLevels(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const ordCol = roles.indexOf('metric_ordinal_text');
                    if (ordCol >= 0) setOrdinalLevels(collectOrdinalValues(rawRows, ordCol));
                  }}
                >
                  Подставить уникальные из данных
                </button>
              </div>
            )}

            {datePreview.length > 0 && (
              <p className="muted excel-analytics-preview">
                Пример дат (первые распознанные): {datePreview.join(', ')}
              </p>
            )}

            <button type="button" className="btn primary excel-analytics-run" onClick={runAnalysis}>
              Построить анализ
            </button>
          </section>
        )}

        {err && <p className="err import-workbook-err">{err}</p>}

        {serviceStripNote && (
          <p className="muted excel-service-strip-note" role="status">
            {serviceStripNote}
          </p>
        )}

        {analyticRows.length > 0 && (
          <div className="excel-dashboard excel-dashboard--stacked">
            <div className="card glass-surface excel-dashboard-slice-strip" aria-label="Срез по всем параметрам наблюдения">
              <div className="excel-dashboard-slice-top">
                <div className="excel-dashboard-slice-intro">
                  <p className="excel-dashboard-slice-kicker">Срез выборки</p>
                  <h2 className="excel-dashboard-slice-title">Все параметры из маппинга</h2>
                  <p className="muted excel-dashboard-slice-lead">
                    Каждая колонка-фильтр — измерение; каскад оставляет только совместимые значения. Сначала настройте
                    срез, затем смотрите графики и ПУЛЬС ниже.
                  </p>
                </div>
                <div className="excel-dashboard-slice-toolbar">
                  <div className="excel-dashboard-kpis excel-dashboard-kpis--slice">
                    <div className="excel-dashboard-kpi">
                      <span className="excel-dashboard-kpi-value">{filteredRows.length}</span>
                      <span className="excel-dashboard-kpi-label">точек</span>
                    </div>
                    <div className="excel-dashboard-kpi">
                      <span className="excel-dashboard-kpi-value">{kpiLessons}</span>
                      <span className="excel-dashboard-kpi-label">уроков</span>
                    </div>
                    {teacherFilterKey != null && (
                      <div className="excel-dashboard-kpi">
                        <span className="excel-dashboard-kpi-value">{kpiMentors}</span>
                        <span className="excel-dashboard-kpi-label">наставников</span>
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn primary excel-dashboard-reset" onClick={resetAllFilters}>
                    Сбросить все фильтры
                  </button>
                  <label className="excel-analytics-check excel-dashboard-lang-toggle">
                    <input
                      type="checkbox"
                      checked={showEnglishExcelLabels}
                      onChange={(e) => setShowEnglishExcelLabels(e.target.checked)}
                    />
                    Подписи после «//» (EN)
                  </label>
                </div>
              </div>

              <div className="excel-dashboard-slice-ai">
                <p className="muted excel-dashboard-slice-ai-lead">
                  После «Построить анализ» разделы среза и группы в длинных списках запрашиваются у модели автоматически
                  (тот же API, что у ПУЛЬС). Кнопки ниже — повторить запрос при смене данных или если ответ не пришёл.
                </p>
                <div className="excel-dashboard-filter-ai-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={!analyticRows.length || aiSectionsBusy}
                    onClick={() => void fetchAiFilterSections()}
                  >
                    {aiSectionsBusy ? 'ИИ: разделы…' : 'Обновить разделы (ИИ)'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!analyticRows.length || facetGroupsBusy}
                    onClick={() => void fetchAiValueGroups()}
                  >
                    {facetGroupsBusy ? 'ИИ: группы…' : 'Обновить группы в списках (ИИ)'}
                  </button>
                  {(aiSectionLayout != null || Object.keys(facetGroupsByKey).length > 0) && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setAiSectionLayout(null);
                        setFacetGroupsByKey({});
                        setAiSectionsHint(null);
                        setFacetGroupsHint(null);
                      }}
                    >
                      Сбросить ИИ
                    </button>
                  )}
                </div>
                {(aiSectionsHint || facetGroupsHint) && (
                  <p className="muted excel-dashboard-filter-ai-hint-msg">{aiSectionsHint || facetGroupsHint}</p>
                )}
              </div>

              <p className="muted excel-dashboard-filter-hint excel-dashboard-slice-hint">
                Снятые галочки по измерению значат «не сужать по этому полю». Отметьте нужные значения — срез сузится.
                Несколько значений в ячейке фильтра через запятую дают отдельные варианты. Колонка «Список через запятую»
                (пойнты) в фильтры не попадает — она в графиках и ИИ. Есть только «Класс» без «Параллель» — появится
                измерение «Параллель (из класса)» для среза по 7А/7B/7… → параллель 7 и сравнения наставников.
              </p>

              <div className="excel-dashboard-slice-sections">
                {filterSections.length === 0 ? (
                  <p className="muted excel-dashboard-slice-empty">
                    В маппинге нет колонок с ролью фильтра — срез по измерениям не строится. Назначьте хотя бы одну
                    колонку ролью «Параллель», «Класс», «Предмет», «Формат» или доп. фильтр.
                  </p>
                ) : (
                  filterSections.map((section) => (
                    <section key={section.id} className="excel-slice-section">
                      <h3 className="excel-slice-section-title">{section.title}</h3>
                      <div className="excel-dashboard-slice-filters-grid excel-dashboard-slice-filters-grid--wide">
                        {section.keys.map((key) => {
                          const all = uniqueFilterValues(applyFiltersExceptKey(analyticRows, filterSelection, key), key);
                          return (
                            <div key={key} className="excel-slice-dimension card glass-surface">
                              <div className="excel-slice-dimension-head">
                                <span className="excel-slice-dimension-label">{filterKeyDisplayLabelUi[key] ?? key}</span>
                              </div>
                              <div className="excel-slice-dimension-body">
                                {renderFilterChipsForKey(key, all)}
                                <div className="excel-analytics-filter-actions">
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() =>
                                      setFilterSelection((p) =>
                                        pruneFilterSelection(analyticRows, { ...p, [key]: null }, filterKeys),
                                      )
                                    }
                                  >
                                    Сбросить измерение
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>

            <div className="excel-dashboard-main">
                <header className="excel-dashboard-main-head card glass-surface">
                  <div className="excel-dashboard-main-head-text">
                    <p className="excel-dashboard-main-kicker">Панель анализа</p>
                    <h2 className="excel-dashboard-main-title">Графики, выводы и детализация</h2>
                    <p className="muted excel-dashboard-main-lead">
                      Ниже — графики по текущему срезу, краткая сводка, затем ПУЛЬС: чат и отчёты ИИ в одном блоке. Фильтры
                      остаются вверху страницы.
                    </p>
                  </div>
                </header>

                <div className="excel-dashboard-main-charts">
                  <section className="card glass-surface excel-dash-card excel-dash-card--wide excel-dash-chart-catalog">
                    <h3 className="excel-dash-card-title">Визуализации по текущему срезу</h3>
                    <p className="muted excel-dash-card-sub">
                      Доступно: распределение уроков по значению фильтра; сравнение средних всех числовых пунктов по
                      месяцам; отдельная гистограмма под каждый пункт; динамика числа уроков и среднего по одному пункту;
                      при текстовой шкале — столбчатое распределение и линия среднего ранга по месяцам; при колонке
                      наставника — групповые столбцы и тепловая таблица средних; списки через запятую — справочник и топы.
                    </p>
                  </section>

                  {multiMetricMonthRows.length >= 2 && metricNumericCols.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Средние по всем числовым пунктам по месяцам</h3>
                      <p className="muted excel-dash-card-sub">
                        Одна линия на каждый пункт из маппинга; по оси X — месяц из колонки «Дата». Пропуски, если в месяце
                        не было чисел по пункту.
                      </p>
                      <div className="excel-analytics-chart excel-analytics-chart--tall">
                        <ResponsiveContainer width="100%" height={340}>
                          <LineChart data={multiMetricMonthRows} margin={{ top: 8, right: 28, left: 4, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={48} />
                            <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                            <Tooltip />
                            <Legend wrapperStyle={{ paddingTop: 6 }} />
                            {metricNumericCols.map((mi, i) => (
                              <Line
                                key={mi}
                                type="monotone"
                                dataKey={`m${mi}`}
                                name={metricColLegendLabel(mi, `П.${mi + 1}`)}
                                stroke={DASH_BAR_COLORS[i % DASH_BAR_COLORS.length]}
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {ordinalTrendByMonthRows.length >= 2 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Динамика текстовой шкалы (средний ранг по месяцам)</h3>
                      <p className="muted excel-dash-card-sub">
                        Ранг соответствует порядку уровней, который вы задали при построении анализа (выше на графике —
                        в сторону «лучшего» конца шкалы).
                      </p>
                      <div className="excel-analytics-chart">
                        <ResponsiveContainer width="100%" height={260}>
                          <LineChart data={ordinalTrendByMonthRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} interval={0} angle={-14} textAnchor="end" height={46} />
                            <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                            <Tooltip formatter={(v: number) => [v != null ? Number(v).toFixed(2) : '—', 'Средн. ранг']} />
                            <Line
                              type="monotone"
                              dataKey="meanRank"
                              stroke="#7c3aed"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              name="Средний ранг"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {metricNumericCols.length > 1 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Гистограммы по каждому числовому пункту</h3>
                      <p className="muted excel-dash-card-sub">
                        Распределение значений по уникальным урокам в срезе.
                        {teacherFilterKey
                          ? ' Клик по столбцу — справа список педагогов в этом интервале; по педагогу — срез и сводка ниже.'
                          : ' Назначьте колонке роль «Код/шифр педагога», чтобы по клику видеть список педагогов в интервале.'}
                      </p>
                      <div
                        className={
                          metricDrill && teacherFilterKey
                            ? 'excel-histogram-multi-with-panel'
                            : 'excel-histogram-multi-with-panel excel-histogram-multi-with-panel--solo'
                        }
                      >
                        <div className="excel-histogram-multi-grid">
                          {metricNumericCols.map((mi, idx) => {
                            const histBins = histogramNumericBins(
                              filteredRowsOnePerLesson,
                              mi,
                              METRIC_HIST_BINS,
                            );
                            if (histBins.length === 0) return null;
                            const headerMini = metricColLegendLabel(mi, `Пункт ${mi + 1}`);
                            const baseFill = DASH_BAR_COLORS[idx % DASH_BAR_COLORS.length];
                            return (
                              <div key={mi} className="excel-histogram-mini card glass-surface">
                                <h4 className="excel-histogram-mini-title">{headerMini}</h4>
                                <div className="excel-analytics-chart excel-histogram-mini-chart">
                                  <ResponsiveContainer width="100%" height={200}>
                                    <BarChart data={histBins} margin={{ top: 4, right: 8, left: 0, bottom: 32 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                                      <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 9 }}
                                        interval={0}
                                        angle={-20}
                                        textAnchor="end"
                                        height={48}
                                      />
                                      <YAxis tick={{ fontSize: 10 }} width={32} />
                                      <Tooltip />
                                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                                        {histBins.map((entry, bi) => (
                                          <Cell
                                            key={`b-${mi}-${bi}`}
                                            fill={baseFill}
                                            cursor={teacherFilterKey ? 'pointer' : 'default'}
                                            opacity={
                                              metricDrill?.colIndex === mi && metricDrill?.bin.binIndex === entry.binIndex
                                                ? 1
                                                : 0.45
                                            }
                                            onClick={() => {
                                              if (!teacherFilterKey) return;
                                              onHistogramBinClick(mi, headerMini, histBins, entry);
                                            }}
                                          />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {metricDrill && teacherFilterKey && (
                          <aside className="excel-metric-drill-panel" aria-label="Педагоги в выбранном интервале метрики">
                            <div className="excel-metric-drill-panel-head">
                              <div>
                                <div className="excel-metric-drill-panel-metric">{metricDrill.header}</div>
                                <div className="excel-metric-drill-panel-bin">Интервал: {metricDrill.bin.label}</div>
                              </div>
                              <button
                                type="button"
                                className="btn excel-metric-drill-close"
                                aria-label="Закрыть панель"
                                onClick={() => setMetricDrill(null)}
                              >
                                ×
                              </button>
                            </div>
                            <p className="muted excel-metric-drill-panel-hint">
                              Уроки в выбранном диапазоне по этому пункту. Клик по ФИО — сузить дашборд, краткая сводка
                              появится здесь, блок «Исходные факты» ниже раскроется автоматически.
                            </p>
                            {metricDrillTeachers.length === 0 ? (
                              <p className="muted">В этом интервале нет строк с указанным педагогом.</p>
                            ) : (
                              <ul className="excel-metric-drill-teacher-list">
                                {metricDrillTeachers.map((t) => (
                                  <li key={t.teacher}>
                                    <button
                                      type="button"
                                      className="excel-metric-drill-teacher-btn"
                                      onClick={() => drillSelectTeacher(t.teacher)}
                                    >
                                      <span className="excel-metric-drill-teacher-name">{t.teacher}</span>
                                      <span className="muted">{t.lessons} ур.</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {singleTeacherFilterName && quickText ? (
                              <ExcelDrillMiniSummary
                                teacherName={singleTeacherFilterName}
                                quickText={quickText}
                                onOpenFacts={openExcelFactsAndScroll}
                              />
                            ) : null}
                          </aside>
                        )}
                      </div>
                    </section>
                  )}

                  {filterKeys.length > 0 && filterBarChartDisplay.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Распределение по фильтру (уникальные уроки)</h3>
                      <p className="muted excel-dash-card-sub">
                        По оси — сколько логических уроков в текущем срезе имеют каждое значение среза. Похожие написания
                        объединяются. Выберите измерение:
                      </p>
                      <label className="excel-analytics-field">
                        Фильтр
                        <select
                          className="excel-analytics-select"
                          value={effectiveFilterChartKey ?? ''}
                          onChange={(e) => setUserFilterChartKey(e.target.value || null)}
                        >
                          {filterKeys.map((k) => (
                            <option key={k} value={k}>
                              {filterKeyDisplayLabelUi[k] ?? k}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="excel-analytics-chart">
                        <ResponsiveContainer
                          width="100%"
                          height={Math.min(480, 48 + filterBarChartDisplay.length * 30)}
                        >
                          <BarChart
                            data={filterBarChartDisplay}
                            layout="vertical"
                            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="short" width={200} tick={{ fontSize: 10 }} interval={0} />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0].payload as { fullName: string; uniqueLessons: number };
                                return (
                                  <div
                                    style={{
                                      background: '#fff',
                                      border: '1px solid var(--card-border)',
                                      borderRadius: 8,
                                      padding: '0.5rem 0.75rem',
                                      fontSize: 12,
                                      maxWidth: 320,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.fullName}</div>
                                    <div>Уроков: {p.uniqueLessons}</div>
                                  </div>
                                );
                              }}
                            />
                            <Bar dataKey="uniqueLessons" fill="#115e59" name="Уроков" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {listFeatureChartsPrepared.length > 0 && (
                    <details className="excel-dash-details-list-features">
                      <summary className="excel-dash-details-list-features-summary">
                        Списки через запятую: топ и сравнение «весь срез / педагог» (откройте после настройки фильтров)
                      </summary>
                      <div className="excel-list-features-details-body">
                        {teacherFilterKey && listFeatureMentorOptions.length > 0 && (
                          <div className="excel-list-feature-mentor-pick card glass-surface">
                            <label className="excel-analytics-field excel-list-feature-mentor-pick-label">
                              Педагог для сравнения на графике
                              <select
                                className="excel-analytics-select"
                                value={listFeatureMentorEffective}
                                onChange={(e) => setListFeatureMentorPick(e.target.value)}
                              >
                                {listFeatureMentorOptions.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}

                        <div className="excel-dashboard-chart-row excel-dashboard-chart-row--list-features-wide">
                          {listFeatureChartsPrepared.map((b) => (
                            <section
                              key={b.header}
                              className="card glass-surface excel-dash-card excel-dash-card--wide excel-dash-card--list-features"
                            >
                              <h3 className="excel-dash-card-title">Список через запятую: {b.header}</h3>
                              <p className="muted excel-dash-card-sub excel-dash-card-sub--tight">
                                Уникальные уроки с отметкой по пункту. Два столбца: весь текущий срез и выбранный педагог
                                (если задан код наставника).
                              </p>

                              <details className="excel-list-feature-universe-details">
                                <summary className="excel-list-feature-universe-summary">
                                  Все различные пункты в срезе ({b.universeDisplay.length})
                                </summary>
                                <ul className="excel-list-feature-universe">
                                  {b.universeDisplay.map((u) => (
                                    <li key={u.key}>{u.display}</li>
                                  ))}
                                </ul>
                              </details>

                              {b.grouped.length > 0 && (
                                <div className="excel-list-feature-chart-block">
                                  <h4 className="excel-list-feature-chart-title">
                                    Топ {b.grouped.length}: срез и педагог
                                    {b.coverage && b.hasTeacher && b.coverage.total > 0 && (
                                      <span className="muted excel-list-feature-coverage-hint">
                                        {' '}
                                        · в справочнике у педагога: {b.coverage.collected}/{b.coverage.total}
                                      </span>
                                    )}
                                  </h4>
                                  <div className="excel-analytics-chart">
                                    <ResponsiveContainer
                                      width="100%"
                                      height={Math.min(520, 56 + b.grouped.length * 32)}
                                    >
                                      <BarChart
                                        data={b.grouped}
                                        layout="vertical"
                                        margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
                                      >
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis
                                          type="category"
                                          dataKey="short"
                                          width={220}
                                          tick={{ fontSize: 10 }}
                                          interval={0}
                                        />
                                        <Tooltip
                                          content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const p = payload[0].payload as {
                                              fullName: string;
                                              slice: number;
                                              teacher: number;
                                            };
                                            return (
                                              <div
                                                style={{
                                                  background: '#fff',
                                                  border: '1px solid var(--card-border)',
                                                  borderRadius: 8,
                                                  padding: '0.5rem 0.75rem',
                                                  fontSize: 12,
                                                  maxWidth: 380,
                                                }}
                                              >
                                                <div style={{ fontWeight: 700, marginBottom: 6 }}>{p.fullName}</div>
                                                <div>Весь срез: {p.slice} уроков</div>
                                                {b.hasTeacher && <div>Педагог: {p.teacher} уроков</div>}
                                              </div>
                                            );
                                          }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: 4 }} />
                                        <Bar dataKey="slice" fill="#0d9488" name="Весь срез" radius={[0, 4, 4, 0]} />
                                        {b.hasTeacher ? (
                                          <Bar
                                            dataKey="teacher"
                                            fill="#e30613"
                                            name={`Педагог: ${b.mentorName}`}
                                            radius={[0, 4, 4, 0]}
                                          />
                                        ) : null}
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>
                                </div>
                              )}
                            </section>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}

                  {metricPickIndex != null && meanByMonthChartRows.length >= 2 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Динамика среднего по месяцам</h3>
                      <p className="muted excel-dash-card-sub">
                        По выбранному в блоке «Распределение по пункту» числовому пункту — среднее значение по уникальным
                        урокам внутри каждого календарного месяца (колонка «Дата»).
                      </p>
                      <div className="excel-analytics-chart">
                        <ResponsiveContainer width="100%" height={260}>
                          <LineChart data={meanByMonthChartRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={52} />
                            <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                            <Tooltip
                              formatter={(v: number) => [v != null ? Number(v).toFixed(2) : '—', 'Среднее']}
                              labelFormatter={(label) => String(label)}
                            />
                            <Line
                              type="monotone"
                              dataKey="mean"
                              stroke="var(--brand-red)"
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              name={metricHeaderLabelUi}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {mentorChartData.length > 0 && metricNumericCols.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--mentors">
                      <h3 className="excel-dash-card-title">По наставникам: средние по всем пунктам</h3>
                      <p className="muted excel-dash-card-sub">
                        Каждый столбец — числовой пункт из таблицы; по оси X — наставник. Один урок с несколькими ФИО в ячейке
                        учтён как отдельные оценки для каждого. В таблице ниже — цветовая интенсивность по столбцу (светлее
                        — ниже среднее по наставникам в этом пункте в срезе, насыщеннее — выше). Чтобы сравнить педагогов внутри
                        одной параллели, вверху отметьте «Параллель (из класса)» или отдельную колонку «Параллель» — график
                        пересчитается по текущему срезу.
                      </p>
                      <div className="excel-analytics-chart excel-dash-chart-tall">
                        <ResponsiveContainer
                          width="100%"
                          height={Math.min(520, 120 + mentorChartData.length * Math.min(48, 36 + metricNumericCols.length * 6))}
                        >
                          <BarChart
                            data={mentorChartData}
                            margin={{ top: 8, right: 16, left: 8, bottom: metricNumericCols.length > 4 ? 48 : 24 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis
                              dataKey="mentor"
                              tick={{ fontSize: 10 }}
                              interval={0}
                              angle={-28}
                              textAnchor="end"
                              height={Math.min(120, 40 + metricNumericCols.length * 8)}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ paddingTop: 8 }} />
                            {metricNumericCols.map((mi, i) => (
                              <Bar
                                key={mi}
                                dataKey={`m${mi}`}
                                name={metricColLegendLabel(mi, `П.${mi + 1}`)}
                                fill={DASH_BAR_COLORS[i % DASH_BAR_COLORS.length]}
                                radius={[2, 2, 0, 0]}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="excel-dash-table-scroll excel-dash-mentor-table-wrap">
                        <table className="excel-dash-data-table excel-dash-data-table--dense">
                          <thead>
                            <tr>
                              <th>Педагог</th>
                              {metricNumericCols.map((mi) => (
                                <th key={mi}>{metricColLegendLabel(mi, `П.${mi + 1}`)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {mentorChartData.map((row) => (
                              <tr key={String(row.mentor)}>
                                <td className="excel-dash-data-table-key">{String(row.mentor)}</td>
                                {metricNumericCols.map((mi) => {
                                  const v = row[`m${mi}`];
                                  const range = mentorColRanges.find((x) => x.mi === mi);
                                  const num = v != null && Number.isFinite(Number(v)) ? Number(v) : null;
                                  const bg =
                                    num != null && range
                                      ? mentorHeatColor(num, range.min, range.max)
                                      : undefined;
                                  return (
                                    <td key={mi} className="excel-mentor-heatmap-cell" style={{ background: bg }}>
                                      {num != null ? num.toFixed(2) : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  <div className="excel-dashboard-chart-row">
                    {metricNumericCols.length > 0 && (
                      <section className="card glass-surface excel-dash-card excel-dash-card--in-row">
                        <h3 className="excel-dash-card-title">Распределение по пункту</h3>
                        <p className="muted excel-dash-card-sub excel-metric-pick-hint">
                          {teacherFilterKey
                            ? 'Клик по столбцу — список педагогов справа; по ФИО — краткая сводка в панели и автоматически раскрываются «Исходные факты» ниже.'
                            : 'Для списка педагогов по интервалу назначьте колонку «Код/шифр педагога».'}
                        </p>
                        <label className="excel-analytics-field">
                          Пункт
                          <select
                            className="excel-analytics-select"
                            value={metricPickIndex ?? ''}
                            onChange={(e) => setMetricPickIndex(Number(e.target.value))}
                          >
                            {metricNumericCols.map((mi) => (
                              <option key={mi} value={mi}>
                                {metricColLegendLabel(mi, `П.${mi + 1}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {histogramBinsForPick.length > 0 && metricPickIndex != null && (
                          <div
                            className={
                              metricDrill && teacherFilterKey && metricDrill.colIndex === metricPickIndex
                                ? 'excel-metric-drill-row'
                                : 'excel-metric-drill-row excel-metric-drill-row--solo'
                            }
                          >
                            <div className="excel-metric-drill-chart-wrap excel-analytics-chart">
                              <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={histogramBinsForPick} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                                  <XAxis
                                    dataKey="label"
                                    tick={{ fontSize: 10 }}
                                    interval={0}
                                    angle={-22}
                                    textAnchor="end"
                                    height={56}
                                  />
                                  <YAxis tick={{ fontSize: 11 }} />
                                  <Tooltip />
                                  <Bar dataKey="count" name="Кол-во" radius={[4, 4, 0, 0]}>
                                    {histogramBinsForPick.map((entry, i) => (
                                      <Cell
                                        key={`pick-${i}`}
                                        fill="var(--chart-bar)"
                                        cursor={teacherFilterKey ? 'pointer' : 'default'}
                                        opacity={
                                          metricDrill?.colIndex === metricPickIndex &&
                                          metricDrill?.bin.binIndex === entry.binIndex
                                            ? 1
                                            : 0.5
                                        }
                                        onClick={() => {
                                          if (!teacherFilterKey) return;
                                          onHistogramBinClick(
                                            metricPickIndex,
                                            metricHeaderLabel,
                                            histogramBinsForPick,
                                            entry,
                                          );
                                        }}
                                      />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                              <p className="muted">{metricHeaderLabel}</p>
                            </div>
                            {metricDrill &&
                              teacherFilterKey &&
                              metricDrill.colIndex === metricPickIndex && (
                                <aside className="excel-metric-drill-panel" aria-label="Педагоги в интервале">
                                  <div className="excel-metric-drill-panel-head">
                                    <div>
                                      <div className="excel-metric-drill-panel-metric">{metricDrill.header}</div>
                                      <div className="excel-metric-drill-panel-bin">Интервал: {metricDrill.bin.label}</div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn excel-metric-drill-close"
                                      aria-label="Закрыть"
                                      onClick={() => setMetricDrill(null)}
                                    >
                                      ×
                                    </button>
                                  </div>
                                  {metricDrillTeachers.length === 0 ? (
                                    <p className="muted">Нет педагогов в этом интервале.</p>
                                  ) : (
                                    <ul className="excel-metric-drill-teacher-list">
                                      {metricDrillTeachers.map((t) => (
                                        <li key={t.teacher}>
                                          <button
                                            type="button"
                                            className="excel-metric-drill-teacher-btn"
                                            onClick={() => drillSelectTeacher(t.teacher)}
                                          >
                                            <span className="excel-metric-drill-teacher-name">{t.teacher}</span>
                                            <span className="muted">{t.lessons} ур.</span>
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {singleTeacherFilterName && quickText ? (
                                    <ExcelDrillMiniSummary
                                      teacherName={singleTeacherFilterName}
                                      quickText={quickText}
                                      onOpenFacts={openExcelFactsAndScroll}
                                    />
                                  ) : null}
                                </aside>
                              )}
                          </div>
                        )}
                      </section>
                    )}

                    {meanChartDisplay.length > 0 && (
                      <section className="card glass-surface excel-dash-card excel-dash-card--in-row">
                        <h3 className="excel-dash-card-title">Средние по критериям (общие)</h3>
                        <div className="excel-analytics-chart">
                          <ResponsiveContainer width="100%" height={Math.min(400, 40 + meanChartDisplay.length * 32)}>
                            <BarChart data={meanChartDisplay} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis type="number" tick={{ fontSize: 11 }} />
                              <YAxis type="category" dataKey="short" width={180} tick={{ fontSize: 10 }} interval={0} />
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const p = payload[0].payload as { fullName: string; mean: number };
                                  return (
                                    <div
                                      style={{
                                        background: '#fff',
                                        border: '1px solid var(--card-border)',
                                        borderRadius: 8,
                                        padding: '0.5rem 0.75rem',
                                        fontSize: 12,
                                      }}
                                    >
                                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.fullName}</div>
                                      <div>Среднее: {p.mean.toFixed(2)}</div>
                                    </div>
                                  );
                                }}
                              />
                              <Bar dataKey="mean" fill="var(--chart-bar)" name="Среднее" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </section>
                    )}

                    {monthData.length > 0 && (
                      <section className="card glass-surface excel-dash-card excel-dash-card--in-row">
                        <h3 className="excel-dash-card-title">Динамика по месяцам</h3>
                        <div className="excel-analytics-chart">
                          <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={monthData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Line type="monotone" dataKey="count" stroke="var(--brand-red)" strokeWidth={2} dot name="Строк" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </section>
                    )}
                  </div>

                  {ordinalChartDisplay.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--ordinal">
                      <h3 className="excel-dash-card-title">Текстовая шкала</h3>
                      <div className="excel-analytics-chart">
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={ordinalChartDisplay} layout="vertical" margin={{ top: 8, right: 8, left: 120, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="level" width={110} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="var(--chart-bar)" name="Кол-во" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <details className="excel-dash-details-more">
                        <summary>Таблица по уровням</summary>
                        <div className="excel-dash-table-scroll">
                          <table className="excel-dash-data-table excel-dash-data-table--dense">
                            <thead>
                              <tr>
                                <th>Уровень шкалы</th>
                                <th>Количество</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ordinalChartDisplay.map((r) => (
                                <tr key={r.level}>
                                  <td>{r.level}</td>
                                  <td>{r.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </section>
                  )}
                </div><div className="excel-dash-board-panels excel-dash-board-panels--compact">
                  <div className="excel-dash-panel-row excel-dash-panel-row--two excel-dash-panel-row--compact-kpi">
                    <section className="card glass-surface excel-dash-card excel-dash-card--data-panel">
                      <h3 className="excel-dash-card-title">Сводка выборки</h3>
                      <div className="excel-dash-kpi-compact-row" aria-label="Ключевые показатели">
                        <div className="excel-dash-kpi-compact-item">
                          <span className="excel-dash-kpi-compact-value">{kpiLessons}</span>
                          <span className="excel-dash-kpi-compact-label">уроков в срезе</span>
                        </div>
                        <div className="excel-dash-kpi-compact-item">
                          <span className="excel-dash-kpi-compact-value">{filteredRows.length}</span>
                          <span className="excel-dash-kpi-compact-label">точек</span>
                        </div>
                        {teacherFilterKey != null && (
                          <div className="excel-dash-kpi-compact-item">
                            <span className="excel-dash-kpi-compact-value">{kpiMentors}</span>
                            <span className="excel-dash-kpi-compact-label">педагогов</span>
                          </div>
                        )}
                        <div className="excel-dash-kpi-compact-item excel-dash-kpi-compact-item--wide">
                          <span className="excel-dash-kpi-compact-value excel-dash-kpi-compact-value--sm">
                            {dashboardDateRange ? `${dashboardDateRange.from} — ${dashboardDateRange.to}` : '—'}
                          </span>
                          <span className="excel-dash-kpi-compact-label">период</span>
                        </div>
                      </div>
                      <details className="excel-dash-details-more">
                        <summary>Подробнее о подсчёте</summary>
                        <div className="excel-dash-table-scroll">
                          <table className="excel-dash-data-table excel-dash-data-table--dense">
                            <tbody>
                              {fileName && (
                                <tr>
                                  <th scope="row">Файл</th>
                                  <td>{fileName}</td>
                                </tr>
                              )}
                              {sheet && (
                                <tr>
                                  <th scope="row">Лист</th>
                                  <td>{sheet}</td>
                                </tr>
                              )}
                              <tr>
                                <th scope="row">Строк в разборе</th>
                                <td>{analyticRows.length}</td>
                              </tr>
                              <tr>
                                <th scope="row">Строк импорта в срезе</th>
                                <td>{kpiImportRowsFiltered}</td>
                              </tr>
                              <tr>
                                <th scope="row">Уроков (весь файл)</th>
                                <td>
                                  {uniqueLessonCount}{' '}
                                  <span className="muted">({kpiImportRowsTotal} имп.)</span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </section>
                    <section className="card glass-surface excel-dash-card excel-dash-card--data-panel">
                      <h3 className="excel-dash-card-title">Активные фильтры</h3>
                      {filterSnapshotAllOpen ? (
                        <p className="muted excel-dash-filter-compact-all">Все измерения: весь диапазон значений.</p>
                      ) : (
                        <div className="excel-dash-table-scroll excel-dash-table-scroll--tall">
                          <table className="excel-dash-data-table excel-dash-data-table--dense">
                            <thead>
                              <tr>
                                <th>Поле</th>
                                <th>Срез</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filterSnapshotRows.map((r) => (
                                <tr key={r.label}>
                                  <td className="excel-dash-data-table-key">{r.label}</td>
                                  <td>{r.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                  {metricsTableRows.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--metrics-table">
                      <h3 className="excel-dash-card-title">Числовые пункты в текущем срезе</h3>
                      <p className="muted excel-dash-card-sub">
                        Среднее, минимум и максимум по уникальным записям урока (строка Excel): при развёртке нескольких
                        наставников или тегов в одной ячейке урок не учитывается несколько раз.
                      </p>
                      <div className="excel-dash-table-scroll">
                        <table className="excel-dash-data-table excel-dash-data-table--dense">
                          <thead>
                            <tr>
                              <th>Показатель</th>
                              <th>Среднее</th>
                              <th>Мин.</th>
                              <th>Макс.</th>
                              <th>Уроков с числом</th>
                            </tr>
                          </thead>
                          <tbody>
                            {metricsTableRows.map((row) => (
                              <tr key={row.col}>
                                <td className="excel-dash-data-table-metric-name">
                                  {formatBilingualCellLabel(row.name, showEnglishExcelLabels ? 'en' : 'ru')}
                                </td>
                                <td>{row.mean != null ? row.mean.toFixed(2) : '—'}</td>
                                <td>{row.min != null ? row.min.toFixed(2) : '—'}</td>
                                <td>{row.max != null ? row.max.toFixed(2) : '—'}</td>
                                <td>{row.n}</td>
                              </tr>
                            ))}
                            {metricNumericCols.length > 1 && sumStatsRow && (
                              <tr className="excel-dash-data-table-total">
                                <td className="excel-dash-data-table-metric-name">Σ пунктов по строке</td>
                                <td>{sumStatsRow.mean.toFixed(2)}</td>
                                <td>{sumStatsRow.min.toFixed(2)}</td>
                                <td>{sumStatsRow.max.toFixed(2)}</td>
                                <td>{sumStatsRow.n}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>

                <PulseExcelChat
                  facetOptions={pulseFacetOptions}
                  facetLabels={pulseFacetLabels}
                  currentFilters={filterSelection}
                  numericSummary={richLlmContext || quickText || '(постройте анализ для сводки)'}
                  extraContext={pulseLlmExtraBundle.trim() || undefined}
                  onApplyFilters={applyPulseFilters}
                  embeddedPanel={
                    <>
                      <div className="pulse-excel-embed-stack" id="excel-drill-summary">
                        <details className="pulse-excel-embed-details" open>
                          <summary className="pulse-excel-embed-summary">
                            <span>Аналитический отчёт (ИИ)</span>
                            {summaryNarrativeWords != null && (
                              <span className="excel-dash-ai-report-badge">≈ {summaryNarrativeWords} слов</span>
                            )}
                          </summary>
                          <p className="muted excel-dash-card-sub excel-summary-source-note">
                            {summaryNarrativeLoading &&
                              'Готовим развёрнутый текст. Пока можно открыть «Исходные факты» ниже.'}
                            {!summaryNarrativeLoading && summaryNarrative && 'Связный документ по текущему срезу и фактам из таблицы.'}
                            {!summaryNarrativeLoading && !summaryNarrative &&
                              (summaryNarrativeApiHint ||
                                'ИИ-отчёт не сформирован: проверьте ключи LLM на Cloud Function и логи.')}
                          </p>
                          {summaryNarrative ? (
                            <article className="excel-ai-report-prose">
                              {splitNarrativeParagraphs(summaryNarrative).map((para, i) => (
                                <p key={i}>{para}</p>
                              ))}
                            </article>
                          ) : (
                            <p className="muted excel-ai-report-placeholder">
                              {summaryNarrativeLoading ? '…' : 'Отчёт появится после ответа модели.'}
                            </p>
                          )}
                          <details
                            className="excel-ai-report-facts"
                            open={excelFactsOpen}
                            onToggle={(e) => setExcelFactsOpen(e.currentTarget.open)}
                          >
                            <summary className="excel-ai-report-facts-summary">Исходные факты (машинная сводка)</summary>
                            <pre className="excel-analytics-pre excel-dash-pre excel-ai-report-facts-pre">
                              {workbookCodebookRu.trim()
                                ? `${workbookCodebookRu.trim()}\n\n${richLlmContext || quickText}`
                                : richLlmContext || quickText}
                            </pre>
                          </details>
                        </details>

                        <details className="pulse-excel-embed-details">
                          <summary className="pulse-excel-embed-summary">
                            <span>Полный разбор среза (глубокий режим)</span>
                            {deepWords != null && (
                              <span className="excel-dash-ai-report-badge">≈ {deepWords} слов</span>
                            )}
                          </summary>
                          <p className="muted excel-dash-card-sub">
                            Развёрнутый текст по текущим фильтрам. Выполняется по кнопке (отдельный запрос к модели на
                            функции).
                          </p>
                          <label className="excel-deep-focus-label">
                            <span className="muted">Дополнительный фокус (необязательно)</span>
                            <textarea
                              className="field excel-deep-focus-textarea"
                              rows={3}
                              value={deepUserFocus}
                              onChange={(e) => setDeepUserFocus(e.target.value)}
                              placeholder="Например: сравни очный и онлайн; акцент на младших классах"
                              disabled={deepLoading || !richLlmContext.trim()}
                            />
                          </label>
                          <div className="excel-deep-report-actions">
                            <button
                              type="button"
                              className="btn primary"
                              disabled={deepLoading || !richLlmContext.trim()}
                              onClick={() => void fetchDeepDashboardAnalysis()}
                            >
                              {deepLoading ? 'Формируем…' : 'Сформировать полный отчёт'}
                            </button>
                          </div>
                          {deepHint && <p className="excel-director-dossier-hint">{deepHint}</p>}
                          {deepNarrative ? (
                            <article className="excel-ai-report-prose excel-ai-report-prose--deep">
                              {splitNarrativeParagraphs(deepNarrative).map((para, i) => (
                                <p key={i}>{para}</p>
                              ))}
                            </article>
                          ) : (
                            <p className="muted excel-ai-report-placeholder">
                              {deepLoading ? '…' : 'Нажмите кнопку выше.'}
                            </p>
                          )}
                        </details>

                        {teacherFilterKey && (
                          <details className="pulse-excel-embed-details">
                            <summary className="pulse-excel-embed-summary">Записки для директора по педагогам</summary>
                            <p className="muted excel-dash-card-sub">
                              По срезу — блоки по педагогам (и предмету, если задан в маппинге).
                            </p>
                            <div className="excel-director-dossier-actions">
                              <button
                                type="button"
                                className="btn primary"
                                disabled={directorDossierBusy || !filteredRows.length}
                                onClick={() => void fetchDirectorDossier()}
                              >
                                {directorDossierBusy ? 'Формируем…' : 'Сформировать записки (ИИ)'}
                              </button>
                              {directorDossierMeta && (
                                <span className="muted excel-director-dossier-meta">
                                  Сегментов: {directorDossier?.length ?? 0}
                                  {directorDossierMeta.truncated ? ` (всего: ${directorDossierMeta.totalGroups})` : ''}
                                </span>
                              )}
                            </div>
                            {directorDossierHint && <p className="excel-director-dossier-hint">{directorDossierHint}</p>}
                            {directorDossier && directorDossier.length > 0 && (
                              <div className="excel-director-dossier-list">
                                {directorDossier.map((row) => (
                                  <details key={row.segmentId} className="excel-director-dossier-block" open>
                                    <summary className="excel-director-dossier-summary">
                                      <span className="excel-director-dossier-summary-name">{row.teacher}</span>
                                      {row.subject != null && row.subject !== '' && (
                                        <span className="muted excel-director-dossier-summary-subj"> · {row.subject}</span>
                                      )}
                                    </summary>
                                    {row.narrative ? (
                                      <div className="excel-director-dossier-body">
                                        {splitNarrativeParagraphs(row.narrative).map((para, i) => (
                                          <p key={i}>{para}</p>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="muted excel-director-dossier-missing">Текст не получен.</p>
                                    )}
                                  </details>
                                ))}
                              </div>
                            )}
                          </details>
                        )}
                      </div>
                    </>
                  }
                />

                
              </div>

            <section className="card glass-surface excel-analytics-section excel-dashboard-table-section">
              <h2 className="admin-dash-h2">Детализация: первые 50 строк текущей выборки</h2>
              <p className="muted excel-dashboard-table-lead">
                Полные значения по строкам; состав колонок зависит от ролей в маппинге и подходит для любого загружаемого файла.
              </p>
              <div className="excel-analytics-table-wrap">
                <table className="excel-analytics-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {teacherFilterKey != null && <th>Наставник</th>}
                      <th>Дата</th>
                      <th>Подпись</th>
                      {metricNumericCols.map((mi) => (
                        <th key={mi}>
                          {formatBilingualCellLabel(headers[mi] ?? '', showEnglishExcelLabels ? 'en' : 'ru')}
                        </th>
                      ))}
                      {metricNumericCols.length > 1 && <th>Σ пунктов</th>}
                      {roles.includes('metric_ordinal_text') && <th>Шкала</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 50).map((r) => {
                      const rowSum = rowNumericSum(r);
                      return (
                        <tr key={`${r.idx}-${r.splitPart ?? 0}-${teacherFilterKey ? r.filterValues[teacherFilterKey] : ''}`}>
                          <td>
                            {r.idx + 1}
                            {r.splitPart != null && r.splitPart > 0 ? ` · ${r.splitPart}` : ''}
                          </td>
                          {teacherFilterKey != null && (
                            <td className="excel-analytics-cell-clip">{r.filterValues[teacherFilterKey] ?? '—'}</td>
                          )}
                          <td>{r.date ?? '—'}</td>
                          <td className="excel-analytics-cell-clip">{r.rowLabel ?? '—'}</td>
                          {metricNumericCols.map((mi) => {
                            const m = r.metricsNumeric.find((x) => x.colIndex === mi);
                            return <td key={mi}>{m?.value != null ? String(m.value) : '—'}</td>;
                          })}
                          {metricNumericCols.length > 1 && (
                            <td>{rowSum != null ? rowSum.toFixed(2) : '—'}</td>
                          )}
                          {roles.includes('metric_ordinal_text') && (
                            <td>
                              {r.metricOrdinal != null
                                ? formatBilingualCellLabel(
                                    String(ordinalLevels[r.metricOrdinal - 1] ?? r.metricOrdinal),
                                    showEnglishExcelLabels ? 'en' : 'ru',
                                  )
                                : '—'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </motion.div>
    </MotionConfig>
  );
}

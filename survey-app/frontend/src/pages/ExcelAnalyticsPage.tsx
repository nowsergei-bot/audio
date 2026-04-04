import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
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
import { fadeIn } from '../motion/resultsMotion';
import {
  applyFilters,
  applyFiltersExceptKey,
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
  histogramNumeric,
  isFilterRole,
  meanByNumericColumn,
  meanByTeacherGrouped,
  meanMinMax,
  ordinalDistribution,
  parseAnalyticsDate,
  pruneFilterSelection,
  rowNumericSum,
  sumTotalStats,
  uniqueFilterValues,
  type AnalyticRow,
  type FilterSelection,
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

function splitNarrativeParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
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
  /** При загрузке листа сразу подбирать роли по заголовкам и данным */
  const [autoMapOnLoad, setAutoMapOnLoad] = useState(true);
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

  const runAnalysis = () => {
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
    setAnalyticRows(built);

    const sel: FilterSelection = {};
    const keys = new Set<string>();
    rolesForRun.forEach((r) => {
      if (isFilterRole(r)) keys.add(filterKeyForRole(r, customLabels));
    });
    keys.forEach((k) => {
      sel[k] = null;
    });
    setFilterSelection(sel);

    const firstMetric =
      rolesForRun.map((r, i) => (r === 'metric_numeric' ? i : -1)).find((i) => i >= 0) ?? null;
    setMetricPickIndex(firstMetric);
  };

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
    return [...keys];
  }, [roles, customLabels]);

  const filterSectionColumns = useMemo((): FilterColumnForSections[] => {
    return roles
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => isFilterRole(r))
      .map(({ r, i }) => ({
        filterKey: filterKeyForRole(r, customLabels),
        role: r,
        header: headers[i] || '',
        colIndex: i,
      }));
  }, [roles, headers, customLabels]);

  const autoFilterSections = useMemo(() => buildAutoFilterSections(filterSectionColumns), [filterSectionColumns]);
  const filterSections = aiSectionLayout ?? autoFilterSections;

  const filterKeyDisplayLabel = useMemo(() => {
    const m: Record<string, string> = {};
    roles.forEach((r, i) => {
      if (!isFilterRole(r)) return;
      const fk = filterKeyForRole(r, customLabels);
      const h = headers[i]?.trim();
      m[fk] = h || fk;
    });
    return m;
  }, [roles, headers, customLabels]);

  const dashboardDateRange = useMemo(() => {
    const dates = filteredRowsOnePerLesson.map((r) => r.date).filter((d): d is string => Boolean(d));
    if (!dates.length) return null;
    dates.sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [filteredRowsOnePerLesson]);

  const filterSnapshotRows = useMemo(() => {
    const rows: { label: string; value: string }[] = [];
    for (const k of filterKeys) {
      const sel = filterSelection[k];
      const label = filterKeyDisplayLabel[k] ?? k;
      if (sel === null) {
        rows.push({ label, value: 'Все значения' });
      } else if (Array.isArray(sel)) {
        if (sel.length === 0) rows.push({ label, value: 'Нет (срез по столбцу пуст)' });
        else rows.push({ label, value: sel.join('; ') });
      }
    }
    return rows;
  }, [filterKeys, filterSelection, filterKeyDisplayLabel]);

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

  const histogramData = useMemo(() => {
    if (metricPickIndex == null) return [];
    return histogramNumeric(filteredRowsOnePerLesson, metricPickIndex, 8);
  }, [filteredRowsOnePerLesson, metricPickIndex]);

  const monthData = useMemo(() => countsByMonth(filteredRowsOnePerLesson), [filteredRowsOnePerLesson]);

  const ordinalChartData = useMemo(() => {
    if (roles.indexOf('metric_ordinal_text') < 0) return [];
    return ordinalDistribution(filteredRowsOnePerLesson, ordinalLevels);
  }, [filteredRowsOnePerLesson, ordinalLevels, roles]);

  const metricHeaderLabel = metricPickIndex != null ? headers[metricPickIndex] ?? 'Метрика' : '';

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

  const applyPulseFilters = useCallback((update: (prev: FilterSelection) => FilterSelection) => {
    setFilterSelection(update);
  }, []);

  /** После смены среза убираем значения, которые не встречаются вместе с выбранными другими фильтрами. */
  useEffect(() => {
    if (!analyticRows.length || !filterKeys.length) return;
    setFilterSelection((prev) => {
      const next = pruneFilterSelection(analyticRows, prev, filterKeys);
      return filterSelectionsEqual(prev, next, filterKeys) ? prev : next;
    });
  }, [analyticRows, filterKeys, filterSelection]);

  /** Новый набор строк — сбрасываем ИИ-разметку разделов и подгрупп значений. */
  useEffect(() => {
    setAiSectionLayout(null);
    setAiSectionsHint(null);
    setFacetGroupsByKey({});
    setFacetGroupsHint(null);
  }, [analyticRows]);

  /** Смена среза — сбрасываем записи для директора (нужно сформировать заново). */
  useEffect(() => {
    setDirectorDossier(null);
    setDirectorDossierHint(null);
    setDirectorDossierMeta(null);
  }, [analyticRows, filterSelection]);

  const fetchAiFilterSections = useCallback(async () => {
    if (!analyticRows.length || !filterKeys.length) return;
    setAiSectionsBusy(true);
    setAiSectionsHint(null);
    try {
      const columns = roles
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => isFilterRole(r))
        .map(({ r, i }) => {
          const fk = filterKeyForRole(r, customLabels);
          const base = applyFiltersExceptKey(analyticRows, filterSelection, fk);
          return {
            filterKey: fk,
            role: r,
            roleLabel: COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r,
            header: headers[i] || fk,
            samples: uniqueFilterValues(base, fk).slice(0, 14),
          };
        });
      const res = await postExcelFilterSections({ filterKeys, columns });
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
  }, [analyticRows, filterKeys, filterSelection, roles, customLabels, headers]);

  const fetchAiValueGroups = useCallback(async () => {
    if (!analyticRows.length || !filterKeys.length) return;
    setFacetGroupsBusy(true);
    setFacetGroupsHint(null);
    const acc: Record<string, ExcelFilterValueGroup[]> = {};
    const hints: string[] = [];
    try {
      let anyLong = false;
      for (const key of filterKeys) {
        const all = uniqueFilterValues(applyFiltersExceptKey(analyticRows, filterSelection, key), key);
        if (all.length < 18) continue;
        anyLong = true;
        const res = await postExcelFilterValueGroups({
          filterKey: key,
          header: filterKeyDisplayLabel[key] ?? key,
          values: all,
        });
        if (res.source === 'llm' && res.groups?.length) {
          acc[key] = res.groups;
        } else if (res.hint) {
          hints.push(`${filterKeyDisplayLabel[key] ?? key}: ${res.hint}`);
        }
      }
      setFacetGroupsByKey(acc);
      if (!anyLong) {
        setFacetGroupsHint('При текущем срезе нет столбцов с 18+ вариантами — расширьте фильтры или загрузите другой фрагмент.');
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
  }, [analyticRows, filterKeys, filterSelection, filterKeyDisplayLabel]);

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
        const checked = sel === null || (sel?.includes(val) ?? false);
        return (
          <label key={val} className="excel-analytics-chip">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                setFilterSelection((prev) => {
                  const cur = prev[key];
                  if (cur === null) {
                    const next = all.filter((x) => x !== val);
                    return { ...prev, [key]: next };
                  }
                  const set = new Set(cur);
                  if (set.has(val)) set.delete(val);
                  else set.add(val);
                  const next = [...set];
                  if (next.length === all.length) return { ...prev, [key]: null };
                  return { ...prev, [key]: next };
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
    [filterSelection, facetGroupsByKey],
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
          setSummaryNarrativeApiHint(null);
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
          <p className="admin-dash-kicker">Пульс · аналитика</p>
          <h1 className="admin-dash-title">Наблюдения из Excel</h1>
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
          <div className="excel-dashboard">
            <div className="excel-dashboard-workspace">
              <aside className="excel-dashboard-sidebar" aria-label="Фильтры и выборка">
                <div className="card glass-surface excel-dashboard-sidebar-card">
                  <div className="excel-dashboard-sidebar-head">
                    <p className="excel-dashboard-sidebar-kicker">Срез данных</p>
                    <h2 className="excel-dashboard-sidebar-title">Выборка</h2>
                    <p className="muted excel-dashboard-sidebar-lead">
                      Отметьте значения — справа обновятся графики, ПУЛЬС и таблица.
                    </p>
                    <div className="excel-dashboard-kpis excel-dashboard-kpis--sidebar">
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
                    <button
                      type="button"
                      className="btn primary excel-dashboard-reset excel-dashboard-reset--block"
                      onClick={resetAllFilters}
                    >
                      Сбросить все фильтры
                    </button>
                  </div>
                  <div className="excel-dashboard-sidebar-filters">
                    <h3 className="excel-dashboard-filters-heading">Фильтры</h3>
                    <p className="muted excel-dashboard-filter-ai-note">
                      Разделы и списки сначала строятся автоматически (роли, заголовки, каскад по выбранным фильтрам).
                      Кнопки ниже — опционально ИИ (тот же API, что у ПУЛЬС): перегруппировать блоки боковой панели или сложить
                      длинные «сырые» списки (классы, метки) в смысловые подгруппы. Цепочка среза по-прежнему соблюдается:
                      варианты только совместимые с остальным выбором.
                    </p>
                    <div className="excel-dashboard-filter-ai-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={!analyticRows.length || aiSectionsBusy}
                        onClick={() => void fetchAiFilterSections()}
                      >
                        {aiSectionsBusy ? 'ИИ: разделы…' : 'ИИ: разделы панели'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={!analyticRows.length || facetGroupsBusy}
                        onClick={() => void fetchAiValueGroups()}
                      >
                        {facetGroupsBusy ? 'ИИ: группы…' : 'ИИ: группы в длинных списках'}
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
                    <p className="muted excel-dashboard-filter-hint">
                      Значения в одной ячейке через запятую (как в Google Forms) дают отдельные варианты. «Снять все» в
                      столбце исключает его из среза; «Все значения» снимает ограничение по этому столбцу. Если срез стал
                      пустым, расширьте фильтры слева.
                    </p>
                    <div className="excel-analytics-filters">
                      {filterSections.map((section) => (
                        <div key={section.id} className="excel-dashboard-filter-section">
                          <h4 className="excel-dashboard-filter-section-title">{section.title}</h4>
                          {section.keys.map((key) => {
                            const all = uniqueFilterValues(
                              applyFiltersExceptKey(analyticRows, filterSelection, key),
                              key,
                            );
                            return (
                              <div key={key} className="excel-analytics-filter-block">
                                <div className="excel-analytics-filter-title">{filterKeyDisplayLabel[key] ?? key}</div>
                                {renderFilterChipsForKey(key, all)}
                                <div className="excel-analytics-filter-actions">
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => setFilterSelection((p) => ({ ...p, [key]: null }))}
                                  >
                                    Все значения
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => setFilterSelection((p) => ({ ...p, [key]: [] }))}
                                  >
                                    Снять все
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>

              <div className="excel-dashboard-main">
                <header className="excel-dashboard-main-head card glass-surface">
                  <div className="excel-dashboard-main-head-text">
                    <p className="excel-dashboard-main-kicker">Панель анализа</p>
                    <h2 className="excel-dashboard-main-title">Графики, выводы и детализация</h2>
                    <p className="muted excel-dashboard-main-lead">
                      Любой .xlsx с вашими ролями колонок: слева — срез, здесь — таблицы сводки, графики и развёрнутый отчёт ИИ
                      (не копипаст из Excel, а интерпретация для руководителя). Ниже — ассистент ПУЛЬС для уточняющих вопросов.
                    </p>
                  </div>
                </header>

                <div className="excel-dash-board-panels">
                  <div className="excel-dash-panel-row excel-dash-panel-row--two">
                    <section className="card glass-surface excel-dash-card excel-dash-card--data-panel">
                      <h3 className="excel-dash-card-title">Сводка выборки</h3>
                      <p className="muted excel-dash-card-sub">Показатели пересчитываются при любых фильтрах и любом новом файле.</p>
                      <div className="excel-dash-table-scroll">
                        <table className="excel-dash-data-table">
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
                              <th scope="row">Точек в текущем срезе</th>
                              <td>{filteredRows.length}</td>
                            </tr>
                            <tr>
                              <th scope="row">Уроков по смыслу (в срезе)</th>
                              <td>
                                {kpiLessons}
                                <span className="muted excel-dash-table-hint">
                                  {' '}
                                  дата + подпись строки + фильтры, кроме наставника; дубликаты строк Excel схлопываются
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <th scope="row">Строк импорта в срезе</th>
                              <td>{kpiImportRowsFiltered}</td>
                            </tr>
                            <tr>
                              <th scope="row">Уроков по смыслу (весь файл)</th>
                              <td>
                                {uniqueLessonCount}{' '}
                                <span className="muted">({kpiImportRowsTotal} строк импорта)</span>
                              </td>
                            </tr>
                            {teacherFilterKey != null && (
                              <tr>
                                <th scope="row">Педагогов в срезе</th>
                                <td>{kpiMentors}</td>
                              </tr>
                            )}
                            <tr>
                              <th scope="row">Период по дате</th>
                              <td>
                                {dashboardDateRange
                                  ? `${dashboardDateRange.from} — ${dashboardDateRange.to}`
                                  : '—'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className="card glass-surface excel-dash-card excel-dash-card--data-panel">
                      <h3 className="excel-dash-card-title">Активные фильтры</h3>
                      <p className="muted excel-dash-card-sub">Каскад: варианты согласованы с остальным выбором.</p>
                      <div className="excel-dash-table-scroll excel-dash-table-scroll--tall">
                        <table className="excel-dash-data-table">
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
                                <td className="excel-dash-data-table-metric-name">{row.name}</td>
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

                <section className="card glass-surface excel-dash-card excel-dash-card--ai-report">
                  <div className="excel-dash-ai-report-head">
                    <h3 className="excel-dash-card-title">Аналитический отчёт (ИИ)</h3>
                    {summaryNarrativeWords != null && (
                      <span className="excel-dash-ai-report-badge">≈ {summaryNarrativeWords} слов</span>
                    )}
                  </div>
                  <p className="muted excel-dash-card-sub excel-summary-source-note">
                    {summaryNarrativeLoading &&
                      'Готовим развёрнутый текст для руководителя (ориентир от 500 слов на нормальной выборке). Пока ниже — машинная выгрузка фактов в свёрнутом блоке.'}
                    {!summaryNarrativeLoading && summaryNarrative &&
                      'Стиль — развёрнутый аналитический документ для руководителя (как комплексный отчёт по наблюдениям). Основа — расширенная выгрузка фактов и средних по педагогам; модель не должна придумывать новые цифры вне этого контекста.'}
                    {!summaryNarrativeLoading && !summaryNarrative &&
                      (summaryNarrativeApiHint ||
                        'ИИ-отчёт недоступен: на Cloud Function задайте DEEPSEEK_API_KEY и LLM_PROVIDER=deepseek (рекомендуется из РФ), либо OPENAI_API_KEY / YANDEX_* — см. BACKEND_AND_API.md. Откройте блок «Исходные факты» для сырой выгрузки.')}
                  </p>
                  {summaryNarrative ? (
                    <article className="excel-ai-report-prose">
                      {splitNarrativeParagraphs(summaryNarrative).map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </article>
                  ) : (
                    <p className="muted excel-ai-report-placeholder">
                      {summaryNarrativeLoading ? '…' : 'Здесь появится связный отчёт после ответа модели.'}
                    </p>
                  )}
                  <details className="excel-ai-report-facts">
                    <summary className="excel-ai-report-facts-summary">Исходные факты из выборки (машинная сводка)</summary>
                    <pre className="excel-analytics-pre excel-dash-pre excel-ai-report-facts-pre">
                      {workbookCodebookRu.trim()
                        ? `${workbookCodebookRu.trim()}\n\n${richLlmContext || quickText}`
                        : richLlmContext || quickText}
                    </pre>
                  </details>
                </section>

                <section className="card glass-surface excel-dash-card excel-dash-card--ai-report excel-dash-card--deep-report">
                  <div className="excel-dash-ai-report-head">
                    <h3 className="excel-dash-card-title">Полный разбор среза (глубокий режим)</h3>
                    {deepWords != null && (
                      <span className="excel-dash-ai-report-badge">≈ {deepWords} слов</span>
                    )}
                  </div>
                  <p className="muted excel-dash-card-sub">
                    Те же фильтры слева задают <strong>параметры выборки</strong>: сузили класс, предмет, формат — в отчёт
                    попадёт только этот срез. Режим рассчитан на развёрнутый текст (ориентир от ~1000 слов на большой
                    выборке), в духе «прогнать через сильную модель» (удобно с{' '}
                    <span className="nowrap">DeepSeek</span>:{' '}
                    <code className="excel-inline-code">DEEPSEEK_API_KEY</code> и{' '}
                    <code className="excel-inline-code">LLM_PROVIDER=deepseek</code> на функции). Запрос выполняется по
                    кнопке — отдельно от автоматического отчёта выше.
                  </p>
                  <label className="excel-deep-focus-label">
                    <span className="muted">Дополнительный фокус (необязательно)</span>
                    <textarea
                      className="field excel-deep-focus-textarea"
                      rows={3}
                      value={deepUserFocus}
                      onChange={(e) => setDeepUserFocus(e.target.value)}
                      placeholder="Например: сравни очный и онлайн; акцент на младших классах; что не так с пунктом «…»"
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
                      {deepLoading ? 'Формируем полный отчёт…' : 'Сформировать полный отчёт по текущему срезу'}
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
                      {deepLoading
                        ? '…'
                        : 'Нажмите кнопку — модель соберёт расширенный документ по машинной сводке и вашим фильтрам.'}
                    </p>
                  )}
                </section>

                <PulseExcelChat
                  facetOptions={pulseFacetOptions}
                  facetLabels={pulseFacetLabels}
                  currentFilters={filterSelection}
                  numericSummary={richLlmContext || quickText || '(постройте анализ для сводки)'}
                  extraContext={pulseLlmExtraBundle.trim() || undefined}
                  onApplyFilters={applyPulseFilters}
                />

                <div className="excel-dashboard-main-charts">
                  {teacherFilterKey && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--director-dossier">
                      <h3 className="excel-dash-card-title">Записки для директора по педагогам</h3>
                      <p className="muted excel-dash-card-sub">
                        По текущему срезу данных для каждого педагога собираются факты (цифры и выдержки из таблицы); модель
                        превращает их в связный текст в духе аналитической записки. Если в маппинге есть колонка «Предмет /
                        тема», отдельный блок создаётся для каждой пары педагог + предмет — как в развёрнутом отчёте по
                        дисциплинам.
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
                            Сегментов в отчёте: {directorDossier?.length ?? 0}
                            {directorDossierMeta.truncated ? ` (всего в срезе: ${directorDossierMeta.totalGroups})` : ''}
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
                                <p className="muted excel-director-dossier-missing">Текст не получен для этого сегмента.</p>
                              )}
                            </details>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {mentorChartData.length > 0 && metricNumericCols.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--mentors">
                      <h3 className="excel-dash-card-title">По наставникам: средние по всем пунктам</h3>
                      <p className="muted excel-dash-card-sub">
                        Каждый столбец — числовой пункт из таблицы; по оси X — наставник. Один урок с несколькими ФИО в ячейке
                        учтён как отдельные оценки для каждого.
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
                                name={headers[mi] ?? `Пункт ${i + 1}`}
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
                                <th key={mi}>{headers[mi] ?? `П.${mi + 1}`}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {mentorChartData.map((row) => (
                              <tr key={String(row.mentor)}>
                                <td className="excel-dash-data-table-key">{String(row.mentor)}</td>
                                {metricNumericCols.map((mi) => {
                                  const v = row[`m${mi}`];
                                  return (
                                    <td key={mi}>{v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'}</td>
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
                        <label className="excel-analytics-field">
                          Пункт
                          <select
                            className="excel-analytics-select"
                            value={metricPickIndex ?? ''}
                            onChange={(e) => setMetricPickIndex(Number(e.target.value))}
                          >
                            {metricNumericCols.map((mi) => (
                              <option key={mi} value={mi}>
                                {headers[mi]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {histogramData.length > 0 && (
                          <div className="excel-analytics-chart">
                            <ResponsiveContainer width="100%" height={260}>
                              <BarChart data={histogramData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-22} textAnchor="end" height={56} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="count" fill="var(--chart-bar)" name="Кол-во" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                            <p className="muted">{metricHeaderLabel}</p>
                          </div>
                        )}
                      </section>
                    )}

                    {meanChartRows.length > 0 && (
                      <section className="card glass-surface excel-dash-card excel-dash-card--in-row">
                        <h3 className="excel-dash-card-title">Средние по критериям (общие)</h3>
                        <div className="excel-analytics-chart">
                          <ResponsiveContainer width="100%" height={Math.min(400, 40 + meanChartRows.length * 32)}>
                            <BarChart data={meanChartRows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
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

                  {ordinalChartData.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--ordinal">
                      <h3 className="excel-dash-card-title">Текстовая шкала</h3>
                      <div className="excel-analytics-chart">
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={ordinalChartData} layout="vertical" margin={{ top: 8, right: 8, left: 120, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="level" width={110} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="var(--chart-bar)" name="Кол-во" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="excel-dash-table-scroll">
                        <table className="excel-dash-data-table excel-dash-data-table--dense">
                          <thead>
                            <tr>
                              <th>Уровень шкалы</th>
                              <th>Количество</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ordinalChartData.map((r) => (
                              <tr key={r.level}>
                                <td>{r.level}</td>
                                <td>{r.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              </div>
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
                        <th key={mi}>{headers[mi]}</th>
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
                                ? ordinalLevels[r.metricOrdinal - 1] ?? r.metricOrdinal
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

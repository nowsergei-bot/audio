import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  deleteExcelAnalyticsProject,
  getExcelAnalyticsProject,
  listExcelAnalyticsProjects,
  postExcelDashboardAi,
  postExcelDerivedFilters,
  postExcelDirectorDossier,
  postExcelFilterSections,
  postExcelFilterValueGroups,
  postExcelNarrativeSummary,
  saveExcelAnalyticsProject,
  type ExcelAnalyticsProjectListItem,
} from '../api/client';
import AiWaitIndicator from '../components/AiWaitIndicator';
import PulseExcelChat from '../components/PulseExcelChat';
import { formatBilingualCellLabel } from '../lib/excelAnalytics/excelDisplayLabel';
import { fadeIn } from '../motion/resultsMotion';
import {
  applyCanonicalMapsToRows,
  applyDerivedDimensionsToRows,
  applyFilters,
  applyFiltersExceptKey,
  augmentRowsWithDerivedParallel,
  buildAnalyticRows,
  buildDirectorFactPackets,
  buildQuickSummaryRu,
  buildRichLlmContextRu,
  countUniqueImportRows,
  countUniqueLessonSemantics,
  dedupeRowsByLessonIdx,
  expandRowsForMultiValueFilterColumns,
  expandRowsForPulseSurveyMultiSelect,
  filterKeyForRole,
  filterSelectionsEqual,
  histogramNumericBins,
  isFilterRole,
  meanByNumericColumn,
  meanByTeacherGrouped,
  meanMinMax,
  normalizeFacetAggregateKey,
  ordinalDistribution,
  parseAnalyticsDate,
  newAiDerivedDimensionId,
  PULSE_AI_DIM_PREFIX,
  PULSE_ORDINAL_LEVEL_KEY,
  PULSE_PARALLEL_AUTO_KEY,
  pulseSurveyColKey,
  pruneFilterSelection,
  sumTotalStats,
  topFilterBucketsByUniqueLesson,
  uniqueFilterValues,
  listFeatureTagCounts,
  listFeatureTagFrequencyByTeacher,
  listFeatureTagUniverse,
  listStructuralFilterKeys,
  listSurveyCandidateFilterKeys,
  teacherListFeatureCoverage,
  teachersAtOrdinalRank,
  teachersInMetricBin,
  shouldExposePulseSurveyFilterCandidate,
  type AnalyticRow,
  type FilterSelection,
  type HistogramBinDetail,
} from '../lib/excelAnalytics/engine';
import { collapseSimilarFilterDimensionValues } from '../lib/excelAnalytics/filterValueNormalize';
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
import type { ExcelDerivedFilterDimension, ExcelFilterSectionPlan, ExcelFilterValueGroup } from '../types';
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
import { fileFingerprintFromFile, matchSessionForSheet, type SavedExcelSession } from '../lib/excelAnalytics/excelSessionStorage';

const MAX_ROWS = 8000;
/** Сколько строк среза показывать в таблице «как в Excel» (остальные — в подписи). */
const DETAIL_TABLE_MAX_ROWS = 500;
const DIRECTOR_DOSSIER_CHUNK = 8;
const METRIC_HIST_BINS = 8;
const DRILL_MINI_SUMMARY_CHARS = 960;

function formatExcelDetailCell(c: CellPrimitive): string {
  if (c == null || c === '') return '—';
  if (c instanceof Date) {
    return Number.isFinite(c.getTime()) ? c.toISOString().slice(0, 10) : '—';
  }
  if (typeof c === 'boolean') return c ? 'да' : 'нет';
  if (typeof c === 'number') {
    if (Number.isInteger(c) && Math.abs(c) < 1e15) return String(c);
    const t = String(c);
    return t.length > 28 ? `${t.slice(0, 25)}…` : t;
  }
  const s = String(c).replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  if (s.length > 240) return `${s.slice(0, 237)}…`;
  return s;
}

function excelDetailCellTitle(c: CellPrimitive | undefined): string | undefined {
  if (c == null || c === '') return undefined;
  if (c instanceof Date) {
    return Number.isFinite(c.getTime()) ? c.toISOString().slice(0, 10) : undefined;
  }
  const s = String(c).replace(/\s+/g, ' ').trim();
  if (s.length <= 40) return undefined;
  return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
}

/** Уникальный ключ строки детализации: idx+split совпадают у разных «точек» среза — без filterValues React дублирует key и не обновляет DOM. */
function detailTableRowKey(r: AnalyticRow, rowIndex: number): string {
  const fv = Object.keys(r.filterValues)
    .sort()
    .map((k) => `${k}:${r.filterValues[k]}`)
    .join('\u0001');
  return `dtr:${rowIndex}:${r.idx}:${r.splitPart ?? 0}:${fv}`;
}

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
  if (roles.includes('metric_ordinal_text')) {
    const oci = roles.indexOf('metric_ordinal_text');
    m[PULSE_ORDINAL_LEVEL_KEY] = headers[oci]?.trim() || 'Текстовая шкала';
  }
  roles.forEach((r, i) => {
    if (!shouldExposePulseSurveyFilterCandidate(r)) return;
    m[pulseSurveyColKey(i)] = headers[i]?.trim() || `Колонка ${i + 1}`;
  });
  return m;
}

function splitNarrativeParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
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
    const raw = c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim();
    const t = formatBilingualCellLabel(raw, 'ru').trim();
    if (t) s.add(t);
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Укорачиваем типичный текст ошибки списка проектов. */
function formatExcelProjectsListError(raw: string): string {
  if (/Unauthorized|Нужна авторизация/i.test(raw)) {
    return 'Укажите X-Api-Key на главной или войдите по логину.';
  }
  return raw;
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
  const [fileFingerprint, setFileFingerprint] = useState<string | null>(null);
  /** Скрытые измерения среза: не показываются в панели; отбор по ним сброшен. */
  const [filterPanelHiddenKeys, setFilterPanelHiddenKeys] = useState<string[]>([]);
  const [sessionRestoreNote, setSessionRestoreNote] = useState<string | null>(null);
  /** Снимок с сервера: применяется после загрузки того же файла и «Загрузить лист». */
  const [pendingServerSession, setPendingServerSession] = useState<SavedExcelSession | null>(null);
  const [pendingOpenProjectId, setPendingOpenProjectId] = useState<number | null>(null);
  const [openProjectHint, setOpenProjectHint] = useState<string | null>(null);
  /** После сохранения или открытия с сервера — обновление того же проекта кнопкой «Сохранить». */
  const [linkedProjectId, setLinkedProjectId] = useState<number | null>(null);
  const [excelProjects, setExcelProjects] = useState<ExcelAnalyticsProjectListItem[]>([]);
  const [excelProjectsLoading, setExcelProjectsLoading] = useState(false);
  const [excelProjectsError, setExcelProjectsError] = useState<string | null>(null);
  const [saveProjectTitle, setSaveProjectTitle] = useState('');
  const [saveProjectBusy, setSaveProjectBusy] = useState(false);
  const pendingServerSessionRef = useRef<SavedExcelSession | null>(null);
  const pendingOpenProjectIdRef = useRef<number | null>(null);
  /** Секция «1. Файл»: прокрутка после «Открыть», чтобы подсказка была видна. */
  const excelFileSectionRef = useRef<HTMLElement | null>(null);
  const [openProjectBusyId, setOpenProjectBusyId] = useState<number | null>(null);
  useEffect(() => {
    pendingServerSessionRef.current = pendingServerSession;
  }, [pendingServerSession]);
  useEffect(() => {
    pendingOpenProjectIdRef.current = pendingOpenProjectId;
  }, [pendingOpenProjectId]);

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
  /** Клик по столбцу гистограммы текстовой шкалы — уровень + список педагогов */
  const [ordinalDrill, setOrdinalDrill] = useState<{ rank: number; levelLabel: string } | null>(null);
  /** Раскрытие блока «Исходные факты» (в т.ч. после выбора педагога из дрилла) */
  const [excelFactsOpen, setExcelFactsOpen] = useState(false);
  /** Подписи из ячеек: по умолчанию только часть до «//» (рус.), иначе часть после «//». */
  const [showEnglishExcelLabels, setShowEnglishExcelLabels] = useState(false);
  /** Сообщение, если при анализе отсечена служебная колонка времени */
  const [serviceStripNote, setServiceStripNote] = useState<string | null>(null);
  const [summaryNarrative, setSummaryNarrative] = useState<string | null>(null);
  const [summaryNarrativeLoading, setSummaryNarrativeLoading] = useState(false);
  const [summaryNarrativeWords, setSummaryNarrativeWords] = useState<number | null>(null);
  const [summaryNarrativeApiHint, setSummaryNarrativeApiHint] = useState<string | null>(null);

  /** ИИ: альтернативная группировка разделов боковой панели (поверх авто). */
  const [aiSectionLayout, setAiSectionLayout] = useState<ExcelFilterSectionPlan[] | null>(null);
  const [aiSectionsBusy, setAiSectionsBusy] = useState(false);
  const [aiSectionsHint, setAiSectionsHint] = useState<string | null>(null);
  /** null = ждём ответ ИИ по опросным столбцам; иначе подмножество кандидатов. */
  const [aiSurveyFilterKeys, setAiSurveyFilterKeys] = useState<string[] | null>(null);
  /** ИИ: сырое значение → каноническая метка по ключу фильтра. */
  const [aiCanonicalMapsByKey, setAiCanonicalMapsByKey] = useState<Record<string, Record<string, string>>>({});
  /** ИИ: иерархия групп значений по ключу фильтра. */
  const [aiHierarchyByKey, setAiHierarchyByKey] = useState<
    Record<string, { id: string; label: string; parentId: string | null; values: string[] }[]>
  >({});
  const [aiAssistNlQuery, setAiAssistNlQuery] = useState('');
  const [aiAssistExplain, setAiAssistExplain] = useState<string | null>(null);
  const [aiAssistChartInterpret, setAiAssistChartInterpret] = useState<string | null>(null);
  const [aiAssistChartAnomalies, setAiAssistChartAnomalies] = useState<string | null>(null);
  const [aiAssistChartSpec, setAiAssistChartSpec] = useState<string | null>(null);
  const [aiAssistChartQuery, setAiAssistChartQuery] = useState('');
  const [aiAssistBusy, setAiAssistBusy] = useState(false);
  const [aiAssistHint, setAiAssistHint] = useState<string | null>(null);
  const [aiNormalizeTargetKey, setAiNormalizeTargetKey] = useState<string | null>(null);
  const [aiHierarchyTargetKey, setAiHierarchyTargetKey] = useState<string | null>(null);
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

  /** ИИ: производные измерения среза (маппинг значения базовой колонки → группа). */
  const [aiDerivedDimensions, setAiDerivedDimensions] = useState<ExcelDerivedFilterDimension[]>([]);
  const [aiDerivedBusy, setAiDerivedBusy] = useState(false);
  const [aiDerivedHint, setAiDerivedHint] = useState<string | null>(null);
  const [derivedSourceKey, setDerivedSourceKey] = useState<string | null>(null);

  /** Педагог для блоков «список через запятую»: покрытие X из Y и топ отметок. */
  const [listFeatureMentorPick, setListFeatureMentorPick] = useState('');

  const refreshExcelProjects = useCallback(async () => {
    setExcelProjectsLoading(true);
    setExcelProjectsError(null);
    try {
      const list = await listExcelAnalyticsProjects();
      setExcelProjects(list);
    } catch (e) {
      setExcelProjectsError(e instanceof Error ? e.message : 'Не удалось загрузить список проектов');
      setExcelProjects([]);
    } finally {
      setExcelProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshExcelProjects();
  }, [refreshExcelProjects]);

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        const fp = fileFingerprintFromFile(f);
        const pending = pendingServerSessionRef.current;
        if (pending && fp !== pending.fingerprint) {
          pendingServerSessionRef.current = null;
          pendingOpenProjectIdRef.current = null;
          setPendingServerSession(null);
          setPendingOpenProjectId(null);
          setOpenProjectHint(null);
        }
        let nextSheet = meta.sheetNames[0] ?? '';
        let nextHeaderRow = headerRow1Based;
        if (pending && fp === pending.fingerprint) {
          if (meta.sheetNames.includes(pending.sheet)) nextSheet = pending.sheet;
          nextHeaderRow = pending.headerRow1Based;
        }
        setBuffer(buf);
        setFileFingerprint(fp);
        setLinkedProjectId(null);
        setSessionRestoreNote(null);
        setFilterPanelHiddenKeys([]);
        setFileName(f.name);
        setSheetNames(meta.sheetNames);
        setSheet(nextSheet);
        setHeaderRow1Based(nextHeaderRow);
        setHeaders([]);
        setRawRows([]);
        setRoles([]);
        setAnalyticRows([]);
        setAiSurveyFilterKeys(null);
        setAiSectionLayout(null);
        setAiDerivedDimensions([]);
        setAiDerivedHint(null);
        setDerivedSourceKey(null);
        setFilterSelection({});
        setServiceStripNote(null);
        setSummaryNarrative(null);
        setSummaryNarrativeLoading(false);
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : 'Не удалось прочитать файл');
      }
    },
    [headerRow1Based],
  );

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

  const rowsAfterDerived = useMemo(
    () => applyDerivedDimensionsToRows(analyticRows, aiDerivedDimensions),
    [analyticRows, aiDerivedDimensions],
  );

  const dashboardRows = useMemo(
    () => applyCanonicalMapsToRows(rowsAfterDerived, aiCanonicalMapsByKey),
    [rowsAfterDerived, aiCanonicalMapsByKey],
  );

  const filterPanelHiddenSet = useMemo(() => new Set(filterPanelHiddenKeys), [filterPanelHiddenKeys]);

  /** Скрытые измерения не участвуют в отборе строк (как «все значения»). */
  const effectiveFilterSelection = useMemo(() => {
    const out: FilterSelection = { ...filterSelection };
    for (const k of filterPanelHiddenSet) {
      out[k] = null;
    }
    return out;
  }, [filterSelection, filterPanelHiddenSet]);

  const structuralFilterKeys = useMemo(
    () => listStructuralFilterKeys(roles, customLabels, aiDerivedDimensions),
    [roles, customLabels, aiDerivedDimensions],
  );

  const surveyCandidateFilterKeys = useMemo(() => listSurveyCandidateFilterKeys(roles), [roles]);

  const filterKeys = useMemo(() => {
    const survey =
      aiSurveyFilterKeys !== null ? aiSurveyFilterKeys : ([] as string[]);
    return [...structuralFilterKeys, ...survey];
  }, [structuralFilterKeys, aiSurveyFilterKeys]);

  /** Только актуальные измерения среза; устаревшие ключи в объекте selection игнорируются. */
  const sliceFilterSelection = useMemo((): FilterSelection => {
    const out: FilterSelection = {};
    for (const k of filterKeys) {
      out[k] = effectiveFilterSelection[k] ?? null;
    }
    return out;
  }, [filterKeys, effectiveFilterSelection]);

  const filteredRows = useMemo(() => {
    return applyFilters(dashboardRows, sliceFilterSelection);
  }, [dashboardRows, sliceFilterSelection]);

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

  /** Уникальные строки импорта (idx) в срезе — совпадает с ожидаемым числом записей в таблице Excel. */
  const kpiLessons = useMemo(() => countUniqueImportRows(filteredRows), [filteredRows]);
  const kpiImportRowsTotal = useMemo(() => countUniqueImportRows(dashboardRows), [dashboardRows]);
  /** События по смыслу (дата + подпись + срезы без наставника/опроса); больше строк импорта, если в фильтрах мультизначения. */
  const kpiLessonSemanticsFiltered = useMemo(
    () => countUniqueLessonSemantics(filteredRows, teacherFilterKey),
    [filteredRows, teacherFilterKey],
  );
  const kpiLessonSemanticsTotal = useMemo(
    () => countUniqueLessonSemantics(dashboardRows, teacherFilterKey),
    [dashboardRows, teacherFilterKey],
  );

  const kpiMentors = useMemo(() => {
    if (!teacherFilterKey) return 0;
    return uniqueFilterValues(filteredRows, teacherFilterKey).filter((x) => x !== '(не указано)').length;
  }, [filteredRows, teacherFilterKey]);

  const eligibleDerivedSourceKeys = useMemo(() => {
    const cand = new Set([...structuralFilterKeys, ...surveyCandidateFilterKeys]);
    return [...cand].filter(
      (k) => k !== PULSE_ORDINAL_LEVEL_KEY && !k.startsWith(PULSE_AI_DIM_PREFIX),
    );
  }, [structuralFilterKeys, surveyCandidateFilterKeys]);

  useEffect(() => {
    if (!eligibleDerivedSourceKeys.length) {
      setDerivedSourceKey(null);
      return;
    }
    setDerivedSourceKey((prev) =>
      prev && eligibleDerivedSourceKeys.includes(prev) ? prev : eligibleDerivedSourceKeys[0],
    );
  }, [eligibleDerivedSourceKeys]);

  const filterColumnDescriptorsAll = useMemo((): FilterColumnForSections[] => {
    const base: FilterColumnForSections[] = [];
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i];
      if (r === 'ignore' || r === 'date') continue;
      if (isFilterRole(r)) {
        base.push({
          filterKey: filterKeyForRole(r, customLabels),
          role: r,
          header: headers[i] || '',
          colIndex: i,
        });
        if (r === 'filter_class' && !roles.includes('filter_parallel')) {
          base.push({
            filterKey: PULSE_PARALLEL_AUTO_KEY,
            role: 'filter_parallel',
            header: 'Параллель (из класса: 7А, 7B → 7)',
            colIndex: -1,
          });
        }
      } else if (shouldExposePulseSurveyFilterCandidate(r)) {
        base.push({
          filterKey: pulseSurveyColKey(i),
          role: 'filter_custom_1',
          header: headers[i] || `Колонка ${i + 1}`,
          colIndex: i,
        });
      }
    }
    const oci = roles.indexOf('metric_ordinal_text');
    if (oci >= 0) {
      base.push({
        filterKey: PULSE_ORDINAL_LEVEL_KEY,
        role: 'filter_custom_1',
        header: headers[oci] || 'Текстовая шкала',
        colIndex: oci,
      });
    }
    aiDerivedDimensions.forEach((d, i) => {
      base.push({
        filterKey: d.id,
        role: 'filter_custom_1',
        header: d.title,
        colIndex: 2000 + i,
      });
    });
    return base;
  }, [roles, headers, customLabels, aiDerivedDimensions]);

  const filterSectionColumns = useMemo((): FilterColumnForSections[] => {
    const active = new Set(filterKeys);
    return filterColumnDescriptorsAll.filter((c) => active.has(c.filterKey));
  }, [filterColumnDescriptorsAll, filterKeys]);

  const autoFilterSections = useMemo(() => buildAutoFilterSections(filterSectionColumns), [filterSectionColumns]);
  const filterSections = aiSectionLayout ?? autoFilterSections;

  const filterKeysForPanel = useMemo(
    () => filterKeys.filter((k) => !filterPanelHiddenSet.has(k)),
    [filterKeys, filterPanelHiddenSet],
  );

  /** Сколько измерений в панели сужены (выбран не весь список значений). */
  const narrowingFilterDimensionsCount = useMemo(() => {
    let n = 0;
    for (const k of filterKeysForPanel) {
      const s = sliceFilterSelection[k];
      if (s != null && Array.isArray(s) && s.length > 0) n += 1;
    }
    return n;
  }, [filterKeysForPanel, sliceFilterSelection]);

  const filterSectionsForDisplay = useMemo(
    () =>
      filterSections
        .map((section) => ({
          ...section,
          keys: section.keys.filter((k) => !filterPanelHiddenSet.has(k)),
        }))
        .filter((section) => section.keys.length > 0),
    [filterSections, filterPanelHiddenSet],
  );

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
    if (roles.includes('metric_ordinal_text')) {
      const oci = roles.indexOf('metric_ordinal_text');
      m[PULSE_ORDINAL_LEVEL_KEY] = headers[oci]?.trim() || 'Текстовая шкала';
    }
    for (const d of aiDerivedDimensions) {
      m[d.id] = d.title;
    }
    roles.forEach((r, i) => {
      if (!shouldExposePulseSurveyFilterCandidate(r)) return;
      m[pulseSurveyColKey(i)] = headers[i]?.trim() || `Колонка ${i + 1}`;
    });
    return m;
  }, [roles, headers, customLabels, aiDerivedDimensions]);

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
    for (const k of filterKeysForPanel) {
      const sel = sliceFilterSelection[k];
      const label = filterKeyDisplayLabelUi[k] ?? k;
      if (sel === null) {
        rows.push({ label, value: 'Все значения' });
      } else if (Array.isArray(sel)) {
        if (sel.length === 0) rows.push({ label, value: 'Нет (срез по столбцу пуст)' });
        else rows.push({ label, value: sel.map((x) => formatBilingualCellLabel(x, mode)).join('; ') });
      }
    }
    return rows;
  }, [filterKeysForPanel, sliceFilterSelection, filterKeyDisplayLabelUi, showEnglishExcelLabels]);

  const filterSnapshotAllOpen = useMemo(
    () => filterSnapshotRows.length > 0 && filterSnapshotRows.every((r) => r.value === 'Все значения'),
    [filterSnapshotRows],
  );

  const singleTeacherFilterName = useMemo(() => {
    if (!teacherFilterKey) return null;
    const s = sliceFilterSelection[teacherFilterKey];
    if (Array.isArray(s) && s.length === 1) return s[0];
    return null;
  }, [teacherFilterKey, sliceFilterSelection]);

  /** Текст для ИИ: фильтры = параметры среза. */
  const filterParameterSummaryRu = useMemo(() => {
    if (!dashboardRows.length) return '';
    const lines: string[] = [];
    lines.push(`Файл: ${fileName || '—'}, лист: ${sheet || '—'}`);
    lines.push(
      `Объём среза: ${kpiLessons} строк импорта Excel (уникальные записи); ${filteredRows.length} аналитических строк («точки») после развёртки мультизначений в ячейках; по смыслу (дата+подпись+срезы): ${kpiLessonSemanticsFiltered}.`,
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
    dashboardRows.length,
    fileName,
    sheet,
    kpiLessons,
    kpiLessonSemanticsFiltered,
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

  const detailTableSlice = useMemo(
    () => filteredRows.slice(0, DETAIL_TABLE_MAX_ROWS),
    [filteredRows],
  );

  const detailColumnCount = useMemo(() => {
    let m = headers.length;
    for (const r of detailTableSlice) {
      const L = rawRows[r.idx]?.length ?? 0;
      if (L > m) m = L;
    }
    return Math.max(m, 0);
  }, [headers.length, rawRows, detailTableSlice]);

  const detailShowSplitColumn = useMemo(
    () => filteredRows.some((r) => r.splitPart != null && r.splitPart > 0),
    [filteredRows],
  );

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

  const ordinalDrillTeachers = useMemo(() => {
    if (!ordinalDrill || !teacherFilterKey) return [];
    return teachersAtOrdinalRank(filteredRowsOnePerLesson, teacherFilterKey, ordinalDrill.rank);
  }, [ordinalDrill, teacherFilterKey, filteredRowsOnePerLesson]);

  const chartDrillOpen = Boolean(teacherFilterKey && (metricDrill || ordinalDrill));

  const closeChartDrill = useCallback(() => {
    setMetricDrill(null);
    setOrdinalDrill(null);
  }, []);

  const ordinalScaleColIndex = roles.indexOf('metric_ordinal_text');
  const ordinalScaleHeaderUi = useMemo(
    () =>
      ordinalScaleColIndex >= 0
        ? formatBilingualCellLabel(
            headers[ordinalScaleColIndex] ?? 'Текстовая шкала',
            showEnglishExcelLabels ? 'en' : 'ru',
          )
        : 'Текстовая шкала',
    [ordinalScaleColIndex, headers, showEnglishExcelLabels],
  );

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

  const allFilterDistributionCharts = useMemo(() => {
    const mode = showEnglishExcelLabels ? 'en' : 'ru';
    return filterKeysForPanel.map((key) => {
      const label = filterKeyDisplayLabelUi[key] ?? key;
      const rawBars = topFilterBucketsByUniqueLesson(filteredRows, key, 10, teacherFilterKey);
      const bars = rawBars.map((b) => {
        const full = formatBilingualCellLabel(b.display, mode);
        return {
          short: full.length > 28 ? `${full.slice(0, 25)}…` : full,
          fullName: full,
          uniqueLessons: b.uniqueLessons,
        };
      });
      return { key, label, bars };
    });
  }, [filterKeysForPanel, filteredRows, teacherFilterKey, filterKeyDisplayLabelUi, showEnglishExcelLabels]);

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
    if (!dashboardRows.length) return '';
    const di = roles.indexOf('date');
    return buildQuickSummaryRu(dashboardRows, filteredRows, {
      hasTeacherFilter: roles.includes('filter_teacher_code'),
      mentorFilterKey: teacherFilterKey,
      dateLabel: di >= 0 ? headers[di] : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
    });
  }, [dashboardRows, filteredRows, roles, headers, numericMetricsForSummary, teacherFilterKey]);

  /** Развёрнутая фактическая база для ИИ (срезы, шкала, шифры, больше цитат) — как вход для «комплексного отчёта». */
  const richLlmContext = useMemo(() => {
    if (!dashboardRows.length) return '';
    const di = roles.indexOf('date');
    return buildRichLlmContextRu(dashboardRows, filteredRows, {
      dateLabel: di >= 0 ? headers[di] : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
      ordinalLevels,
      teacherFilterKey,
      filterKeys: filterKeysForPanel,
      filterLabels: filterKeyDisplayLabel,
    });
  }, [
    dashboardRows,
    filteredRows,
    roles,
    headers,
    numericMetricsForSummary,
    ordinalLevels,
    teacherFilterKey,
    filterKeysForPanel,
    filterKeyDisplayLabel,
  ]);

  /** Варианты по каждому фильтру с учётом уже выбранных остальных (каскад / логическая цепочка). */
  const pulseFacetOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const k of filterKeysForPanel) {
      const base = applyFiltersExceptKey(dashboardRows, sliceFilterSelection, k);
      m[k] = uniqueFilterValues(base, k).slice(0, 72);
    }
    return m;
  }, [filterKeysForPanel, dashboardRows, sliceFilterSelection]);

  const pulseFiltersForChat = useMemo(() => {
    const out: FilterSelection = {};
    for (const k of filterKeysForPanel) {
      out[k] = sliceFilterSelection[k] ?? null;
    }
    return out;
  }, [filterKeysForPanel, sliceFilterSelection]);

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
    if (roles.includes('metric_ordinal_text')) {
      const oci = roles.indexOf('metric_ordinal_text');
      m[PULSE_ORDINAL_LEVEL_KEY] = headers[oci] || 'Текстовая шкала';
    }
    for (const d of aiDerivedDimensions) {
      m[d.id] = d.title;
    }
    roles.forEach((r, i) => {
      if (!shouldExposePulseSurveyFilterCandidate(r)) return;
      m[pulseSurveyColKey(i)] = headers[i] || `Колонка ${i + 1}`;
    });
    return m;
  }, [roles, customLabels, headers, aiDerivedDimensions]);

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
        return pruneFilterSelection(dashboardRows, draft, filterKeys);
      });
    },
    [dashboardRows, filterKeys],
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
    setOrdinalDrill(null);
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
    if (!dashboardRows.length || !filterKeys.length) return;
    setFilterSelection((prev) => {
      const next = pruneFilterSelection(dashboardRows, prev, filterKeys);
      return filterSelectionsEqual(prev, next, filterKeys) ? prev : next;
    });
  }, [dashboardRows, filterKeysSig]);

  useEffect(() => {
    if (!filterKeys.length) return;
    setFilterPanelHiddenKeys((prev) => {
      const next = prev.filter((k) => filterKeys.includes(k));
      return next.length === prev.length ? prev : next;
    });
  }, [filterKeysSig]);

  /** Пустой срез — убираем ИИ-разметку (при новом «Построить» сброс делается в runAnalysis). */
  useEffect(() => {
    if (analyticRows.length) return;
    setAiSurveyFilterKeys(null);
    setAiSectionLayout(null);
    setAiSectionsHint(null);
    setAiCanonicalMapsByKey({});
    setAiHierarchyByKey({});
    setFacetGroupsByKey({});
    setFacetGroupsHint(null);
    setAiDerivedDimensions([]);
    setAiDerivedHint(null);
    setDerivedSourceKey(null);
  }, [analyticRows.length]);

  useEffect(() => {
    setMetricDrill(null);
    setOrdinalDrill(null);
  }, [metricPickIndex]);

  /** Не прокручиваем к панели дрилла автоматически — мешает при работе с фильтрами выше по странице. */

  /** Смена среза — сбрасываем записи для директора (нужно сформировать заново). */
  useEffect(() => {
    setDirectorDossier(null);
    setDirectorDossierHint(null);
    setDirectorDossierMeta(null);
  }, [analyticRows, filterSelection]);

  const runAiFilterSectionsFor = useCallback(
    async (
      rows: AnalyticRow[],
      rolesArg: ColumnRole[],
      prevSelection: FilterSelection,
      structuralKeysArg: string[],
      surveyCandidateKeysArg: string[],
      derivedDims: ExcelDerivedFilterDimension[],
    ): Promise<{ fullKeys: string[]; mergedSelection: FilterSelection } | null> => {
      if (!rows.length) return null;
      setAiSectionsBusy(true);
      setAiSectionsHint(null);
      const unionKeys = [...new Set([...structuralKeysArg, ...surveyCandidateKeysArg])];
      try {
        const columns: {
          filterKey: string;
          role: string;
          roleLabel: string;
          header: string;
          samples: string[];
        }[] = [];
        for (let i = 0; i < rolesArg.length; i++) {
          const r = rolesArg[i];
          if (!isFilterRole(r)) continue;
          const fk = filterKeyForRole(r, customLabels);
          if (!unionKeys.includes(fk)) continue;
          const base = applyFiltersExceptKey(rows, prevSelection, fk);
          columns.push({
            filterKey: fk,
            role: r,
            roleLabel: COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r,
            header: headers[i] || fk,
            samples: uniqueFilterValues(base, fk).slice(0, 14),
          });
        }
        if (unionKeys.includes(PULSE_PARALLEL_AUTO_KEY) && !columns.some((c) => c.filterKey === PULSE_PARALLEL_AUTO_KEY)) {
          const baseP = applyFiltersExceptKey(rows, prevSelection, PULSE_PARALLEL_AUTO_KEY);
          columns.push({
            filterKey: PULSE_PARALLEL_AUTO_KEY,
            role: 'filter_parallel',
            roleLabel: 'Параллель (из класса)',
            header: 'Параллель (из класса)',
            samples: uniqueFilterValues(baseP, PULSE_PARALLEL_AUTO_KEY).slice(0, 14),
          });
        }
        if (unionKeys.includes(PULSE_ORDINAL_LEVEL_KEY)) {
          const oci = rolesArg.indexOf('metric_ordinal_text');
          const baseOrd = applyFiltersExceptKey(rows, prevSelection, PULSE_ORDINAL_LEVEL_KEY);
          columns.push({
            filterKey: PULSE_ORDINAL_LEVEL_KEY,
            role: 'metric_ordinal_text',
            roleLabel: 'Текстовая шкала',
            header: oci >= 0 ? headers[oci] || PULSE_ORDINAL_LEVEL_KEY : PULSE_ORDINAL_LEVEL_KEY,
            samples: uniqueFilterValues(baseOrd, PULSE_ORDINAL_LEVEL_KEY).slice(0, 14),
          });
        }
        for (const d of derivedDims) {
          if (!unionKeys.includes(d.id)) continue;
          const baseD = applyFiltersExceptKey(rows, prevSelection, d.id);
          columns.push({
            filterKey: d.id,
            role: 'filter_custom_1',
            roleLabel: 'Смысловая группа (ИИ)',
            header: d.title,
            samples: uniqueFilterValues(baseD, d.id).slice(0, 14),
          });
        }
        for (const k of surveyCandidateKeysArg) {
          const sm = /^__pulse_survey_col_(\d+)$/.exec(k);
          if (!sm) continue;
          const ci = Number(sm[1]);
          const baseS = applyFiltersExceptKey(rows, prevSelection, k);
          columns.push({
            filterKey: k,
            role: rolesArg[ci] ?? 'filter_custom_1',
            roleLabel: 'Поле опроса (кандидат)',
            header: headers[ci] || k,
            samples: uniqueFilterValues(baseS, k).slice(0, 14),
          });
        }

        const res = await postExcelFilterSections({
          structuralKeys: structuralKeysArg,
          surveyCandidateKeys: surveyCandidateKeysArg,
          columns,
        });

        const surveyPick = Array.isArray(res.surveyFilterKeys) ? res.surveyFilterKeys : surveyCandidateKeysArg;
        setAiSurveyFilterKeys(surveyPick);

        const fullKeys = [...structuralKeysArg, ...surveyPick];
        const mergedSelection: FilterSelection = {};
        for (const k of fullKeys) {
          const prev = prevSelection[k];
          mergedSelection[k] = prev !== undefined ? prev : null;
        }
        for (const k of Object.keys(mergedSelection)) {
          if (!fullKeys.includes(k)) delete mergedSelection[k];
        }
        setFilterSelection(mergedSelection);

        if (res.sections?.length) {
          setAiSectionLayout(res.sections);
          if (res.source === 'llm') {
            setAiSectionsHint(null);
          } else {
            setAiSectionsHint(
              res.hint?.trim() ||
                'Показаны все кандидаты опроса: ИИ недоступен или вернул запасной вариант.',
            );
          }
        } else {
          setAiSectionLayout(null);
          setAiSectionsHint(
            res.hint?.trim() || 'Модель не вернула разделы. Повторите запрос позже или обратитесь к администратору.',
          );
        }

        return { fullKeys, mergedSelection };
      } catch (e) {
        setAiSurveyFilterKeys(surveyCandidateKeysArg);
        const fullKeys = [...structuralKeysArg, ...surveyCandidateKeysArg];
        const mergedSelection: FilterSelection = {};
        for (const k of fullKeys) {
          const prev = prevSelection[k];
          mergedSelection[k] = prev !== undefined ? prev : null;
        }
        setFilterSelection(mergedSelection);
        setAiSectionsHint(e instanceof Error ? e.message : 'Не удалось запросить ИИ');
        setAiSectionLayout(null);
        return { fullKeys, mergedSelection };
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
    if (!dashboardRows.length) return;
    const structural = listStructuralFilterKeys(roles, customLabels, aiDerivedDimensions);
    const surveyCand = listSurveyCandidateFilterKeys(roles);
    void (async () => {
      const out = await runAiFilterSectionsFor(
        dashboardRows,
        roles,
        sliceFilterSelection,
        structural,
        surveyCand,
        aiDerivedDimensions,
      );
      if (out) {
        const labelsM = buildFilterKeyLabels(roles, headers, customLabels);
        await runAiValueGroupsFor(
          dashboardRows,
          out.mergedSelection,
          out.fullKeys,
          labelsM,
        );
      }
    })();
  }, [
    runAiFilterSectionsFor,
    runAiValueGroupsFor,
    dashboardRows,
    roles,
    sliceFilterSelection,
    customLabels,
    aiDerivedDimensions,
    headers,
  ]);

  const fetchAiValueGroups = useCallback(() => {
    void runAiValueGroupsFor(dashboardRows, sliceFilterSelection, filterKeys, filterKeyDisplayLabel);
  }, [runAiValueGroupsFor, dashboardRows, sliceFilterSelection, filterKeys, filterKeyDisplayLabel]);

  const fetchAiDerivedFilters = useCallback(async () => {
    if (!derivedSourceKey || !dashboardRows.length) {
      setAiDerivedHint('Выберите колонку-источник для группировки.');
      return;
    }
    const vals = uniqueFilterValues(dashboardRows, derivedSourceKey).filter((x) => x !== '(не указано)');
    if (vals.length < 4) {
      setAiDerivedHint('Нужно минимум 4 различных значения в колонке (кроме «не указано»).');
      return;
    }
    setAiDerivedBusy(true);
    setAiDerivedHint(null);
    try {
      const res = await postExcelDerivedFilters({
        sourceFilterKey: derivedSourceKey,
        sourceHeader: filterKeyDisplayLabel[derivedSourceKey] ?? derivedSourceKey,
        values: vals.slice(0, 220),
      });
      if (res.source === 'llm' && res.dimensions?.length) {
        const newDims: ExcelDerivedFilterDimension[] = res.dimensions.map((d) => ({
          id: newAiDerivedDimensionId(d.title),
          title: d.title.trim(),
          sourceFilterKey: derivedSourceKey,
          assignments: d.assignments,
        }));
        setAiDerivedDimensions((prev) => [...prev, ...newDims]);
        setFilterSelection((prev) => {
          const n = { ...prev };
          for (const d of newDims) n[d.id] = null;
          return n;
        });
      } else {
        setAiDerivedHint(res.hint?.trim() || 'Модель не вернула измерения.');
      }
    } catch (e) {
      setAiDerivedHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiDerivedBusy(false);
    }
  }, [derivedSourceKey, dashboardRows, filterKeyDisplayLabel]);

  useEffect(() => {
    if (!filterKeys.length) {
      setAiNormalizeTargetKey(null);
      setAiHierarchyTargetKey(null);
      return;
    }
    setAiNormalizeTargetKey((prev) => (prev && filterKeys.includes(prev) ? prev : filterKeys[0]));
    setAiHierarchyTargetKey((prev) => (prev && filterKeys.includes(prev) ? prev : filterKeys[0]));
  }, [filterKeys]);

  const runAiNlSlice = useCallback(async () => {
    const q = aiAssistNlQuery.trim();
    if (!q || !dashboardRows.length) {
      setAiAssistHint('Введите запрос на естественном языке.');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const currentFilters = Object.fromEntries(
        filterKeysForPanel.map((k) => [k, sliceFilterSelection[k] ?? null]),
      ) as Record<string, string[] | null>;
      const res = await postExcelDashboardAi({
        action: 'nl_slice',
        query: q,
        facetOptions: pulseFacetOptions,
        facetLabels: pulseFacetLabels,
        currentFilters,
      });
      if (res.apply_filters && Object.keys(res.apply_filters).length) {
        setFilterSelection((prev) => {
          const next = { ...prev };
          for (const [k, arr] of Object.entries(res.apply_filters!)) {
            if (filterKeys.includes(k) && filterKeysForPanel.includes(k)) next[k] = [...arr];
          }
          return pruneFilterSelection(dashboardRows, next, filterKeys);
        });
      }
      setAiAssistHint(res.reply?.trim() || res.hint?.trim() || null);
    } catch (e) {
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [
    aiAssistNlQuery,
    dashboardRows,
    pulseFacetOptions,
    pulseFacetLabels,
    sliceFilterSelection,
    filterKeysForPanel,
    filterKeys,
  ]);

  const runAiExplainSlice = useCallback(async () => {
    if (!dashboardRows.length) return;
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const res = await postExcelDashboardAi({
        action: 'explain_slice',
        filterSnapshot: filterSnapshotRows,
        kpi: {
          lessons: kpiLessons,
          semanticLessons: kpiLessonSemanticsFiltered,
          rows: filteredRows.length,
          mentors: kpiMentors,
        },
        numericSummary: `${filterParameterSummaryRu}\n\n${quickText}`.slice(0, 24000),
      });
      setAiAssistExplain(res.explanation?.trim() || res.hint?.trim() || null);
    } catch (e) {
      setAiAssistExplain(null);
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [
    dashboardRows,
    filterSnapshotRows,
    kpiLessons,
    kpiLessonSemanticsFiltered,
    filteredRows.length,
    kpiMentors,
    filterParameterSummaryRu,
    quickText,
  ]);

  const runAiNormalizeColumn = useCallback(async () => {
    const key = aiNormalizeTargetKey;
    if (!key || !dashboardRows.length) return;
    const vals = uniqueFilterValues(dashboardRows, key).filter((x) => x !== '(не указано)');
    if (vals.length < 2) {
      setAiAssistHint('Нужно минимум 2 различных значения в этом измерении.');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const res = await postExcelDashboardAi({
        action: 'normalize_values',
        filterKey: key,
        header: filterKeyDisplayLabel[key] ?? key,
        values: vals.slice(0, 400),
      });
      if (res.canonicalMap && Object.keys(res.canonicalMap).length) {
        setAiCanonicalMapsByKey((prev) => ({ ...prev, [key]: res.canonicalMap! }));
        setAiAssistHint('Карта нормализации применена (значения в срезе объединены по смыслу).');
      } else {
        setAiAssistHint(res.hint?.trim() || 'Модель не вернула карту.');
      }
    } catch (e) {
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [aiNormalizeTargetKey, dashboardRows, filterKeyDisplayLabel]);

  const runAiHierarchyColumn = useCallback(async () => {
    const key = aiHierarchyTargetKey;
    if (!key || !dashboardRows.length) return;
    const vals = uniqueFilterValues(dashboardRows, key).filter((x) => x !== '(не указано)');
    if (vals.length < 4) {
      setAiAssistHint('Для иерархии нужно минимум 4 различных значения.');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const res = await postExcelDashboardAi({
        action: 'value_hierarchy',
        filterKey: key,
        header: filterKeyDisplayLabel[key] ?? key,
        values: vals.slice(0, 220),
      });
      if (res.groups?.length) {
        setAiHierarchyByKey((prev) => ({ ...prev, [key]: res.groups! }));
        setAiAssistHint('Иерархия групп для этого измерения обновлена.');
      } else {
        setAiAssistHint(res.hint?.trim() || 'Модель не вернула группы.');
      }
    } catch (e) {
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [aiHierarchyTargetKey, dashboardRows, filterKeyDisplayLabel]);

  const runAiChartInterpret = useCallback(async () => {
    const ch = allFilterDistributionCharts.find((c) => c.bars.length);
    if (!ch) {
      setAiAssistHint('Нет мини-графиков распределения по фильтрам.');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const series = ch.bars.map((b) => ({ name: b.fullName, value: b.uniqueLessons }));
      const res = await postExcelDashboardAi({
        action: 'chart_interpret',
        chartTitle: ch.label,
        series,
      });
      setAiAssistChartInterpret(res.insight?.trim() || res.hint?.trim() || null);
    } catch (e) {
      setAiAssistChartInterpret(null);
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [allFilterDistributionCharts]);

  const runAiChartAnomalies = useCallback(async () => {
    if (!allFilterDistributionCharts.length) {
      setAiAssistHint('Нет данных для анализа.');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const aggregates = allFilterDistributionCharts.flatMap((ch) =>
        ch.bars.map((b) => ({
          chart: ch.label,
          label: b.fullName,
          uniqueLessons: b.uniqueLessons,
        })),
      );
      const res = await postExcelDashboardAi({
        action: 'chart_anomalies',
        aggregates,
      });
      const bullets = res.bullets?.filter(Boolean) ?? [];
      setAiAssistChartAnomalies(
        bullets.length ? `• ${bullets.join('\n• ')}` : res.hint?.trim() || null,
      );
    } catch (e) {
      setAiAssistChartAnomalies(null);
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [allFilterDistributionCharts]);

  const runAiChartSpec = useCallback(async () => {
    const q = aiAssistChartQuery.trim();
    if (!q) {
      setAiAssistHint('Введите вопрос (например: где сравнить средние по предметам).');
      return;
    }
    setAiAssistBusy(true);
    setAiAssistHint(null);
    try {
      const metricLabels = metricNumericCols.map((i) => headers[i] || `Колонка ${i + 1}`);
      const res = await postExcelDashboardAi({
        action: 'chart_spec',
        query: q,
        filterKeys,
        metricLabels,
      });
      const parts: string[] = [];
      if (res.recommendation?.trim()) parts.push(res.recommendation.trim());
      if (res.focusFilterKey) {
        parts.push(
          `Фокус: фильтр «${filterKeyDisplayLabel[res.focusFilterKey] ?? res.focusFilterKey}» (прокрутка к мини-графику).`,
        );
      }
      if (res.focusMetricLabel) parts.push(`Метрика: ${res.focusMetricLabel}`);
      setAiAssistChartSpec(parts.join('\n\n') || res.hint?.trim() || null);
      if (res.focusFilterKey) {
        requestAnimationFrame(() =>
          document
            .getElementById(`excel-chart-focus-${res.focusFilterKey}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        );
      }
    } catch (e) {
      setAiAssistChartSpec(null);
      setAiAssistHint(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setAiAssistBusy(false);
    }
  }, [aiAssistChartQuery, filterKeys, metricNumericCols, headers, filterKeyDisplayLabel]);

  const executeAnalysis = useCallback(
    (
      h: string[],
      matrixRows: CellPrimitive[][],
      rolesInput: ColumnRole[],
      ordinalInput: string[],
      opts?: { restoreFilterSelection?: FilterSelection },
    ) => {
      const v = validateRoles(rolesInput);
      if (!v.ok) {
        setErr(v.message ?? 'Проверьте маппинг');
        return;
      }
      const ordCol = rolesInput.indexOf('metric_ordinal_text');
      if (ordCol >= 0 && ordinalInput.length === 0) {
        setErr('Для текстовой шкалы задайте порядок уровней (или нажмите «Подставить из данных»).');
        return;
      }

      const { roles: rolesForRun, strippedIndex } = applyServiceTimestampIgnore(h, matrixRows, rolesInput);
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
      setAiSurveyFilterKeys(null);
      setAiSectionLayout(null);
      setAiSectionsHint(null);
      setFacetGroupsByKey({});
      setFacetGroupsHint(null);
      setAiCanonicalMapsByKey({});
      setAiHierarchyByKey({});
      setAiAssistNlQuery('');
      setAiAssistExplain(null);
      setAiAssistChartInterpret(null);
      setAiAssistChartAnomalies(null);
      setAiAssistChartSpec(null);
      setAiAssistChartQuery('');
      setAiAssistHint(null);
      setAiDerivedDimensions([]);
      setAiDerivedHint(null);
      setMetricDrill(null);
      setOrdinalDrill(null);
      setExcelFactsOpen(false);

      if (strippedIndex != null) {
        setServiceStripNote(
          `Столбец «${h[strippedIndex] || strippedIndex + 1}» распознан как служебная метка времени (например, момент голосования) и исключён из анализа. Роли колонок обновлены.`,
        );
      } else {
        setServiceStripNote(null);
      }

      if (rolesForRun.some((r, i) => r !== rolesInput[i])) {
        setRoles(rolesForRun);
      }

      let built = buildAnalyticRows(h, matrixRows, rolesForRun, customLabels, ordinalInput);
      built = expandRowsForMultiValueFilterColumns(built, rolesForRun, customLabels);
      built = augmentRowsWithDerivedParallel(built, rolesForRun, customLabels);
      built = expandRowsForPulseSurveyMultiSelect(built, rolesForRun);
      built = collapseSimilarFilterDimensionValues(built, rolesForRun, customLabels);
      setAnalyticRows(built);

      const structural = listStructuralFilterKeys(rolesForRun, customLabels, []);
      const surveyCand = listSurveyCandidateFilterKeys(rolesForRun);
      const restore = opts?.restoreFilterSelection;
      const sel: FilterSelection = {};
      structural.forEach((k) => {
        sel[k] = restore?.[k] ?? null;
      });
      const prevForAi: FilterSelection = { ...(restore || {}), ...sel };
      structural.forEach((k) => {
        prevForAi[k] = restore?.[k] ?? null;
      });
      setFilterSelection(sel);

      const firstMetric =
        rolesForRun.map((r, i) => (r === 'metric_numeric' ? i : -1)).find((i) => i >= 0) ?? null;
      setMetricPickIndex(firstMetric);

      const labelsM = buildFilterKeyLabels(rolesForRun, h, customLabels);
      void (async () => {
        const out = await runAiFilterSectionsFor(
          built,
          rolesForRun,
          prevForAi,
          structural,
          surveyCand,
          [],
        );
        if (out) {
          await runAiValueGroupsFor(built, out.mergedSelection, out.fullKeys, labelsM);
        }
      })();
    },
    [customLabels, runAiFilterSectionsFor, runAiValueGroupsFor],
  );

  const runAnalysis = useCallback(() => {
    executeAnalysis(headers, rawRows, roles, ordinalLevels);
  }, [executeAnalysis, headers, rawRows, roles, ordinalLevels]);

  const reSuggestAndRun = useCallback(() => {
    if (!headers.length) return;
    const s = suggestColumnRoles(headers, rawRows);
    const oc = s.indexOf('metric_ordinal_text');
    const ord = oc >= 0 ? collectOrdinalValues(rawRows, oc) : [];
    setRoles(s);
    setOrdinalLevels(ord);
    executeAnalysis(headers, rawRows, s, ord);
  }, [headers, rawRows, executeAnalysis]);

  const onApplySheet = () => {
    if (!buffer || !sheet) return;
    setErr(null);
    try {
      const matrix = getSheetMatrix(buffer, sheet);
      const { headers: h, rows } = extractHeadersAndRows(matrix, headerRow1Based, MAX_ROWS);
      setHeaders(h);
      setRawRows(rows);
      setAnalyticRows([]);
      setAiSurveyFilterKeys(null);
      setAiDerivedDimensions([]);
      setAiDerivedHint(null);
      setDerivedSourceKey(null);
      setFilterSelection({});
      setServiceStripNote(null);
      setSummaryNarrative(null);
      setSummaryNarrativeLoading(false);
      setMetricPickIndex(null);
      setAiSectionLayout(null);
      setAiSectionsHint(null);
      setFacetGroupsByKey({});
      setFacetGroupsHint(null);
      setMetricDrill(null);
      setOrdinalDrill(null);
      setExcelFactsOpen(false);

      const snap = pendingServerSession;
      const saved: SavedExcelSession | null =
        fileFingerprint && snap && matchSessionForSheet(snap, fileFingerprint, sheet, headerRow1Based, h)
          ? snap
          : null;

      if (pendingServerSession && !saved) {
        pendingServerSessionRef.current = null;
        pendingOpenProjectIdRef.current = null;
        setPendingServerSession(null);
        setPendingOpenProjectId(null);
        setOpenProjectHint(null);
        setErr(
          'Лист или строка заголовков не совпадают с сохранённым проектом — строим схему заново. Проверьте лист и номер строки заголовков.',
        );
      }

      if (saved && saved.roles.length === h.length) {
        const vr = validateRoles(saved.roles);
        if (vr.ok) {
          const ordCol = saved.roles.indexOf('metric_ordinal_text');
          const ordFromSaved =
            ordCol >= 0 && saved.ordinalLevels.length > 0
              ? saved.ordinalLevels
              : ordCol >= 0
                ? collectOrdinalValues(rows, ordCol)
                : [];
          setCustomLabels(saved.customLabels ?? {});
          setRoles(saved.roles);
          setOrdinalLevels(ordFromSaved);
          setFilterPanelHiddenKeys(saved.filterPanelHiddenKeys ?? []);
          const openedId = pendingOpenProjectId;
          if (openedId != null) {
            setLinkedProjectId(openedId);
            setSessionRestoreNote(
              'Восстановлены маппинг, фильтры и скрытые измерения из сохранённого проекта на сервере.',
            );
          } else {
            setSessionRestoreNote(null);
          }
          pendingServerSessionRef.current = null;
          pendingOpenProjectIdRef.current = null;
          setPendingServerSession(null);
          setPendingOpenProjectId(null);
          setOpenProjectHint(null);
          executeAnalysis(h, rows, saved.roles, ordFromSaved, {
            restoreFilterSelection: saved.filterSelection ?? {},
          });
          return;
        }
      }

      setSessionRestoreNote(null);
      setFilterPanelHiddenKeys([]);
      const suggested = suggestColumnRoles(h, rows);
      const oc = suggested.indexOf('metric_ordinal_text');
      const ord = oc >= 0 ? collectOrdinalValues(rows, oc) : [];
      setRoles(suggested);
      setOrdinalLevels(ord);
      executeAnalysis(h, rows, suggested, ord);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Ошибка разбора листа');
    }
  };

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
      const hierarchy = aiHierarchyByKey[key];
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
                  return pruneFilterSelection(dashboardRows, updated, filterKeys);
                });
              }}
            />
            <span>{val}</span>
          </label>
        );
      };
      if (hierarchy?.length) {
        const childrenOf = (pid: string | null) =>
          hierarchy.filter((g) => (g.parentId ?? null) === pid);
        const renderH = (pid: string | null): ReactNode => {
          const nodes = childrenOf(pid);
          if (!nodes.length) return null;
          return nodes.map((g) => (
            <details key={g.id} className="excel-filter-value-group" open>
              <summary className="excel-filter-value-group-summary">
                {g.label}
                {g.values.length > 0 ? (
                  <span className="muted"> ({g.values.length})</span>
                ) : null}
              </summary>
              {g.values.length > 0 ? (
                <div className="excel-analytics-filter-chips excel-analytics-filter-chips--nested">
                  {g.values.map(chip)}
                </div>
              ) : null}
              <div className="excel-filter-hierarchy-nested">{renderH(g.id)}</div>
            </details>
          ));
        };
        return <div className="excel-filter-value-groups">{renderH(null)}</div>;
      }
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
    [filterSelection, facetGroupsByKey, aiHierarchyByKey, dashboardRows, filterKeys],
  );

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
        meta: {
          filteredRowCount: filteredRows.length,
          uniqueImportRows: kpiLessons,
          semanticLessonCount: kpiLessonSemanticsFiltered,
        },
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
            'Не удалось получить отчёт: нет связи с сервером или ответ прерван. Попробуйте обновить страницу и снова открыть блок отчёта.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSummaryNarrativeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    richLlmContext,
    pulseLlmExtraBundle,
    pulseFacetLabels,
    filteredRows.length,
    filterParameterSummaryRu,
    kpiLessons,
    kpiLessonSemanticsFiltered,
  ]);

  const openProjectFromList = useCallback(async (id: number) => {
    setErr(null);
    setOpenProjectBusyId(id);
    try {
      const p = await getExcelAnalyticsProject(id);
      // Refs синхронно: иначе при быстром выборе файла после «Открыть» onFile видит ещё пустой ref (useEffect позже).
      pendingServerSessionRef.current = p.session;
      pendingOpenProjectIdRef.current = p.id;
      setPendingServerSession(p.session);
      setPendingOpenProjectId(p.id);
      setOpenProjectHint(
        `Выберите файл «${p.file_name}» (или тот же по содержимому) и нажмите «Загрузить лист» — подтянем маппинг и срез с сервера.`,
      );
      requestAnimationFrame(() => {
        excelFileSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось открыть проект');
    } finally {
      setOpenProjectBusyId(null);
    }
  }, []);

  const removeProject = useCallback(
    async (id: number) => {
      try {
        await deleteExcelAnalyticsProject(id);
        setLinkedProjectId((cur) => (cur === id ? null : cur));
        if (pendingOpenProjectIdRef.current === id) {
          pendingServerSessionRef.current = null;
          pendingOpenProjectIdRef.current = null;
          setPendingServerSession(null);
          setPendingOpenProjectId(null);
          setOpenProjectHint(null);
        }
        await refreshExcelProjects();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Не удалось удалить проект');
      }
    },
    [refreshExcelProjects],
  );

  const saveCurrentProject = useCallback(async () => {
    if (!fileFingerprint || !fileName || !analyticRows.length) return;
    const title = saveProjectTitle.trim() || fileName;
    const session: SavedExcelSession = {
      v: 1,
      fingerprint: fileFingerprint,
      fileName,
      sheet,
      headerRow1Based,
      headers,
      roles,
      customLabels,
      ordinalLevels,
      filterSelection,
      filterPanelHiddenKeys,
    };
    setSaveProjectBusy(true);
    setErr(null);
    try {
      const proj = await saveExcelAnalyticsProject({
        title,
        session,
        id: linkedProjectId ?? undefined,
      });
      setLinkedProjectId(proj.id);
      setSaveProjectTitle(proj.title);
      await refreshExcelProjects();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить проект');
    } finally {
      setSaveProjectBusy(false);
    }
  }, [
    fileFingerprint,
    fileName,
    analyticRows.length,
    saveProjectTitle,
    sheet,
    headerRow1Based,
    headers,
    roles,
    customLabels,
    ordinalLevels,
    filterSelection,
    filterPanelHiddenKeys,
    linkedProjectId,
    refreshExcelProjects,
  ]);

  useEffect(() => {
    if (fileName) setSaveProjectTitle(fileName);
  }, [fileName]);

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
    setCustomLabels({ ...t.customLabels });
    const ordCol = nextRoles.indexOf('metric_ordinal_text');
    const ord = ordCol >= 0 ? collectOrdinalValues(rawRows, ordCol) : [];
    setRoles(nextRoles);
    setOrdinalLevels(ord);
    executeAnalysis(headers, rawRows, nextRoles, ord);
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
            Загрузите таблицу, укажите лист и строку заголовков и нажмите «Загрузить лист» — роли колонок подбираются
            автоматически, дашборд строится сам. Ручная правка и шаблоны — в блоке «Настройка столбцов» ниже. Если в той же
            книге на другом листе есть расшифровка шифра в ФИО (столбцы вроде «ШИФР» и «ФИО»), она подмешивается в контекст
            для ИИ. Данные в браузере; шаблоны маппинга — локально в настройках столбцов. Проекты на сервере: тот же X-Api-Key,
            что на главной, или вход по логину; после «Загрузить лист» — «Сохранить» в блоке ниже или над сводкой.
          </p>
        </motion.header>

        <section className="card glass-surface excel-analytics-section excel-recent-projects" aria-labelledby="excel-recent-projects-heading">
          <div className="excel-recent-projects-folder">
            <h2 id="excel-recent-projects-heading" className="admin-dash-h2">
              Последние проекты
            </h2>
            <p className="muted excel-recent-projects-lead">
              Список и сохранение на сервере (ключ API или логин). «Открыть» — снова выберите тот же файл с диска.
            </p>
          </div>
          {excelProjectsLoading && <p className="muted">Загрузка списка…</p>}
          {excelProjectsError && (
            <p className="err excel-projects-err-short">{formatExcelProjectsListError(excelProjectsError)}</p>
          )}
          {!excelProjectsLoading && !excelProjectsError && excelProjects.length === 0 && (
            <p className="muted">Пока нет сохранённых проектов — они появятся после первого сохранения.</p>
          )}
          {openProjectHint ? (
            <p className="excel-open-project-callout" role="status">
              {openProjectHint}
            </p>
          ) : null}
          {excelProjects.length > 0 ? (
            <ul className="excel-recent-projects-list">
              {excelProjects.map((p) => (
                <li key={p.id} className="excel-recent-projects-item">
                  <div className="excel-recent-projects-item-main">
                    <span className="excel-recent-projects-name">{p.title}</span>
                    <span className="muted excel-recent-projects-meta">
                      {p.file_name}
                      {p.sheet ? ` · лист «${p.sheet}»` : ''} · {new Date(p.updated_at).toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <div className="excel-recent-projects-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={openProjectBusyId === p.id}
                      onClick={() => void openProjectFromList(p.id)}
                    >
                      {openProjectBusyId === p.id ? 'Загрузка…' : 'Открыть'}
                    </button>
                    <button type="button" className="btn" onClick={() => void removeProject(p.id)}>
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {buffer && analyticRows.length > 0 ? (
            <div className="excel-save-project-row">
              <label className="excel-analytics-field excel-save-project-field">
                Название проекта
                <input
                  className="excel-analytics-input"
                  value={saveProjectTitle}
                  onChange={(e) => setSaveProjectTitle(e.target.value)}
                  placeholder={fileName || 'Название'}
                />
              </label>
              <button
                type="button"
                className="btn primary excel-save-project-btn"
                disabled={saveProjectBusy}
                onClick={() => void saveCurrentProject()}
              >
                {saveProjectBusy ? 'Сохранение…' : linkedProjectId ? 'Сохранить изменения' : 'Сохранить проект'}
              </button>
              {linkedProjectId ? (
                <span className="muted excel-save-linked">На сервере: проект №{linkedProjectId}</span>
              ) : null}
            </div>
          ) : (
            <p className="muted excel-save-project-wait">Сохранение — после «Загрузить лист» и появления дашборда ниже.</p>
          )}
        </section>

        <section
          ref={excelFileSectionRef}
          className="card import-workbook-drop glass-surface excel-analytics-section"
        >
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
          {openProjectHint ? (
            <p className="muted excel-session-hint" role="status">
              {openProjectHint}
            </p>
          ) : null}
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
                Загрузить лист и построить дашборд
              </button>
            </div>
            {headers.length > 0 && (
              <div className="excel-analytics-post-load">
                <p className="muted excel-analytics-automap-done">
                  Загружено столбцов: {headers.length}. Сопоставление с графиками и фильтрами выполнено автоматически; при
                  ошибке или неточных графиках откройте настройки.
                </p>
                <details className="excel-analytics-advanced-mapping">
                  <summary className="excel-analytics-advanced-summary">Настройка столбцов и шаблоны</summary>
                  <div className="excel-analytics-advanced-body">
                    <p className="muted">
                      Роль задаёт, как поле попадает в средние, срезы и ИИ. Несколько числовых столбцов — отдельные критерии.
                      Колонка «Код/шифр педагога»: несколько ФИО через запятую разворачиваются в отдельные строки для
                      графиков. После правок нажмите «Применить и пересчитать».
                    </p>
                    <div className="excel-analytics-auto-row">
                      <button type="button" className="btn primary excel-analytics-auto-btn" onClick={reSuggestAndRun}>
                        Подобрать роли заново и пересчитать
                      </button>
                    </div>
                    {roleSummaryLines.length > 0 && (
                      <div className="excel-analytics-role-summary">
                        <div className="excel-analytics-role-summary-title">Текущее сопоставление</div>
                        <ul className="excel-analytics-role-summary-list">
                          {roleSummaryLines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="muted">
                      Подписи доп. фильтров 1–3:{' '}
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
                        <p className="muted">
                          Порядок уровней текстовой шкалы (сверху к низу — от худшего к лучшему, или наоборот):
                        </p>
                        <textarea
                          className="excel-analytics-textarea"
                          rows={6}
                          value={ordinalLevels.join('\n')}
                          onChange={(e) =>
                            setOrdinalLevels(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))
                          }
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
                      Применить и пересчитать
                    </button>
                  </div>
                </details>
              </div>
            )}
          </section>
        )}

        {err && <p className="err import-workbook-err">{err}</p>}

        {serviceStripNote && (
          <p className="muted excel-service-strip-note" role="status">
            {serviceStripNote}
          </p>
        )}

        {analyticRows.length > 0 && (
          <div className="excel-dashboard excel-dashboard--stacked excel-dashboard--fullwidth">
            <div className="card glass-surface excel-dashboard-slice-strip" aria-label="Срез по всем параметрам наблюдения">
              <div className="excel-dashboard-slice-top">
                <div className="excel-dashboard-slice-intro">
                  <p className="excel-dashboard-slice-kicker">Срез выборки</p>
                  <h2 className="excel-dashboard-slice-title">Все параметры из маппинга</h2>
                  <p className="muted excel-dashboard-slice-lead">
                    В срез входят все колонки опроса, кроме даты (дата идёт в графики и сводки, но не дублируется как
                    измерение). Явные роли «фильтр» и текстовая шкала — вместе с остальными графами; каскад оставляет
                    совместимые значения. Сузьте чипами — графики и ПУЛЬС ниже пересчитаются.
                  </p>
                  {sessionRestoreNote && (
                    <p className="muted excel-session-restore-banner" role="status">
                      {sessionRestoreNote}
                    </p>
                  )}
                </div>
                <div className="excel-dashboard-slice-toolbar">
                  <div className="excel-dashboard-kpis excel-dashboard-kpis--slice">
                    <div
                      className="excel-dashboard-kpi"
                      title="Точки — число аналитических строк после развёртки: несколько наставников в одной ячейке, несколько классов через запятую, варианты опроса и т.д. Одна строка Excel может дать несколько точек."
                    >
                      <span className="excel-dashboard-kpi-value">{filteredRows.length}</span>
                      <span className="excel-dashboard-kpi-label">точек</span>
                    </div>
                    <div
                      className="excel-dashboard-kpi"
                      title="Уроки — уникальные строки импорта (записи таблицы) в текущем срезе фильтров, без учёта развёртки мультизначений. Совпадает с ожидаемым числом строк в файле при полном срезе."
                    >
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
                  <button
                    type="button"
                    className="btn primary excel-dashboard-save-project"
                    disabled={saveProjectBusy}
                    onClick={() => void saveCurrentProject()}
                    title="Сохранить маппинг и срез на сервер (нужен вход по логину)"
                  >
                    {saveProjectBusy ? 'Сохранение…' : linkedProjectId ? 'Сохранить изменения' : 'Сохранить проект'}
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
                <details className="excel-dashboard-slice-ai-details">
                  <summary className="excel-dashboard-slice-ai-summary">
                    ИИ: разделы панели фильтров и группы длинных списков
                  </summary>
                  <div className="excel-dashboard-slice-ai-inner">
                    <p className="muted excel-dashboard-slice-ai-lead">
                      После «Построить анализ» разделы среза и группы в длинных списках запрашиваются у модели
                      автоматически (тот же API, что у ПУЛЬС). Кнопки — повторить запрос при смене данных или если ответ
                      не пришёл.
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
                      {(aiSectionLayout != null ||
                        Object.keys(facetGroupsByKey).length > 0 ||
                        aiDerivedDimensions.length > 0) && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setAiSectionLayout(null);
                            setFacetGroupsByKey({});
                            setAiSectionsHint(null);
                            setFacetGroupsHint(null);
                            setAiCanonicalMapsByKey({});
                            setAiHierarchyByKey({});
                            setAiAssistExplain(null);
                            setAiAssistChartInterpret(null);
                            setAiAssistChartAnomalies(null);
                            setAiAssistChartSpec(null);
                            setAiAssistHint(null);
                            setAiDerivedDimensions([]);
                            setAiDerivedHint(null);
                          }}
                        >
                          Сбросить ИИ
                        </button>
                      )}
                    </div>
                    <div className="excel-dashboard-filter-ai-derived">
                      <p className="muted excel-dashboard-slice-ai-lead">
                        Смысловые измерения (ИИ): по уникальным значениям выбранной колонки модель предлагает 1–3
                        дополнительных фильтра (например кафедра или предметный блок по коду педагога). Повторите для
                        другой колонки — измерения суммируются.
                      </p>
                      <div className="excel-dashboard-filter-ai-actions excel-dashboard-filter-ai-actions--wrap">
                        {eligibleDerivedSourceKeys.length > 0 ? (
                          <label className="excel-derived-source-label">
                            <span className="muted">Колонка-источник</span>
                            <select
                              className="excel-derived-source-select"
                              value={derivedSourceKey ?? ''}
                              onChange={(e) => setDerivedSourceKey(e.target.value || null)}
                            >
                              {eligibleDerivedSourceKeys.map((k) => (
                                <option key={k} value={k}>
                                  {filterKeyDisplayLabelUi[k] ?? k}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <span className="muted">Нет колонки-источника: назначьте хотя бы один фильтр в маппинге.</span>
                        )}
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!analyticRows.length || aiDerivedBusy || eligibleDerivedSourceKeys.length === 0}
                          onClick={() => void fetchAiDerivedFilters()}
                        >
                          {aiDerivedBusy ? 'ИИ: смысловые измерения…' : 'Добавить смысловые группы (ИИ)'}
                        </button>
                      </div>
                      {aiDerivedDimensions.length > 0 && (
                        <ul className="excel-derived-dim-list">
                          {aiDerivedDimensions.map((d) => (
                            <li key={d.id} className="excel-derived-dim-item">
                              <span className="excel-derived-dim-title">{d.title}</span>
                              <span className="muted excel-derived-dim-src">
                                ← {filterKeyDisplayLabelUi[d.sourceFilterKey] ?? d.sourceFilterKey}
                              </span>
                              <button
                                type="button"
                                className="btn excel-derived-dim-remove"
                                onClick={() => {
                                  setAiDerivedDimensions((prev) => prev.filter((x) => x.id !== d.id));
                                  setFilterSelection((prev) => {
                                    const { [d.id]: _, ...rest } = prev;
                                    return rest;
                                  });
                                }}
                              >
                                Убрать
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {(aiSectionsBusy || facetGroupsBusy || aiDerivedBusy) && (
                      <AiWaitIndicator
                        active
                        compact
                        className="excel-dashboard-slice-ai-wait"
                        label={
                          [aiSectionsBusy, facetGroupsBusy, aiDerivedBusy].filter(Boolean).length > 1
                            ? 'ИИ обрабатывает запрос (разделы, группы или смысловые измерения)'
                            : aiSectionsBusy
                              ? 'ИИ предлагает разделы для панели фильтров'
                              : aiDerivedBusy
                                ? 'ИИ формирует дополнительные измерения среза'
                                : 'ИИ группирует значения в длинных списках'
                        }
                        typicalMinSec={12}
                        typicalMaxSec={45}
                        slowAfterSec={70}
                      />
                    )}
                    {(aiSectionsHint || facetGroupsHint || aiDerivedHint) && (
                      <p className="muted excel-dashboard-filter-ai-hint-msg">
                        {aiSectionsHint || facetGroupsHint || aiDerivedHint}
                      </p>
                    )}
                  </div>
                </details>
              </div>

              <div className="excel-dashboard-slice-ai excel-dashboard-slice-ai--assist">
                <details className="excel-dashboard-slice-ai-details">
                  <summary className="excel-dashboard-slice-ai-summary">
                    ИИ: срез на языке запросов, нормализация, иерархии и подсказки по графикам
                  </summary>
                  <div className="excel-dashboard-slice-ai-inner">
                    <p className="muted excel-dashboard-slice-ai-lead">
                      Запросы идут в <code className="excel-code-inline">POST /api/excel-dashboard-ai</code>. Значения
                      среза подставляются только из текущих списков фильтров. Нормализация объединяет синонимы в данных;
                      иерархия меняет только отображение групп в выбранном измерении.
                    </p>
                    <div className="excel-dashboard-ai-assist-grid">
                      <div className="excel-dashboard-ai-assist-block card glass-surface">
                        <h4 className="excel-dashboard-ai-assist-block-title">Срез текстом</h4>
                        <textarea
                          className="excel-analytics-textarea excel-dashboard-ai-assist-textarea"
                          rows={2}
                          placeholder="Например: только математика и 7 параллель"
                          value={aiAssistNlQuery}
                          onChange={(e) => setAiAssistNlQuery(e.target.value)}
                          disabled={!analyticRows.length || aiAssistBusy}
                        />
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!analyticRows.length || aiAssistBusy}
                          onClick={() => void runAiNlSlice()}
                        >
                          Применить срез (ИИ)
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!analyticRows.length || aiAssistBusy}
                          onClick={() => void runAiExplainSlice()}
                        >
                          Объяснить текущий срез
                        </button>
                        {aiAssistExplain && (
                          <div className="excel-dashboard-ai-assist-output">{aiAssistExplain}</div>
                        )}
                      </div>
                      <div className="excel-dashboard-ai-assist-block card glass-surface">
                        <h4 className="excel-dashboard-ai-assist-block-title">Нормализация и иерархия по измерению</h4>
                        <div className="excel-dashboard-ai-assist-row">
                          <label className="excel-analytics-field">
                            <span className="muted">Нормализация значений</span>
                            <select
                              className="excel-analytics-select"
                              value={aiNormalizeTargetKey ?? ''}
                              onChange={(e) => setAiNormalizeTargetKey(e.target.value || null)}
                            >
                              {filterKeys.map((k) => (
                                <option key={k} value={k}>
                                  {filterKeyDisplayLabelUi[k] ?? k}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="btn"
                            disabled={!analyticRows.length || aiAssistBusy || !aiNormalizeTargetKey}
                            onClick={() => void runAiNormalizeColumn()}
                          >
                            Нормализовать (ИИ)
                          </button>
                        </div>
                        <div className="excel-dashboard-ai-assist-row">
                          <label className="excel-analytics-field">
                            <span className="muted">Иерархия групп</span>
                            <select
                              className="excel-analytics-select"
                              value={aiHierarchyTargetKey ?? ''}
                              onChange={(e) => setAiHierarchyTargetKey(e.target.value || null)}
                            >
                              {filterKeys.map((k) => (
                                <option key={k} value={k}>
                                  {filterKeyDisplayLabelUi[k] ?? k}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="btn"
                            disabled={!analyticRows.length || aiAssistBusy || !aiHierarchyTargetKey}
                            onClick={() => void runAiHierarchyColumn()}
                          >
                            Построить иерархию (ИИ)
                          </button>
                        </div>
                      </div>
                      <div className="excel-dashboard-ai-assist-block card glass-surface excel-dashboard-ai-assist-block--wide">
                        <h4 className="excel-dashboard-ai-assist-block-title">Графики (интерпретация и навигация)</h4>
                        <div className="excel-dashboard-ai-assist-row excel-dashboard-ai-assist-row--wrap">
                          <button
                            type="button"
                            className="btn"
                            disabled={!analyticRows.length || aiAssistBusy}
                            onClick={() => void runAiChartInterpret()}
                          >
                            Интерпретировать первый мини-график
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={!analyticRows.length || aiAssistBusy}
                            onClick={() => void runAiChartAnomalies()}
                          >
                            Аномалии по мини-графикам
                          </button>
                        </div>
                        <textarea
                          className="excel-analytics-textarea excel-dashboard-ai-assist-textarea"
                          rows={2}
                          placeholder="Вопрос: куда смотреть на панели (сравнить предметы, найти перекос по фильтру…)"
                          value={aiAssistChartQuery}
                          onChange={(e) => setAiAssistChartQuery(e.target.value)}
                          disabled={!analyticRows.length || aiAssistBusy}
                        />
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!analyticRows.length || aiAssistBusy}
                          onClick={() => void runAiChartSpec()}
                        >
                          Подсказка по графикам (ИИ)
                        </button>
                        {aiAssistChartInterpret && (
                          <div className="excel-dashboard-ai-assist-output">
                            <strong>Интерпретация:</strong> {aiAssistChartInterpret}
                          </div>
                        )}
                        {aiAssistChartAnomalies && (
                          <div className="excel-dashboard-ai-assist-output">
                            <strong>Аномалии:</strong>
                            <pre className="excel-dashboard-ai-assist-pre">{aiAssistChartAnomalies}</pre>
                          </div>
                        )}
                        {aiAssistChartSpec && (
                          <div className="excel-dashboard-ai-assist-output">
                            <strong>Рекомендация:</strong> {aiAssistChartSpec}
                          </div>
                        )}
                      </div>
                    </div>
                    {aiAssistBusy && (
                      <AiWaitIndicator
                        active
                        compact
                        className="excel-dashboard-slice-ai-wait"
                        label="ИИ: запрос excel-dashboard-ai"
                        typicalMinSec={8}
                        typicalMaxSec={35}
                        slowAfterSec={55}
                      />
                    )}
                    {aiAssistHint && <p className="muted excel-dashboard-filter-ai-hint-msg">{aiAssistHint}</p>}
                  </div>
                </details>
              </div>

              <p className="muted excel-dashboard-filter-hint excel-dashboard-slice-hint">
                Снятые галочки по измерению значат «не сужать по этому полю». Отметьте нужные значения — срез сузится.
                Несколько значений в ячейке фильтра через запятую дают отдельные варианты. Колонка «Список через запятую»
                (пойнты) в фильтры не попадает — она в графиках и ИИ. Текстовая шкала попадает в блок «Текстовые метрики».
                Есть только «Класс» без «Параллель» — появится измерение «Параллель (из класса)». Блок ИИ выше может
                добавить производные фильтры (кафедры, блоки) по смыслу значений любой колонки-источника.
              </p>

              <div className="excel-dashboard-slice-sections">
                {filterSections.length === 0 ? (
                  <p className="muted excel-dashboard-slice-empty">
                    Нет колонок для среза: все столбцы помечены как «Не использовать» или только одна колонка «Дата» без
                    прочих граф. Снимите «игнор» хотя бы с одной графы опроса (кроме даты) или добавьте текстовую шкалу.
                  </p>
                ) : filterSectionsForDisplay.length === 0 ? (
                  <p className="muted excel-dashboard-slice-empty">
                    Все измерения скрыты из панели.{' '}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setFilterPanelHiddenKeys([]);
                      }}
                    >
                      Показать все измерения
                    </button>
                  </p>
                ) : (
                  filterSectionsForDisplay.map((section) => (
                    <section key={section.id} className="excel-slice-section">
                      <h3 className="excel-slice-section-title">{section.title}</h3>
                      <div className="excel-dashboard-slice-filters-grid excel-dashboard-slice-filters-grid--wide">
                        {section.keys.map((key) => {
                          const all = uniqueFilterValues(
                            applyFiltersExceptKey(dashboardRows, sliceFilterSelection, key),
                            key,
                          );
                          return (
                            <div key={key} className="excel-slice-dimension card glass-surface">
                              <div className="excel-slice-dimension-head excel-slice-dimension-head--row">
                                <span className="excel-slice-dimension-label">{filterKeyDisplayLabelUi[key] ?? key}</span>
                                <button
                                  type="button"
                                  className="btn excel-slice-dimension-hide"
                                  title="Убрать измерение из панели (отбор по нему сбрасывается; можно вернуть ниже)"
                                  onClick={() => {
                                    setFilterPanelHiddenKeys((prev) =>
                                      prev.includes(key) ? prev : [...prev, key],
                                    );
                                    setFilterSelection((p) =>
                                      pruneFilterSelection(dashboardRows, { ...p, [key]: null }, filterKeys),
                                    );
                                  }}
                                >
                                  Скрыть
                                </button>
                              </div>
                              <div className="excel-slice-dimension-body">
                                {renderFilterChipsForKey(key, all)}
                                <div className="excel-analytics-filter-actions">
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() =>
                                      setFilterSelection((p) =>
                                        pruneFilterSelection(dashboardRows, { ...p, [key]: null }, filterKeys),
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
              {filterPanelHiddenKeys.length > 0 && (
                <details className="excel-hidden-filters-details">
                  <summary className="excel-hidden-filters-summary">
                    Скрытые измерения ({filterPanelHiddenKeys.length}) — вернуть в панель
                  </summary>
                  <div className="excel-hidden-filters-list">
                    {filterPanelHiddenKeys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="btn"
                        onClick={() =>
                          setFilterPanelHiddenKeys((prev) => prev.filter((k) => k !== key))
                        }
                      >
                        {filterKeyDisplayLabelUi[key] ?? key}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <section className="card glass-surface excel-analytics-section excel-dashboard-table-section">
              <h2 className="admin-dash-h2">Детализация: строки среза (все колонки листа)</h2>
              <p className="muted excel-dashboard-table-lead">
                Содержимое таблицы — только те строки среза, которые соответствуют{' '}
                <strong>текущим фильтрам</strong> в блоке выше (чипы). Если по измерению не выбрано ни одного
                значения или выбраны все — это измерение не сужает выборку.
                {narrowingFilterDimensionsCount > 0 ? (
                  <>
                    {' '}
                    Сужение по {narrowingFilterDimensionsCount}{' '}
                    {narrowingFilterDimensionsCount === 1 ? 'измерению' : 'измерениям'}; строк в таблице:{' '}
                    <strong>{filteredRows.length}</strong>.
                  </>
                ) : (
                  <>
                    {' '}
                    Фильтры не сужают выборку — показаны все строки среза после развёртки мультизначений в ячейках:{' '}
                    <strong>{filteredRows.length}</strong>.
                  </>
                )}{' '}
                Если в ячейке было несколько значений (наставники, списки), одна строка файла может отображаться
                несколько раз — колонка «Разв.» показывает номер фрагмента.
                {filteredRows.length > DETAIL_TABLE_MAX_ROWS && (
                  <>
                    {' '}
                    Показаны первые {DETAIL_TABLE_MAX_ROWS} из {filteredRows.length} строк — сузьте срез или экспортируйте
                    исходный файл для полного списка.
                  </>
                )}
              </p>
              <div className="excel-analytics-table-wrap excel-analytics-table-wrap--full-sheet">
                <table className="excel-analytics-table excel-analytics-table--full-sheet">
                  <thead>
                    <tr>
                      <th className="excel-analytics-th-fixed">№ строки</th>
                      {detailShowSplitColumn && (
                        <th className="excel-analytics-th-fixed excel-analytics-th-fixed--after-num">Разв.</th>
                      )}
                      {Array.from({ length: detailColumnCount }, (_, ci) => (
                        <th key={ci} className="excel-analytics-th-sheet">
                          {formatBilingualCellLabel(
                            headers[ci] ?? `Колонка ${ci + 1}`,
                            showEnglishExcelLabels ? 'en' : 'ru',
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailTableSlice.map((r, i) => {
                      const line = rawRows[r.idx];
                      return (
                        <tr key={detailTableRowKey(r, i)}>
                          <td className="excel-analytics-td-fixed">{r.idx + 1}</td>
                          {detailShowSplitColumn && (
                            <td className="excel-analytics-td-fixed excel-analytics-td-fixed--after-num">
                              {r.splitPart != null && r.splitPart > 0 ? r.splitPart : '—'}
                            </td>
                          )}
                          {Array.from({ length: detailColumnCount }, (_, ci) => {
                            const raw = line?.[ci] as CellPrimitive | undefined;
                            return (
                              <td
                                key={ci}
                                className="excel-analytics-cell-sheet"
                                title={excelDetailCellTitle(raw ?? null)}
                              >
                                {line ? formatExcelDetailCell(raw ?? null) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="excel-dashboard-below-slice">
            <div className="excel-dashboard-main">
                <header className="excel-dashboard-main-head card glass-surface">
                  <div className="excel-dashboard-main-head-text">
                    <p className="excel-dashboard-main-kicker">Панель анализа</p>
                    <h2 className="excel-dashboard-main-title">Графики и выводы</h2>
                    <p className="muted excel-dashboard-main-lead">
                      Шаги: срез и таблица детализации выше → графики → клик по столбцу открывает панель педагогов → ПУЛЬС
                      внизу: чат и отчёты ИИ.
                    </p>
                  </div>
                </header>

                <div
                  className={`excel-dashboard-main-body${chartDrillOpen ? ' excel-dashboard-main-body--with-dock' : ''}`}
                >
                <div className="excel-dashboard-main-charts">
                  <section className="card glass-surface excel-dash-card excel-dash-card--wide excel-dash-chart-catalog">
                    <h3 className="excel-dash-card-title">Визуализации по текущему срезу</h3>
                    <p className="muted excel-dash-card-sub">
                      Компактные диаграммы распределения по каждому измерению среза; гистограммы по числовым пунктам;
                      при текстовой шкале — столбчатое распределение; при колонке наставника — групповые столбцы и
                      тепловая таблица средних; списки через запятую — справочник и топы.
                    </p>
                  </section>

                  {metricNumericCols.length > 1 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                      <h3 className="excel-dash-card-title">Гистограммы по каждому числовому пункту</h3>
                      <p className="muted excel-dash-card-sub">
                        Распределение значений по уникальным урокам в срезе.
                        {teacherFilterKey
                          ? ' Клик по столбцу — список педагогов в одной закреплённой панели справа (на узком экране — под графиками); по ФИО — срез и сводка.'
                          : ' Назначьте колонке роль «Код/шифр педагога», чтобы по клику видеть список педагогов в интервале.'}
                      </p>
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
                                              teacherFilterKey && metricDrill?.colIndex === mi
                                                ? metricDrill.bin.binIndex === entry.binIndex
                                                  ? 1
                                                  : 0.45
                                                : 1
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
                    </section>
                  )}

                  {filterKeysForPanel.length > 0 &&
                    allFilterDistributionCharts.some((c) => c.bars.length > 0) && (
                      <section className="card glass-surface excel-dash-card excel-dash-card--wide">
                        <h3 className="excel-dash-card-title">Распределение по измерениям среза</h3>
                        <p className="muted excel-dash-card-sub">
                          По каждому полю — сколько логических уроков в текущем срезе с каждым значением (топ вариантов).
                          Похожие написания объединяются.
                        </p>
                        <div className="excel-filter-distributions-grid">
                          {allFilterDistributionCharts.map(({ key, label, bars }) =>
                            bars.length === 0 ? null : (
                              <div
                                key={key}
                                id={`excel-chart-focus-${key}`}
                                className="excel-filter-distribution-mini card glass-surface"
                              >
                                <h4 className="excel-filter-distribution-mini-title">{label}</h4>
                                <div className="excel-analytics-chart excel-filter-distribution-mini-chart">
                                  <ResponsiveContainer
                                    width="100%"
                                    height={Math.min(220, 36 + bars.length * 22)}
                                  >
                                    <BarChart
                                      data={bars}
                                      layout="vertical"
                                      margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
                                    >
                                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                                      <XAxis type="number" tick={{ fontSize: 9 }} />
                                      <YAxis
                                        type="category"
                                        dataKey="short"
                                        width={88}
                                        tick={{ fontSize: 8 }}
                                        interval={0}
                                      />
                                      <Tooltip
                                        content={({ active, payload }) => {
                                          if (!active || !payload?.length) return null;
                                          const p = payload[0].payload as {
                                            fullName: string;
                                            uniqueLessons: number;
                                          };
                                          return (
                                            <div
                                              style={{
                                                background: '#fff',
                                                border: '1px solid var(--card-border)',
                                                borderRadius: 8,
                                                padding: '0.35rem 0.5rem',
                                                fontSize: 11,
                                                maxWidth: 280,
                                              }}
                                            >
                                              <div style={{ fontWeight: 700, marginBottom: 2 }}>{p.fullName}</div>
                                              <div>Уроков: {p.uniqueLessons}</div>
                                            </div>
                                          );
                                        }}
                                      />
                                      <Bar
                                        dataKey="uniqueLessons"
                                        fill="#115e59"
                                        name="Уроков"
                                        radius={[0, 3, 3, 0]}
                                      />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            ),
                          )}
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
                            ? 'Клик по столбцу — та же закреплённая панель педагогов, что и у блока гистограмм выше; по ФИО — сводка и «Исходные факты» ниже.'
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
                          <div className="excel-metric-drill-row excel-metric-drill-row--solo">
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
                                          teacherFilterKey &&
                                          metricDrill?.colIndex === metricPickIndex
                                            ? metricDrill.bin.binIndex === entry.binIndex
                                              ? 1
                                              : 0.45
                                            : 1
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

                  </div>

                  {ordinalChartDisplay.length > 0 && (
                    <section className="card glass-surface excel-dash-card excel-dash-card--ordinal">
                      <h3 className="excel-dash-card-title">Текстовая шкала</h3>
                      <p className="muted excel-dash-card-sub">
                        Распределение уникальных уроков по уровням шкалы.
                        {teacherFilterKey
                          ? ' Клик по столбцу — та же панель педагогов справа (на узком экране — под графиками); по ФИО — срез дашборда и сводка.'
                          : ' Назначьте колонке роль «Код/шифр педагога», чтобы видеть список педагогов по уровню.'}
                      </p>
                      <div className="excel-analytics-chart">
                          <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={ordinalChartDisplay} layout="vertical" margin={{ top: 8, right: 8, left: 120, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                              <XAxis type="number" tick={{ fontSize: 11 }} />
                              <YAxis type="category" dataKey="level" width={110} tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Bar dataKey="count" fill="var(--chart-bar)" name="Кол-во" radius={[0, 4, 4, 0]}>
                                {ordinalChartDisplay.map((entry) => (
                                  <Cell
                                    key={entry.rank}
                                    cursor={teacherFilterKey ? 'pointer' : 'default'}
                                    fill="var(--chart-bar)"
                                    opacity={
                                      teacherFilterKey && ordinalDrill
                                        ? ordinalDrill.rank === entry.rank
                                          ? 1
                                          : 0.45
                                        : 1
                                    }
                                    onClick={() => {
                                      if (!teacherFilterKey) return;
                                      setMetricDrill(null);
                                      setOrdinalDrill({ rank: entry.rank, levelLabel: entry.level });
                                    }}
                                  />
                                ))}
                              </Bar>
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
                                <tr key={r.rank}>
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
                </div>
                {chartDrillOpen && (
                  <aside
                    id="excel-chart-drill-dock"
                    className="excel-chart-drill-dock excel-metric-drill-panel"
                    aria-label={
                      ordinalDrill ? 'Педагоги на выбранном уровне шкалы' : 'Педагоги в выбранном интервале метрики'
                    }
                  >
                    <p className="excel-chart-drill-dock-kicker">Педагоги по выбору на графике</p>
                    <div className="excel-metric-drill-panel-head">
                      <div>
                        {ordinalDrill ? (
                          <>
                            <div className="excel-metric-drill-panel-metric">{ordinalScaleHeaderUi}</div>
                            <div className="excel-metric-drill-panel-bin">Уровень: {ordinalDrill.levelLabel}</div>
                          </>
                        ) : metricDrill ? (
                          <>
                            <div className="excel-metric-drill-panel-metric">{metricDrill.header}</div>
                            <div className="excel-metric-drill-panel-bin">Интервал: {metricDrill.bin.label}</div>
                          </>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn excel-metric-drill-close"
                        aria-label="Закрыть панель"
                        onClick={closeChartDrill}
                      >
                        ×
                      </button>
                    </div>
                    <p className="muted excel-metric-drill-panel-hint">
                      {ordinalDrill
                        ? 'Уроки с этим уровнем шкалы в текущем срезе. Клик по ФИО — сузить дашборд; блок «Исходные факты» ниже раскроется.'
                        : 'Уроки в выбранном диапазоне по этому пункту. Клик по ФИО — сузить дашборд; краткая сводка появится здесь, блок «Исходные факты» ниже раскроется автоматически.'}
                    </p>
                    {ordinalDrill ? (
                      ordinalDrillTeachers.length === 0 ? (
                        <p className="muted">На этом уровне нет строк с указанным педагогом.</p>
                      ) : (
                        <ul className="excel-metric-drill-teacher-list">
                          {ordinalDrillTeachers.map((t) => (
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
                      )
                    ) : metricDrill ? (
                      metricDrillTeachers.length === 0 ? (
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
                      )
                    ) : null}
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
                <div className="excel-dashboard-mid-save-bar card glass-surface" role="region" aria-label="Сохранение проекта">
                  <div className="excel-dashboard-mid-save-inner">
                    <p className="excel-dashboard-mid-save-text">
                      <strong>Сохранить на сервер</strong> — маппинг и срез. Название — в{' '}
                      <a href="#excel-recent-projects-heading" className="excel-dashboard-mid-save-anchor">
                        «Последние проекты»
                      </a>
                      ; здесь подставляется имя файла.
                    </p>
                    <button
                      type="button"
                      className="btn primary excel-dashboard-mid-save-btn"
                      disabled={saveProjectBusy}
                      onClick={() => void saveCurrentProject()}
                    >
                      {saveProjectBusy ? 'Сохранение…' : linkedProjectId ? 'Сохранить изменения' : 'Сохранить проект'}
                    </button>
                  </div>
                </div>
                <div className="excel-dash-board-panels excel-dash-board-panels--compact">
                  <div className="excel-dash-panel-row excel-dash-panel-row--two excel-dash-panel-row--compact-kpi">
                    <section className="card glass-surface excel-dash-card excel-dash-card--data-panel">
                      <h3 className="excel-dash-card-title">Сводка выборки</h3>
                      <div className="excel-dash-kpi-compact-row" aria-label="Ключевые показатели">
                        <div
                          className="excel-dash-kpi-compact-item"
                          title="Уникальные строки импорта в срезе (записи таблицы), без развёртки мультизначений в ячейках."
                        >
                          <span className="excel-dash-kpi-compact-value">{kpiLessons}</span>
                          <span className="excel-dash-kpi-compact-label">уроков в срезе</span>
                        </div>
                        <div
                          className="excel-dash-kpi-compact-item"
                          title="Аналитические строки после развёртки мультизначений (см. подсказку «Все параметры из маппинга»)."
                        >
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
                                <td>{kpiLessons}</td>
                              </tr>
                              <tr>
                                <th scope="row">Событий по смыслу (весь файл)</th>
                                <td>
                                  {kpiLessonSemanticsTotal}{' '}
                                  <span className="muted">({kpiImportRowsTotal} строк имп.)</span>
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
                  currentFilters={pulseFiltersForChat}
                  numericSummary={richLlmContext || quickText || '(постройте анализ для сводки)'}
                  extraContext={pulseLlmExtraBundle.trim() || undefined}
                  onApplyFilters={applyPulseFilters}
                  embeddedPanel={
                    <>
                      <div className="pulse-excel-embed-stack" id="excel-drill-summary">
                        <p className="muted excel-pulse-vs-notes-hint">
                          <strong>ПУЛЬС</strong> (чат внизу карточки) — диалог с моделью: вы задаёте вопросы словами, ответ
                          опирается на текущий срез и при необходимости подставляет фильтры.{' '}
                          <strong>Сформировать вывод (записки ИИ)</strong> — не чат, а отдельные короткие тексты по
                          каждому педагогу (и предмету, если задано в маппинге) из той же выборки.
                        </p>
                        <details className="pulse-excel-embed-details" open>
                          <summary className="pulse-excel-embed-summary">
                            <span>Аналитический отчёт (ИИ)</span>
                            {summaryNarrativeWords != null && (
                              <span className="excel-dash-ai-report-badge">≈ {summaryNarrativeWords} слов</span>
                            )}
                          </summary>
                          {!summaryNarrativeLoading && (
                            <p className="muted excel-dash-card-sub excel-summary-source-note">
                              {summaryNarrative && 'Связный документ по текущему срезу и фактам из таблицы.'}
                              {!summaryNarrative &&
                                (summaryNarrativeApiHint ||
                                  'ИИ-отчёт не сформирован: проверьте ключи LLM на Cloud Function и логи.')}
                            </p>
                          )}
                          {summaryNarrativeLoading && (
                            <AiWaitIndicator
                              active
                              className="excel-ai-wait-embed"
                              label="Формируем аналитический отчёт по выборке (нейросеть на сервере)"
                              typicalMinSec={18}
                              typicalMaxSec={95}
                              slowAfterSec={120}
                              hint="Обычно от 20 с до полутора минут. Пока ждёте, можно открыть «Исходные факты» ниже."
                            />
                          )}
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

                        {teacherFilterKey && (
                          <details className="pulse-excel-embed-details">
                            <summary className="pulse-excel-embed-summary">Сформировать вывод (записки ИИ)</summary>
                            <p className="muted excel-dash-card-sub">
                              Готовые короткие тексты по каждому педагогу в срезе (и по паре педагог+предмет, если в
                              маппинге есть колонка предмета). Это не диалог: один запрос — пакет записок.
                            </p>
                            <div className="excel-director-dossier-actions">
                              <button
                                type="button"
                                className="btn primary"
                                disabled={directorDossierBusy || !filteredRows.length}
                                onClick={() => void fetchDirectorDossier()}
                              >
                                {directorDossierBusy ? 'Формируем…' : 'Сформировать вывод (записки ИИ)'}
                              </button>
                              {directorDossierMeta && (
                                <span className="muted excel-director-dossier-meta">
                                  Сегментов: {directorDossier?.length ?? 0}
                                  {directorDossierMeta.truncated ? ` (всего: ${directorDossierMeta.totalGroups})` : ''}
                                </span>
                              )}
                            </div>
                            {directorDossierBusy && (
                              <AiWaitIndicator
                                active
                                compact
                                className="excel-ai-wait-embed excel-director-dossier-wait"
                                label="Записки по педагогам — несколько запросов к модели"
                                typicalMinSec={25}
                                typicalMaxSec={90}
                                slowAfterSec={140}
                                hint="Время растёт с числом педагогов и пакетов; возможны последовательные вызовы API."
                              />
                            )}
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
            </div>
          </div>
        )}
      </motion.div>
    </MotionConfig>
  );
}

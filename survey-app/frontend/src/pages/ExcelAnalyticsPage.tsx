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
import { postExcelFilterSections, postExcelNarrativeSummary } from '../api/client';
import PulseExcelChat from '../components/PulseExcelChat';
import { fadeIn } from '../motion/resultsMotion';
import {
  applyFilters,
  buildAnalyticRows,
  buildQuickSummaryRu,
  countsByMonth,
  expandRowsForMultiValueFilterColumns,
  filterKeyForRole,
  histogramNumeric,
  isFilterRole,
  meanByNumericColumn,
  meanByTeacherGrouped,
  ordinalDistribution,
  parseAnalyticsDate,
  rowNumericSum,
  uniqueFilterValues,
  type AnalyticRow,
  type FilterSelection,
} from '../lib/excelAnalytics/engine';
import { applyServiceTimestampIgnore } from '../lib/excelAnalytics/serviceTimestamp';
import {
  extractHeadersAndRows,
  getSheetMatrix,
  readWorkbookMeta,
  type CellPrimitive,
} from '../lib/excelAnalytics/parse';
import { suggestColumnRoles } from '../lib/excelAnalytics/autoMap';
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

/** Разделы боковой панели фильтров (порядок колонок внутри раздела — как в таблице). */
const FILTER_SIDEBAR_SECTIONS: { id: string; title: string; roles: ColumnRole[] }[] = [
  { id: 'mentors', title: 'Наставники', roles: ['filter_teacher_code'] },
  { id: 'class-subject', title: 'Параллель, класс, предмет', roles: ['filter_parallel', 'filter_class', 'filter_subject'] },
  { id: 'format', title: 'Формат', roles: ['filter_format'] },
  { id: 'extra', title: 'Дополнительные признаки', roles: ['filter_custom_1', 'filter_custom_2', 'filter_custom_3'] },
];

function buildStaticFilterSections(
  roles: ColumnRole[],
  customLabels: CustomFilterLabels,
  filterKeys: string[],
): { id: string; title: string; keys: string[] }[] {
  const out: { id: string; title: string; keys: string[] }[] = [];
  const seen = new Set<string>();
  for (const sec of FILTER_SIDEBAR_SECTIONS) {
    const keys: string[] = [];
    roles.forEach((r) => {
      if (!sec.roles.includes(r) || !isFilterRole(r)) return;
      const k = filterKeyForRole(r, customLabels);
      if (!keys.includes(k)) keys.push(k);
    });
    keys.forEach((k) => seen.add(k));
    if (keys.length) out.push({ id: sec.id, title: sec.title, keys });
  }
  const rest = filterKeys.filter((k) => !seen.has(k));
  if (rest.length) out.push({ id: 'other', title: 'Прочие фильтры', keys: rest });
  return out;
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
  /** Разделы фильтров от ИИ; null — взять buildStaticFilterSections */
  const [llmFilterSections, setLlmFilterSections] = useState<{ id: string; title: string; keys: string[] }[] | null>(
    null,
  );
  const [filterLayoutMode, setFilterLayoutMode] = useState<'idle' | 'loading' | 'llm' | 'static'>('idle');
  const [metricPickIndex, setMetricPickIndex] = useState<number | null>(null);
  /** При загрузке листа сразу подбирать роли по заголовкам и данным */
  const [autoMapOnLoad, setAutoMapOnLoad] = useState(true);
  /** Сообщение, если при анализе отсечена служебная колонка времени */
  const [serviceStripNote, setServiceStripNote] = useState<string | null>(null);
  const [summaryNarrative, setSummaryNarrative] = useState<string | null>(null);
  const [summaryNarrativeLoading, setSummaryNarrativeLoading] = useState(false);

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
      setLlmFilterSections(null);
      setFilterLayoutMode('idle');
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
      setLlmFilterSections(null);
      setFilterLayoutMode('idle');
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

  const uniqueLessonCount = useMemo(() => new Set(analyticRows.map((r) => r.idx)).size, [analyticRows]);

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

  const kpiLessons = useMemo(() => new Set(filteredRows.map((r) => r.idx)).size, [filteredRows]);

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

  const staticFilterSections = useMemo(
    () => buildStaticFilterSections(roles, customLabels, filterKeys),
    [roles, customLabels, filterKeys],
  );

  const filterSections = llmFilterSections ?? staticFilterSections;

  useEffect(() => {
    if (!analyticRows.length || !filterKeys.length) {
      setLlmFilterSections(null);
      setFilterLayoutMode('idle');
      return;
    }
    let cancelled = false;
    setFilterLayoutMode('loading');
    const columns = roles
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => isFilterRole(r))
      .map(({ r, i }) => {
        const fk = filterKeyForRole(r, customLabels);
        return {
          filterKey: fk,
          role: r,
          roleLabel: COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r,
          header: headers[i] || fk,
          samples: uniqueFilterValues(analyticRows, fk).slice(0, 12),
        };
      });
    void postExcelFilterSections({ filterKeys, columns })
      .then((res) => {
        if (cancelled) return;
        if (res.source === 'llm' && res.sections?.length) {
          setLlmFilterSections(res.sections);
          setFilterLayoutMode('llm');
        } else {
          setLlmFilterSections(null);
          setFilterLayoutMode('static');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLlmFilterSections(null);
        setFilterLayoutMode('static');
      });
    return () => {
      cancelled = true;
    };
  }, [analyticRows, filterKeys, roles, customLabels, headers]);

  const histogramData = useMemo(() => {
    if (metricPickIndex == null) return [];
    return histogramNumeric(filteredRows, metricPickIndex, 8);
  }, [filteredRows, metricPickIndex]);

  const monthData = useMemo(() => countsByMonth(filteredRows), [filteredRows]);

  const ordinalChartData = useMemo(() => {
    if (roles.indexOf('metric_ordinal_text') < 0) return [];
    return ordinalDistribution(filteredRows, ordinalLevels);
  }, [filteredRows, ordinalLevels, roles]);

  const metricHeaderLabel = metricPickIndex != null ? headers[metricPickIndex] ?? 'Метрика' : '';

  const numericMetricsForSummary = useMemo(
    () => metricNumericCols.map((mi) => ({ colIndex: mi, label: headers[mi] ?? `Колонка ${mi + 1}` })),
    [metricNumericCols, headers],
  );

  const meanByColumnData = useMemo(() => {
    if (metricNumericCols.length < 2) return [];
    return meanByNumericColumn(filteredRows, metricNumericCols, (i) => headers[i] ?? `Колонка ${i + 1}`);
  }, [filteredRows, metricNumericCols, headers]);

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
      dateLabel: di >= 0 ? headers[di] : '',
      numericMetrics: numericMetricsForSummary,
      hasOrdinal: roles.includes('metric_ordinal_text'),
      uniqueLessons: uniqueLessonCount,
    });
  }, [analyticRows, filteredRows, roles, headers, numericMetricsForSummary, uniqueLessonCount]);

  const pulseFacetOptions = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const k of filterKeys) {
      m[k] = uniqueFilterValues(analyticRows, k).slice(0, 72);
    }
    return m;
  }, [filterKeys, analyticRows]);

  const pulseFacetLabels = useMemo(() => {
    const m: Record<string, string> = {};
    roles.forEach((r, i) => {
      if (!isFilterRole(r)) return;
      const k = filterKeyForRole(r, customLabels);
      m[k] = headers[i] || k;
    });
    return m;
  }, [roles, customLabels, headers]);

  const pulseExtraContext = useMemo(() => {
    if (!teacherFilterKey || metricNumericCols.length === 0) return '';
    const rows = meanByTeacherGrouped(filteredRows, teacherFilterKey, metricNumericCols);
    const lines = rows.slice(0, 28).map((row) => {
      const mentor = String(row.mentor ?? '');
      const parts = metricNumericCols.map((mi) => {
        const v = row[`m${mi}`];
        return `${headers[mi] ?? String(mi)}: ${v != null ? Number(v).toFixed(2) : '—'}`;
      });
      return `${mentor}: ${parts.join('; ')}`;
    });
    return `Средние по наставникам (текущая выборка после фильтров):\n${lines.join('\n')}`;
  }, [teacherFilterKey, metricNumericCols, filteredRows, headers]);

  const applyPulseFilters = useCallback((update: (prev: FilterSelection) => FilterSelection) => {
    setFilterSelection(update);
  }, []);

  useEffect(() => {
    if (!quickText.trim()) {
      setSummaryNarrative(null);
      setSummaryNarrativeLoading(false);
      return;
    }
    let cancelled = false;
    setSummaryNarrative(null);
    setSummaryNarrativeLoading(true);
    void postExcelNarrativeSummary({
      context: {
        numericSummary: quickText.slice(0, 20000),
        extraContext: pulseExtraContext || undefined,
        facetLabels: pulseFacetLabels,
      },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.source === 'llm' && res.narrative?.trim()) {
          setSummaryNarrative(res.narrative.trim());
        } else {
          setSummaryNarrative(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSummaryNarrative(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryNarrativeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quickText, pulseExtraContext, pulseFacetLabels]);

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
            Загрузите таблицу, укажите лист и строку заголовков, сопоставьте колонки с ролями. Данные обрабатываются в
            браузере; шаблоны маппинга хранятся локально на этом устройстве.
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
            <h2 className="admin-dash-h2">3. Роли колонок</h2>
            <p className="excel-analytics-lead">
              Система может сама угадать роли по <strong>названиям</strong> столбцов и по <strong>первым строкам</strong>{' '}
              таблицы. Колонку <strong>«Формат»</strong> (очно / дистанционно и т.д.) подбирает сама: по словам в заголовке и
              по значениям в ячейках; коды 0/1 тоже считаются форматом, если в названии столбца есть «формат» или
              «дистанц»/«очно». Вам остаётся проверить список ниже и при необходимости поправить отдельные строки в таблице.
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
                Подобрать роли автоматически
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
                      {(filterLayoutMode === 'loading' ||
                        (filterLayoutMode === 'idle' && analyticRows.length > 0)) &&
                        'ИИ подбирает разделы боковой панели по названиям колонок и примерам значений…'}
                      {filterLayoutMode === 'llm' &&
                        'Разделы предложены моделью по контексту таблицы (тот же OpenAI API, что и у ПУЛЬС).'}
                      {filterLayoutMode === 'static' &&
                        analyticRows.length > 0 &&
                        'Стандартная группировка разделов (ИИ недоступен, нет ключа или ответ не подошёл).'}
                    </p>
                    <p className="muted excel-dashboard-filter-hint">
                      Значения в одной ячейке через запятую (как в выгрузке Google Forms) считаются отдельными вариантами —
                      каждая часть даёт свою точку в выборке. Снимите лишние метки, чтобы сузить срез. «Снять все» очищает
                      поле (в выборке не останется строк, пока не отметите варианты снова). «Все значения» снова включает
                      весь столбец.
                    </p>
                    <div className="excel-analytics-filters">
                      {filterSections.map((section) => (
                        <div key={section.id} className="excel-dashboard-filter-section">
                          <h4 className="excel-dashboard-filter-section-title">{section.title}</h4>
                          {section.keys.map((key) => {
                            const all = uniqueFilterValues(analyticRows, key);
                            const sel = filterSelection[key];
                            return (
                              <div key={key} className="excel-analytics-filter-block">
                                <div className="excel-analytics-filter-title">{key}</div>
                                <div className="excel-analytics-filter-chips">
                                  {all.map((val) => {
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
                                  })}
                                </div>
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
                      Слева задаёте срез. Здесь — текстовая сводка, ассистент ПУЛЬС и визуализации по текущей выборке.
                    </p>
                  </div>
                </header>

                <PulseExcelChat
                  facetOptions={pulseFacetOptions}
                  facetLabels={pulseFacetLabels}
                  currentFilters={filterSelection}
                  numericSummary={quickText || '(постройте анализ для сводки)'}
                  extraContext={pulseExtraContext || undefined}
                  onApplyFilters={applyPulseFilters}
                />

                <div className="excel-dashboard-main-charts">
                  <section className="card glass-surface excel-dash-card excel-dash-card--summary">
                    <h3 className="excel-dash-card-title">Сводный текстовый анализ</h3>
                    <p className="muted excel-dash-card-sub excel-summary-source-note">
                      {summaryNarrativeLoading &&
                        'Запрашиваем связный текст у модели по тем же данным; ниже временно показана машинная сводка.'}
                      {!summaryNarrativeLoading && summaryNarrative &&
                        'Текст ниже сформирован моделью строго на основе машинной сводки и блока по наставникам; новые цифры не добавляются.'}
                      {!summaryNarrativeLoading && !summaryNarrative &&
                        'Машинная сводка (ИИ недоступен, нет ключа OpenAI на функции или ответ не получен).'}
                    </p>
                    <pre className="excel-analytics-pre excel-dash-pre">
                      {summaryNarrative ?? quickText}
                    </pre>
                  </section>

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
                    </section>
                  )}
                </div>
              </div>
            </div>

            <section className="card glass-surface excel-analytics-section excel-dashboard-table-section">
              <h2 className="admin-dash-h2">Таблица (первые 50 строк выборки)</h2>
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

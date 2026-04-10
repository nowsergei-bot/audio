import type { PhenomenalReportBlockDraft, PhenomenalReportDraft } from './reportDraftTypes';
import type { TeacherLessonChecklistRow } from './parseTeacherChecklistApril';

/** Семь блоков рубрики чек-листа (шкалы как в Google Forms: 0–4 и рефлексия 0–1). */
export const PHENOMENAL_COMPETENCY_DEFS = [
  { key: 'rubricOrganizational', shortLabel: 'Организация пространства' },
  { key: 'rubricGoalSetting', shortLabel: 'Целеполагание' },
  { key: 'rubricTechnologies', shortLabel: 'Технологии обучения' },
  { key: 'rubricInformation', shortLabel: 'Инф. культура учителя' },
  { key: 'rubricGeneralContent', shortLabel: 'Содержание урока' },
  { key: 'rubricCultural', shortLabel: 'Культурная направленность' },
  { key: 'rubricReflection', shortLabel: 'Рефлексивность' },
] as const;

export type PhenomenalCompetencyKey = (typeof PHENOMENAL_COMPETENCY_DEFS)[number]['key'];

/** Максимум балла по чек-листу Google: 0…4 (шесть блоков), рефлексия 0…1. */
export const PHENOMENAL_METRIC_MAX: Record<PhenomenalCompetencyKey, number> = {
  rubricOrganizational: 4,
  rubricGoalSetting: 4,
  rubricTechnologies: 4,
  rubricInformation: 4,
  rubricGeneralContent: 4,
  rubricCultural: 4,
  rubricReflection: 1,
};

export const PHENOMENAL_METHODOLOGY_MAX = 10;

export function scaleLevelsForMetric(key: PhenomenalCompetencyKey): number[] {
  const max = PHENOMENAL_METRIC_MAX[key];
  return Array.from({ length: max + 1 }, (_, i) => i);
}

/** Сводные графики: семь рубрик + методика /10. */
export type PhenomenalCompetencyAggregateKey = PhenomenalCompetencyKey | 'methodology';

export interface PhenomenalCompetencyAggregate {
  key: PhenomenalCompetencyAggregateKey;
  shortLabel: string;
  /** Средний сырой балл на шкале этой метрики (0…maxLevel) */
  mean: number;
  /** Верхняя граница шкалы в опроснике: 4, 1 (рефлексия) или 10 (методика) */
  maxLevel: number;
  /** Сколько уроков (строк) дали хотя бы одно числовое значение по этому критерию */
  lessonCount: number;
}

/** Приводим числа из форм (1–5, 1–10, %) к шкале 0–5 для сопоставимости. */
export function normalizeCompetencyRawScore(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (n <= 5) return Math.min(5, Math.max(0, Math.round(n * 100) / 100));
  if (n <= 10) return Math.min(5, Math.round((n / 2) * 100) / 100);
  if (n <= 100) return Math.min(5, Math.round((n / 20) * 100) / 100);
  return null;
}

const WORD_SCORES: { re: RegExp; score: number }[] = [
  { re: /отличн|превосходн|замечательн/i, score: 5 },
  { re: /очень\s+хорош/i, score: 5 },
  { re: /на\s*высок/i, score: 5 },
  { re: /хорош(о|ий|ая)?(\s|$|[,.])/i, score: 4 },
  { re: /удовлетворительн/i, score: 3 },
  { re: /средн(ий|яя|е)?(\s|$|[,.])/i, score: 3 },
  { re: /нормальн/i, score: 3 },
  { re: /неудовлетворительн/i, score: 2 },
  { re: /слаб/i, score: 2 },
  { re: /плох(о|ой|ая)?(\s|$|[,.])/i, score: 2 },
  { re: /очень\s+плох/i, score: 1 },
];

/**
 * Вытаскивает оценку из одной строки/фрагмента (число, «7 из 10», словесная шкала).
 */
export function parseLikertScoreFromText(chunk: string): number | null {
  const t = chunk.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const outOf = t.match(/(\d+(?:[.,]\d+)?)\s*из\s*10/i);
  if (outOf) {
    const v = parseFloat(outOf[1].replace(',', '.'));
    return normalizeCompetencyRawScore(v);
  }
  const outOf5 = t.match(/(\d+(?:[.,]\d+)?)\s*из\s*5/i);
  if (outOf5) {
    const v = parseFloat(outOf5[1].replace(',', '.'));
    return normalizeCompetencyRawScore(v);
  }

  const numMatch = t.match(/(\d+(?:[.,]\d+)?)/);
  if (numMatch) {
    const v = parseFloat(numMatch[1].replace(',', '.'));
    const norm = normalizeCompetencyRawScore(v);
    if (norm != null) return norm;
  }

  for (const { re, score } of WORD_SCORES) {
    if (re.test(t)) return score;
  }
  return null;
}

/** Из ячейки рубрики (в т.ч. несколько строк / наблюдений) — все распознанные баллы. */
export function scoresFromRubricCell(raw: string | undefined): number[] {
  if (raw == null || !String(raw).trim()) return [];
  const lines = String(raw)
    .split(/\n+/)
    .flatMap((line) => line.split(/\s*\|\s*/));
  const out: number[] = [];
  for (const line of lines) {
    const v = parseLikertScoreFromText(line);
    if (v != null) out.push(v);
  }
  return out;
}

/**
 * Баллы в шкале опросника Google (0…maxLevel): строки «4 - …», «0 - …», «1. текст».
 * Если таких нет — грубый fallback через parseLikert (0–5) → доля на maxLevel.
 */
export function formScaleScoresFromRubricCell(raw: string | undefined, maxLevel: number): number[] {
  const out: number[] = [];
  if (raw == null || !String(raw).trim()) return out;
  const lines = String(raw)
    .split(/\n+/)
    .flatMap((line) => line.split(/\s*\|\s*/));
  for (const line of lines) {
    let m = line.match(/^\s*(\d{1,2})\s*[-–—.)]\s*/);
    if (!m) m = line.match(/^\s*(\d{1,2})\.\s+/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= maxLevel) out.push(n);
      continue;
    }
    const t = line.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const num = t.match(/^(\d+(?:[.,]\d+)?)\b/);
    if (num) {
      const v = parseFloat(num[1].replace(',', '.'));
      if (Number.isFinite(v) && v >= 0 && v <= maxLevel) out.push(Math.round(v * 100) / 100);
    }
  }
  if (out.length === 0) {
    const lump = String(raw).replace(/\s+/g, ' ').trim();
    const lik = parseLikertScoreFromText(lump);
    if (lik != null && maxLevel >= 1) {
      const x = (lik / 5) * maxLevel;
      out.push(Math.min(maxLevel, Math.max(0, Math.round(x * 100) / 100)));
    }
  }
  return out;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getRubricFromBlock(
  block: PhenomenalReportBlockDraft,
  key: PhenomenalCompetencyKey,
): string | undefined {
  return block[key];
}

function getRubricFromTeacherRow(row: TeacherLessonChecklistRow, key: PhenomenalCompetencyKey): string {
  return row[key] ?? '';
}

/**
 * По черновику отчёта: на каждый критерий — среднее по урокам (сначала среднее внутри ячейки, потом по блокам).
 * Плюс строка «Методика» по полю /10.
 */
export function aggregateCompetencyFromDraft(draft: PhenomenalReportDraft): PhenomenalCompetencyAggregate[] {
  const rubricRows = PHENOMENAL_COMPETENCY_DEFS.map(({ key, shortLabel }) => {
    const maxLv = PHENOMENAL_METRIC_MAX[key];
    const perBlock: number[] = [];
    for (const b of draft.blocks) {
      const raw = getRubricFromBlock(b, key);
      const m = mean(formScaleScoresFromRubricCell(raw, maxLv));
      if (m != null) perBlock.push(m);
    }
    const g = mean(perBlock);
    return {
      key,
      shortLabel,
      mean: g != null ? Math.round(g * 100) / 100 : 0,
      maxLevel: maxLv,
      lessonCount: perBlock.length,
    };
  });
  const perBlockMeth: number[] = [];
  for (const b of draft.blocks) {
    const m = methodologyAvgRawOnTen(b);
    if (m != null) perBlockMeth.push(m);
  }
  const gM = mean(perBlockMeth);
  return [
    ...rubricRows,
    {
      key: 'methodology' as const,
      shortLabel: 'Методика (/10)',
      mean: gM != null ? Math.round(gM * 100) / 100 : 0,
      maxLevel: PHENOMENAL_METHODOLOGY_MAX,
      lessonCount: perBlockMeth.length,
    },
  ];
}

/** По сырым строкам чек-листа педагогов (до слияния). */
export function aggregateCompetencyFromTeacherRows(rows: TeacherLessonChecklistRow[]): PhenomenalCompetencyAggregate[] {
  const rubricRows = PHENOMENAL_COMPETENCY_DEFS.map(({ key, shortLabel }) => {
    const maxLv = PHENOMENAL_METRIC_MAX[key];
    const perRow: number[] = [];
    for (const row of rows) {
      const raw = getRubricFromTeacherRow(row, key);
      const m = mean(formScaleScoresFromRubricCell(raw, maxLv));
      if (m != null) perRow.push(m);
    }
    const g = mean(perRow);
    return {
      key,
      shortLabel,
      mean: g != null ? Math.round(g * 100) / 100 : 0,
      maxLevel: maxLv,
      lessonCount: perRow.length,
    };
  });
  const perRowMeth: number[] = [];
  for (const row of rows) {
    const m = methodologyAvgRawOnTenFromTeacherRow(row);
    if (m != null) perRowMeth.push(m);
  }
  const gM = mean(perRowMeth);
  return [
    ...rubricRows,
    {
      key: 'methodology' as const,
      shortLabel: 'Методика (/10)',
      mean: gM != null ? Math.round(gM * 100) / 100 : 0,
      maxLevel: PHENOMENAL_METHODOLOGY_MAX,
      lessonCount: perRowMeth.length,
    },
  ];
}

export function competencyChartHasData(agg: PhenomenalCompetencyAggregate[]): boolean {
  return agg.some((a) => a.lessonCount > 0);
}

/** Числа 0–10 из строки «оценка методики» (колонка /10). */
export function methodologyRawNumbersFromString(s: string): number[] {
  const out: number[] = [];
  const re = /\b(\d+(?:[.,]\d+)?)\b/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(s)) !== null) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(v) || v < 0 || v > 10) continue;
    const k = String(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length > 12) break;
  }
  return out;
}

/** Средний балл методики по полю «из 10» (сырой 0–10). */
export function methodologyAvgRawOnTen(block: PhenomenalReportBlockDraft): number | null {
  const raw = (block.methodologicalScore ?? '').trim();
  const nums = methodologyRawNumbersFromString(raw);
  if (nums.length) return mean(nums);
  return null;
}

export function methodologyAvgRawOnTenFromTeacherRow(row: TeacherLessonChecklistRow): number | null {
  if (row.methodologicalScore != null && Number.isFinite(row.methodologicalScore)) {
    return row.methodologicalScore;
  }
  return null;
}

export interface PhenomenalBlockRubricScore {
  key: PhenomenalCompetencyKey;
  shortLabel: string;
  /** Средний балл по ячейке на шкале опросника 0…maxLevel */
  mean: number | null;
  maxLevel: number;
}

/** Семь методических рубрик для одного блока урока в редакторе. */
export function competencyRowsForBlock(block: PhenomenalReportBlockDraft): PhenomenalBlockRubricScore[] {
  return PHENOMENAL_COMPETENCY_DEFS.map(({ key, shortLabel }) => {
    const maxLv = PHENOMENAL_METRIC_MAX[key];
    const raw = getRubricFromBlock(block, key);
    const m = mean(formScaleScoresFromRubricCell(raw, maxLv));
    return {
      key,
      shortLabel,
      mean: m != null ? Math.round(m * 100) / 100 : null,
      maxLevel: maxLv,
    };
  });
}

/** То же для одной строки чек-листа педагога (страница загрузки Excel). */
export function competencyRowsForTeacherRow(row: TeacherLessonChecklistRow): PhenomenalBlockRubricScore[] {
  return PHENOMENAL_COMPETENCY_DEFS.map(({ key, shortLabel }) => {
    const maxLv = PHENOMENAL_METRIC_MAX[key];
    const raw = getRubricFromTeacherRow(row, key);
    const m = mean(formScaleScoresFromRubricCell(raw, maxLv));
    return {
      key,
      shortLabel,
      mean: m != null ? Math.round(m * 100) / 100 : null,
      maxLevel: maxLv,
    };
  });
}

/** Метрики для диаграмм и экспорта в Excel (доля от max на общей оси 0–1). */
export interface PhenomenalChartMetric {
  key: string;
  label: string;
  value: number;
  max: number;
  pct: number;
}

export function chartMetricsFromBlockScores(
  rubricRows: PhenomenalBlockRubricScore[],
  methodologyTen: number | null,
): PhenomenalChartMetric[] {
  const out: PhenomenalChartMetric[] = [];
  for (const r of rubricRows) {
    if (r.mean == null) continue;
    out.push({
      key: r.key,
      label: r.shortLabel,
      value: r.mean,
      max: r.maxLevel,
      pct: r.maxLevel > 0 ? Math.min(1, r.mean / r.maxLevel) : 0,
    });
  }
  if (methodologyTen != null && Number.isFinite(methodologyTen)) {
    const v = Math.min(PHENOMENAL_METHODOLOGY_MAX, Math.max(0, methodologyTen));
    out.push({
      key: 'methodology',
      label: 'Методика (/10)',
      value: v,
      max: PHENOMENAL_METHODOLOGY_MAX,
      pct: v / PHENOMENAL_METHODOLOGY_MAX,
    });
  }
  return out;
}

export function methodologyPointsLineForTeacherRow(row: TeacherLessonChecklistRow): string {
  if (row.methodologicalScore != null && Number.isFinite(row.methodologicalScore)) {
    return `${row.methodologicalScore} / 10`;
  }
  return '—';
}

/** Одна строка для свёрнутого summary в таблице загрузки. */
export function teacherRowCompetencySummary(row: TeacherLessonChecklistRow): string {
  const rubric = competencyRowsForTeacherRow(row);
  const meth = methodologyPointsLineForTeacherRow(row);
  const vals = rubric.filter((r) => r.mean != null);
  const rubPart =
    vals.length > 0
      ? `${vals.length}/7 по рубрике (шкалы 0–4 и 0–1)`
      : 'рубрика без чисел';
  return `Методика: ${meth} · ${rubPart} — развернуть баллы и диаграммы`;
}

export function methodologyPointsLineForBlock(block: PhenomenalReportBlockDraft): string {
  const raw = (block.methodologicalScore ?? '').trim();
  const nums = methodologyRawNumbersFromString(raw);
  if (!nums.length) return raw || '—';
  if (nums.length === 1) return `${nums[0]} / 10`;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return `${nums.join(', ')} / 10 · средн. ${avg.toFixed(2)}`;
}

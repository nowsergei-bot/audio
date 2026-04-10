import type { PhenomenalLessonsMergePayload, PhenomenalMergeRow } from '../../types';
import {
  normalizeLessonCodeForGroup,
  type TeacherLessonChecklistRow,
} from './parseTeacherChecklistApril';

export const PHENOMENAL_REPORT_SEED_KEY = 'phenomenal_report_seed_v1';
export const PHENOMENAL_REPORT_AUTOSAVE_KEY = 'phenomenal_report_autosave_v1';

/**
 * Редактируемый черновик отчёта «как лист Отзывы»: поля из Excel педагогов + строки от родителей.
 */
export interface PhenomenalReportReviewLine {
  id: string;
  /** Текст отзыва (можно править) */
  text: string;
  /** Пришло из слияния с ответом родителя */
  fromMergedParent?: boolean;
  /** Подставлено из текстов опроса на Пульсе (обновляется при смене полей блока) */
  fromPulse?: boolean;
}

export interface PhenomenalReportBlockDraft {
  id: string;
  /** Индекс строки в первом Excel (чек-лист); null — блок добавлен вручную */
  sourceTeacherRowIndex: number | null;
  /** Все строки чек-листа, если блок собран по одному шифру из нескольких строк */
  sourceTeacherRowIndices?: number[];
  /** Отметка времени из чек-листа (ISO или как в Excel) */
  submittedAt?: string | null;
  lessonCode: string;
  conductingTeachers: string;
  subjects: string;
  rubricOrganizational?: string;
  rubricGoalSetting?: string;
  rubricTechnologies?: string;
  rubricInformation?: string;
  rubricGeneralContent?: string;
  rubricCultural?: string;
  rubricReflection?: string;
  /** Строка для поля ввода (число или пусто) */
  methodologicalScore: string;
  teacherNotes: string;
  observerName: string;
  /** Класс как в опросе родителей на Пульсе — для точного сопоставления отзывов */
  parentClassLabel?: string;
  matchConfidence?: number;
  reviews: PhenomenalReportReviewLine[];
}

export interface PhenomenalReportDraft {
  title: string;
  periodLabel: string;
  blocks: PhenomenalReportBlockDraft[];
  updatedAt: string;
  /** Опрос родителей на Пульсе (id) — подгрузка отзывов по ссылке для руководителя */
  surveyId?: number | null;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function parentAnswersToReviewText(answers: Record<string, unknown>): string {
  const lines = Object.entries(answers)
    .map(([k, v]) => {
      const val = String(v ?? '').trim();
      if (!val) return '';
      return `${k.trim()}: ${val}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

function uniqueNormalizedStrings(parts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const s = p.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** «Фамилия И.О. — Фамилия Имя Отчество» → оставляем более полное ФИО. */
function preferFullPersonLabel(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Несколько ФИО в ячейке через запятую/; — к каждому применяем preferFullPersonLabel. */
function expandPersonListField(value: string): string {
  const chunks = value
    .split(/[,;/]+/)
    .map((c) => preferFullPersonLabel(c))
    .filter(Boolean);
  return uniqueNormalizedStrings(chunks).join(', ');
}

/** Все оценки подряд + средний балл (для нескольких наблюдений одного урока). */
function formatMethodologyScoresLine(nums: number[]): string {
  if (nums.length === 0) return '';
  if (nums.length === 1) return String(nums[0]);
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;
  const avgRounded = Math.round(avg * 10) / 10;
  const avgStr = Number.isInteger(avgRounded)
    ? String(avgRounded)
    : String(avgRounded).replace('.', ',');
  return `${nums.join(', ')} — средний балл: ${avgStr}`;
}

/** Ключ группы: один блок на нормализованный шифр; без шифра — отдельно по строке чек-листа. */
function phenomenalMergeGroupKey(row: PhenomenalMergeRow): string | null {
  if (row.teacher_row_index == null || !row.teacher) return null;
  const raw = (row.teacher.lessonCode ?? '').replace(/\s+/g, ' ').trim();
  if (raw) return `code:${normalizeLessonCodeForGroup(raw)}`;
  return `row:${row.teacher_row_index}`;
}

function minTeacherRowIndex(rows: PhenomenalMergeRow[]): number {
  return Math.min(...rows.map((r) => r.teacher_row_index ?? Infinity));
}

function scoresFromTeacherSnapshot(t: NonNullable<PhenomenalMergeRow['teacher']>): number[] {
  if (Array.isArray(t.methodologicalScores) && t.methodologicalScores.length) {
    return t.methodologicalScores.filter((n) => typeof n === 'number' && Number.isFinite(n));
  }
  if (t.methodologicalScore != null && Number.isFinite(t.methodologicalScore)) return [t.methodologicalScore];
  return [];
}

function extractParentClassFromMergeRows(rows: PhenomenalMergeRow[]): string {
  for (const r of rows) {
    const a = r.parent?.answers_labeled;
    if (!a || typeof a !== 'object') continue;
    for (const [k, v] of Object.entries(a)) {
      if (/класс/i.test(k)) {
        const s = String(v ?? '').trim();
        if (s) return s;
      }
    }
  }
  return '';
}

function mergeRubricsFromTeachers(
  teachers: NonNullable<PhenomenalMergeRow['teacher']>[],
  pick: (t: NonNullable<PhenomenalMergeRow['teacher']>) => string,
): string {
  return uniqueNormalizedStrings(teachers.map((t) => pick(t) || '')).join('\n');
}

function blockFromMergedGroup(rows: PhenomenalMergeRow[]): PhenomenalReportBlockDraft {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.teacher_row_index ?? 999999;
    const tb = b.teacher_row_index ?? 999999;
    if (ta !== tb) return ta - tb;
    return a.parent_row_index - b.parent_row_index;
  });

  const tiOrder: number[] = [];
  const byTi = new Map<number, NonNullable<PhenomenalMergeRow['teacher']>>();
  for (const r of sorted) {
    if (r.teacher_row_index == null || !r.teacher) continue;
    const ti = r.teacher_row_index;
    if (!byTi.has(ti)) {
      byTi.set(ti, r.teacher);
      tiOrder.push(ti);
    }
  }
  const teachers = tiOrder.map((ti) => byTi.get(ti)!);
  const primary = teachers[0];

  const conductingTeachers = uniqueNormalizedStrings(
    teachers.map((t) => expandPersonListField(t.conductingTeachers)),
  ).join(' · ');
  const subjects = uniqueNormalizedStrings(teachers.map((t) => t.subjects)).join(' · ');
  const teacherNotes = uniqueNormalizedStrings(teachers.map((t) => t.generalThoughts)).join('\n\n');
  const observerName = uniqueNormalizedStrings(
    teachers.map((t) => preferFullPersonLabel(t.observerName.replace(/\s+/g, ' ').trim())),
  ).join(' · ');

  const scoreValues = teachers.flatMap((t) => scoresFromTeacherSnapshot(t));
  const methodologicalScore = formatMethodologyScoresLine(scoreValues);

  const rubricOrganizational = mergeRubricsFromTeachers(teachers, (t) => t.rubricOrganizational ?? '');
  const rubricGoalSetting = mergeRubricsFromTeachers(teachers, (t) => t.rubricGoalSetting ?? '');
  const rubricTechnologies = mergeRubricsFromTeachers(teachers, (t) => t.rubricTechnologies ?? '');
  const rubricInformation = mergeRubricsFromTeachers(teachers, (t) => t.rubricInformation ?? '');
  const rubricGeneralContent = mergeRubricsFromTeachers(teachers, (t) => t.rubricGeneralContent ?? '');
  const rubricCultural = mergeRubricsFromTeachers(teachers, (t) => t.rubricCultural ?? '');
  const rubricReflection = mergeRubricsFromTeachers(teachers, (t) => t.rubricReflection ?? '');

  const confidences = rows.map((r) => r.confidence).filter((c) => Number.isFinite(c));
  const avgConf =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined;

  const seenParent = new Set<number>();
  const reviews: PhenomenalReportReviewLine[] = [];
  for (const r of sorted) {
    if (seenParent.has(r.parent_row_index)) continue;
    seenParent.add(r.parent_row_index);
    reviews.push({
      id: newId('rev'),
      text: r.parent?.answers_labeled ? parentAnswersToReviewText(r.parent.answers_labeled) : '',
      fromMergedParent: true,
    });
  }

  const sortedTi = [...tiOrder].sort((a, b) => a - b);

  return {
    id: newId('blk'),
    sourceTeacherRowIndex: tiOrder.length ? Math.min(...tiOrder) : null,
    sourceTeacherRowIndices: sortedTi.length > 1 ? sortedTi : undefined,
    submittedAt: primary?.submittedAt ?? null,
    lessonCode: primary?.lessonCode ?? '',
    conductingTeachers,
    subjects,
    rubricOrganizational: rubricOrganizational || undefined,
    rubricGoalSetting: rubricGoalSetting || undefined,
    rubricTechnologies: rubricTechnologies || undefined,
    rubricInformation: rubricInformation || undefined,
    rubricGeneralContent: rubricGeneralContent || undefined,
    rubricCultural: rubricCultural || undefined,
    rubricReflection: rubricReflection || undefined,
    methodologicalScore,
    teacherNotes,
    observerName,
    parentClassLabel: extractParentClassFromMergeRows(sorted) || undefined,
    matchConfidence: avgConf,
    reviews,
  };
}

export function buildDraftFromMerge(
  merge: PhenomenalLessonsMergePayload,
  opts?: { title?: string; periodLabel?: string },
): PhenomenalReportDraft {
  const groups = new Map<string, PhenomenalMergeRow[]>();
  for (const row of merge.merged) {
    const k = phenomenalMergeGroupKey(row);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    const da = minTeacherRowIndex(a[1]);
    const db = minTeacherRowIndex(b[1]);
    if (da !== db) return da - db;
    return a[0].localeCompare(b[0]);
  });

  const blocks: PhenomenalReportBlockDraft[] = ordered.map(([, g]) => blockFromMergedGroup(g));

  return {
    title: opts?.title ?? merge.survey?.title ?? 'Отчёт по феноменальным урокам',
    periodLabel: opts?.periodLabel ?? '',
    blocks,
    updatedAt: new Date().toISOString(),
    surveyId: merge.survey?.id ?? null,
  };
}

/** Черновик только из чек-листа педагогов (без отзывов родителей). */
export function buildDraftFromTeacherRows(
  rows: TeacherLessonChecklistRow[],
  opts?: { title?: string; periodLabel?: string },
): PhenomenalReportDraft {
  type Item = { row: TeacherLessonChecklistRow; idx: number };
  const groups = new Map<string, Item[]>();
  rows.forEach((row, idx) => {
    const raw = (row.lessonCode ?? '').replace(/\s+/g, ' ').trim();
    const key = raw ? `code:${normalizeLessonCodeForGroup(raw)}` : `row:${idx}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ row, idx });
  });

  const ordered = [...groups.entries()].sort((a, b) => {
    const ma = Math.min(...a[1].map((x) => x.idx));
    const mb = Math.min(...b[1].map((x) => x.idx));
    return ma - mb;
  });

  const blocks: PhenomenalReportBlockDraft[] = ordered.map(([, items]) => {
    items.sort((a, b) => a.idx - b.idx);
    const list = items.map((i) => i.row);
    const primary = list[0];
    const indices = items.map((i) => i.idx).sort((a, b) => a - b);
    const scoreValues = list.map((r) => r.methodologicalScore).filter((x): x is number => x != null);
    return {
      id: newId('blk'),
      sourceTeacherRowIndex: indices[0]!,
      sourceTeacherRowIndices: indices.length > 1 ? indices : undefined,
      submittedAt: primary.submittedAt ?? null,
      lessonCode: primary.lessonCode ?? '',
      conductingTeachers: uniqueNormalizedStrings(list.map((r) => expandPersonListField(r.conductingTeachers))).join(
        ' · ',
      ),
      subjects: uniqueNormalizedStrings(list.map((r) => r.subjects)).join(' · '),
      rubricOrganizational: uniqueNormalizedStrings(list.map((r) => r.rubricOrganizational)).join('\n') || undefined,
      rubricGoalSetting: uniqueNormalizedStrings(list.map((r) => r.rubricGoalSetting)).join('\n') || undefined,
      rubricTechnologies: uniqueNormalizedStrings(list.map((r) => r.rubricTechnologies)).join('\n') || undefined,
      rubricInformation: uniqueNormalizedStrings(list.map((r) => r.rubricInformation)).join('\n') || undefined,
      rubricGeneralContent: uniqueNormalizedStrings(list.map((r) => r.rubricGeneralContent)).join('\n') || undefined,
      rubricCultural: uniqueNormalizedStrings(list.map((r) => r.rubricCultural)).join('\n') || undefined,
      rubricReflection: uniqueNormalizedStrings(list.map((r) => r.rubricReflection)).join('\n') || undefined,
      methodologicalScore: formatMethodologyScoresLine(scoreValues),
      teacherNotes: uniqueNormalizedStrings(list.map((r) => r.generalThoughts)).join('\n\n'),
      observerName: uniqueNormalizedStrings(
        list.map((r) => preferFullPersonLabel(r.observerName.replace(/\s+/g, ' ').trim())),
      ).join(' · '),
      reviews: [],
    };
  });

  return {
    title: opts?.title ?? 'Черновик из чек-листа педагогов',
    periodLabel: opts?.periodLabel ?? '',
    blocks,
    updatedAt: new Date().toISOString(),
    surveyId: null,
  };
}

const RUBRIC_FIELD_KEYS = [
  'rubricOrganizational',
  'rubricGoalSetting',
  'rubricTechnologies',
  'rubricInformation',
  'rubricGeneralContent',
  'rubricCultural',
  'rubricReflection',
] as const;

type RubricFieldKey = (typeof RUBRIC_FIELD_KEYS)[number];

function extractMethodologyNumbersFromScoreString(s: string): number[] {
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
    if (out.length >= 12) break;
  }
  return out;
}

function mergeRubricFieldFromBlocks(
  blocks: PhenomenalReportBlockDraft[],
  pick: (b: PhenomenalReportBlockDraft) => string | undefined,
): string | undefined {
  const s = uniqueNormalizedStrings(blocks.map((b) => pick(b) || '')).join('\n');
  return s || undefined;
}

/** Слияние нескольких блоков черновика в один (по группе индексов после ИИ). */
export function mergePhenomenalReportBlockGroup(
  blocks: PhenomenalReportBlockDraft[],
  indices: number[],
): PhenomenalReportBlockDraft {
  const sortedIdx = [...indices].sort((a, b) => a - b);
  const list = sortedIdx.map((i) => blocks[i]);
  const primary = list[0];

  const codes = list.map((b) => b.lessonCode.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const lessonCode = codes.length ? codes.reduce((a, b) => (b.length > a.length ? b : a), codes[0]) : primary.lessonCode;

  const conductingTeachers = uniqueNormalizedStrings(list.map((b) => expandPersonListField(b.conductingTeachers))).join(
    ' · ',
  );
  const subjects = uniqueNormalizedStrings(list.map((b) => b.subjects)).join(' · ');
  const observerName = uniqueNormalizedStrings(
    list.map((b) => preferFullPersonLabel(b.observerName.replace(/\s+/g, ' ').trim())),
  ).join(' · ');
  const teacherNotes = uniqueNormalizedStrings(list.map((b) => b.teacherNotes)).join('\n\n');

  const rubricPatch: Partial<Pick<PhenomenalReportBlockDraft, RubricFieldKey>> = {};
  for (const k of RUBRIC_FIELD_KEYS) {
    const merged = mergeRubricFieldFromBlocks(list, (b) => b[k]);
    if (merged) rubricPatch[k] = merged;
  }

  const methNums = sortedIdx.flatMap((i) => extractMethodologyNumbersFromScoreString(blocks[i].methodologicalScore));
  const methodologicalScore =
    methNums.length > 0
      ? formatMethodologyScoresLine(methNums)
      : uniqueNormalizedStrings(list.map((b) => b.methodologicalScore)).join(' · ') || '';

  const seenRev = new Set<string>();
  const reviews: PhenomenalReportReviewLine[] = [];
  for (const b of list) {
    for (const r of b.reviews) {
      const k = r.text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!k) continue;
      if (seenRev.has(k)) continue;
      seenRev.add(k);
      reviews.push({ ...r, id: newId('rev') });
    }
  }

  const allTi: number[] = [];
  for (const b of list) {
    if (b.sourceTeacherRowIndices?.length) allTi.push(...b.sourceTeacherRowIndices);
    else if (b.sourceTeacherRowIndex != null) allTi.push(b.sourceTeacherRowIndex);
  }
  const uniqTi = [...new Set(allTi)].sort((a, b) => a - b);
  const sourceTeacherRowIndex = uniqTi.length ? uniqTi[0]! : null;
  const sourceTeacherRowIndices = uniqTi.length > 1 ? uniqTi : undefined;

  const confs = list.map((b) => b.matchConfidence).filter((c): c is number => c != null && Number.isFinite(c));
  const matchConfidence =
    confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : undefined;

  const submittedAt =
    list.map((b) => b.submittedAt).find((x) => x != null && String(x).trim() !== '') ?? primary.submittedAt ?? null;

  return {
    id: newId('blk'),
    sourceTeacherRowIndex,
    sourceTeacherRowIndices,
    submittedAt,
    lessonCode,
    conductingTeachers,
    subjects,
    ...rubricPatch,
    methodologicalScore,
    teacherNotes,
    observerName,
    matchConfidence,
    reviews,
  };
}

export function validatePhenomenalBlockClusterGroups(groups: number[][], blockCount: number): boolean {
  if (blockCount < 1 || !Array.isArray(groups) || groups.length === 0) return false;
  const seen = new Set<number>();
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return false;
    for (const x of g) {
      const i = Number(x);
      if (!Number.isInteger(i) || i < 0 || i >= blockCount) return false;
      if (seen.has(i)) return false;
      seen.add(i);
    }
  }
  return seen.size === blockCount;
}

/** Применить ответ ИИ: groups — массив групп индексов блоков. Возвращает null, если разбиение некорректно. */
export function applyPhenomenalBlockClusterGroups(
  blocks: PhenomenalReportBlockDraft[],
  groups: number[][],
): PhenomenalReportBlockDraft[] | null {
  if (!validatePhenomenalBlockClusterGroups(groups, blocks.length)) return null;
  return groups.map((g) =>
    g.length === 1 ? { ...blocks[g[0]!] } : mergePhenomenalReportBlockGroup(blocks, g),
  );
}

export function emptyBlock(): PhenomenalReportBlockDraft {
  return {
    id: newId('blk'),
    sourceTeacherRowIndex: null,
    lessonCode: '',
    conductingTeachers: '',
    subjects: '',
    methodologicalScore: '',
    teacherNotes: '',
    observerName: '',
    parentClassLabel: '',
    reviews: [],
  };
}

export function emptyReviewLine(): PhenomenalReportReviewLine {
  return { id: newId('rev'), text: '' };
}

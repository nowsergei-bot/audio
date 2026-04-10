import * as XLSX from 'xlsx';
import { looksLikeRubricLevelNotSubjects } from './parentReviewFormat';

/** Строка экспорта Google Forms «lesson checklist April» (14 колонок, лист с ответами). */
export interface TeacherLessonChecklistRow {
  submittedAt: string | null;
  observerName: string;
  subjects: string;
  lessonCode: string;
  conductingTeachers: string;
  rubricOrganizational: string;
  rubricGoalSetting: string;
  rubricTechnologies: string;
  rubricInformation: string;
  rubricGeneralContent: string;
  rubricCultural: string;
  rubricReflection: string;
  generalThoughts: string;
  methodologicalScore: number | null;
}

export interface ParseTeacherChecklistResult {
  sheetName: string;
  rows: TeacherLessonChecklistRow[];
  warnings: string[];
}

const HEADER_MARKERS = ['ФИО педагога, посетившего урок', 'Шифр урока', 'ФИО педагогов, проводивших'];

/** Индексы колонок по умолчанию (экспорт Google Forms «апрель»). */
const LEGACY_COL = {
  submittedAt: 0,
  observerName: 1,
  subjects: 2,
  lessonCode: 3,
  conductingTeachers: 4,
  rubricOrganizational: 5,
  rubricGoalSetting: 6,
  rubricTechnologies: 7,
  rubricInformation: 8,
  rubricGeneralContent: 9,
  rubricCultural: 10,
  rubricReflection: 11,
  generalThoughts: 12,
  methodologicalScore: 13,
} as const;

type ColKey = keyof typeof LEGACY_COL;

function headerCell(h: unknown): string {
  return String(h ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Находит лист, где в первой строке есть и «шифр», и «проводивш» (ведущие педагоги).
 * Так попадаем на «Ответы на форму», даже если это не первый таб в .xlsx.
 */
function pickSheetMatrix(wb: XLSX.WorkBook): { sheetName: string; matrix: unknown[][] } {
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    if (!sh) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true });
    if (!matrix.length) continue;
    const joined = matrix[0].map((c) => headerCell(c).toLowerCase()).join(' | ');
    if (/шифр/.test(joined) && /проводивш/.test(joined)) {
      return { sheetName: name, matrix };
    }
  }
  const name = wb.SheetNames[0] || 'Sheet1';
  const sh = wb.Sheets[name];
  const matrix = sh
    ? XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true })
    : [];
  return { sheetName: name, matrix };
}

/**
 * Сопоставление колонок по заголовкам (другой порядок / лишние столбцы в выгрузке).
 * Если не нашли шифр и ведущих — null → чтение по LEGACY_COL.
 * В карте обязательны lessonCode и conductingTeachers; остальные ключи опциональны.
 */
type ColumnMap = Partial<Record<ColKey, number>> & {
  lessonCode: number;
  conductingTeachers: number;
};

function resolveColumnMap(headerRow: unknown[]): ColumnMap | null {
  const headers = headerRow.map((c) => headerCell(c));
  const lower = headers.map((h) => h.toLowerCase());

  const find = (pred: (h: string, i: number) => boolean): number => {
    for (let i = 0; i < headers.length; i++) {
      if (pred(lower[i], i)) return i;
    }
    return -1;
  };

  const ixCode = find((h) => /шифр\s*урока?/i.test(h) || /^шифр$/i.test(h.trim()));
  const ixLed = find(
    (h) =>
      (/фио|педагог/i.test(h) && /проводивш/i.test(h) && !/посетивш/i.test(h)) ||
      (/ведущ/i.test(h) && /педагог/i.test(h)),
  );

  if (ixCode < 0 || ixLed < 0) return null;

  const map = {} as ColumnMap;
  map.lessonCode = ixCode;
  map.conductingTeachers = ixLed;

  const ixTime = find((h) => /отметка\s*времени/i.test(h) || /^timestamp$/i.test(h));
  if (ixTime >= 0) map.submittedAt = ixTime;

  const ixObs = find((h) => (/фио|педагог/i.test(h) && /посетивш/i.test(h)) || /наблюдател/i.test(h));
  if (ixObs >= 0) map.observerName = ixObs;

  let ixSubj = find(
    (h) =>
      /перечень.*тем/i.test(h) ||
      /изученн.*тем/i.test(h) ||
      (/предмет/i.test(h) && /тем/i.test(h)) ||
      /^перечень изученных/i.test(h.trim()),
  );
  if (ixSubj < 0) {
    ixSubj = find((h) => {
      const t = h.toLowerCase();
      if (!/предмет|тематик|дисциплин|направленност|раздел/i.test(t)) return false;
      if (/оцените|итогов|методич|ведущ|посетивш|шифр|фио.*провод/i.test(t)) return false;
      return true;
    });
  }
  if (ixSubj >= 0) map.subjects = ixSubj;

  const ixR0 = find((h) => /организац.*пространств/i.test(h));
  if (ixR0 >= 0) map.rubricOrganizational = ixR0;
  const ixR1 = find((h) => /целеполагани/i.test(h));
  if (ixR1 >= 0) map.rubricGoalSetting = ixR1;
  const ixR2 = find((h) => /технологи.*обучен/i.test(h));
  if (ixR2 >= 0) map.rubricTechnologies = ixR2;
  const ixR3 = find((h) => /информационн.*культур/i.test(h));
  if (ixR3 >= 0) map.rubricInformation = ixR3;
  const ixR4 = find((h) => /содержательн.*общезначим/i.test(h));
  if (ixR4 >= 0) map.rubricGeneralContent = ixR4;
  const ixR5 = find((h) => /культурологическ/i.test(h));
  if (ixR5 >= 0) map.rubricCultural = ixR5;
  const ixR6 = find((h) => /рефлексивн/i.test(h));
  if (ixR6 >= 0) map.rubricReflection = ixR6;
  const ixGt = find((h) => /общие\s+мысли/i.test(h));
  if (ixGt >= 0) map.generalThoughts = ixGt;
  const ixScore = find((h) => /итогов|методич.*эффективн|из\s*10/i.test(h));
  if (ixScore >= 0) map.methodologicalScore = ixScore;

  return map;
}

function cellAt(
  r: unknown[],
  map: ColumnMap | null,
  key: ColKey,
  legacy: number,
): unknown {
  if (map && typeof map[key] === 'number') {
    const i = map[key]!;
    if (i >= 0 && i < r.length) return r[i];
    return '';
  }
  return legacy < r.length ? r[legacy] : '';
}

/**
 * Первая строка листа — как в экспорте Google Forms «lesson checklist April»,
 * чтобы выгрузка с сайта снова открывалась парсером и по структуре совпадала с исходником.
 */
export const TEACHER_CHECKLIST_APRIL_HEADER_ROW: readonly string[] = [
  'Отметка времени',
  'ФИО педагога, посетившего урок',
  'Перечень изученных на уроке тем, предметов, направленностей, разделов.',
  'Шифр урока',
  'ФИО педагогов, проводивших урок',
  'Оцените организацию образовательного пространства',
  'Оцените целеполагание и структуру урока',
  'Оцените технологии обучения',
  'Оцените информационную культуру учителя',
  'Оцените содержательную общезначимость урока',
  'Оцените культурологическую направленность урока',
  'Оцените рефлексивность урока',
  'Общие мысли о уроке',
  'Итоговая оценка методической эффективности урока (из 10 баллов)',
];

function strCell(v: unknown): string {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function submittedIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

function scoreCell(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Нормализация шифра урока для объединения строк чек-листа и слияния в один блок отчёта. */
export function normalizeLessonCodeForGroup(lessonCode: string): string {
  return lessonCode.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Ключ для сопоставления с ответами родителей: шифр урока + нормализованные ФИО ведущих.
 */
export function buildLessonMatchKey(lessonCode: string, conductingTeachers: string): string {
  const code = normalizeLessonCodeForGroup(lessonCode);
  const names = conductingTeachers
    .split(/[,;/]+/)
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
  return `${code}::${names}`;
}

export function parseTeacherChecklistAprilWorkbook(wb: XLSX.WorkBook): ParseTeacherChecklistResult {
  const warnings: string[] = [];
  const { sheetName, matrix } = pickSheetMatrix(wb);
  if (!matrix.length) {
    return { sheetName, rows: [], warnings: ['Пустой лист'] };
  }

  const headerJoined = matrix[0].map((c) => String(c)).join('\n');
  if (!HEADER_MARKERS.every((m) => headerJoined.includes(m))) {
    warnings.push(
      'Заголовки частично отличаются от шаблона апреля — колонки «шифр» и «проводившие» ищутся по тексту заголовка; если слияние пустое, проверьте имена столбцов.',
    );
  }

  const colMap = resolveColumnMap(matrix[0]);
  if (colMap) {
    warnings.push(
      `Колонки сопоставлены по заголовкам (лист «${sheetName}»): шифр → ${colMap.lessonCode + 1}, ведущие → ${colMap.conductingTeachers + 1}.`,
    );
  }

  const rows: TeacherLessonChecklistRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r)) continue;
    const nonempty = r.some((c) => c !== '' && c != null);
    if (!nonempty) continue;

    let subjects = strCell(cellAt(r, colMap, 'subjects', LEGACY_COL.subjects));
    if (looksLikeRubricLevelNotSubjects(subjects)) subjects = '';

    rows.push({
      submittedAt: submittedIso(cellAt(r, colMap, 'submittedAt', LEGACY_COL.submittedAt)),
      observerName: strCell(cellAt(r, colMap, 'observerName', LEGACY_COL.observerName)),
      subjects,
      lessonCode: strCell(cellAt(r, colMap, 'lessonCode', LEGACY_COL.lessonCode)),
      conductingTeachers: strCell(cellAt(r, colMap, 'conductingTeachers', LEGACY_COL.conductingTeachers)),
      rubricOrganizational: strCell(
        cellAt(r, colMap, 'rubricOrganizational', LEGACY_COL.rubricOrganizational),
      ),
      rubricGoalSetting: strCell(cellAt(r, colMap, 'rubricGoalSetting', LEGACY_COL.rubricGoalSetting)),
      rubricTechnologies: strCell(cellAt(r, colMap, 'rubricTechnologies', LEGACY_COL.rubricTechnologies)),
      rubricInformation: strCell(cellAt(r, colMap, 'rubricInformation', LEGACY_COL.rubricInformation)),
      rubricGeneralContent: strCell(
        cellAt(r, colMap, 'rubricGeneralContent', LEGACY_COL.rubricGeneralContent),
      ),
      rubricCultural: strCell(cellAt(r, colMap, 'rubricCultural', LEGACY_COL.rubricCultural)),
      rubricReflection: strCell(cellAt(r, colMap, 'rubricReflection', LEGACY_COL.rubricReflection)),
      generalThoughts: strCell(cellAt(r, colMap, 'generalThoughts', LEGACY_COL.generalThoughts)),
      methodologicalScore: scoreCell(
        cellAt(r, colMap, 'methodologicalScore', LEGACY_COL.methodologicalScore),
      ),
    });
  }

  return { sheetName, rows, warnings };
}

export function readTeacherChecklistAprilArrayBuffer(buf: ArrayBuffer): ParseTeacherChecklistResult {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return parseTeacherChecklistAprilWorkbook(wb);
}

import * as XLSX from 'xlsx';

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
  const sheetName = wb.SheetNames[0] || 'Sheet1';
  const sh = wb.Sheets[sheetName];
  if (!sh) {
    return { sheetName, rows: [], warnings: ['В книге нет первого листа'] };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true });
  if (!matrix.length) {
    return { sheetName, rows: [], warnings: ['Пустой лист'] };
  }

  const headerJoined = matrix[0].map((c) => String(c)).join('\n');
  if (!HEADER_MARKERS.every((m) => headerJoined.includes(m))) {
    warnings.push(
      'Заголовки не похожи на шаблон чек-листа педагогов (апрель). Проверьте файл; разбор идёт по фиксированным колонкам 0–13.',
    );
  }

  const rows: TeacherLessonChecklistRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r)) continue;
    const nonempty = r.some((c) => c !== '' && c != null);
    if (!nonempty) continue;

    rows.push({
      submittedAt: submittedIso(r[0]),
      observerName: strCell(r[1]),
      subjects: strCell(r[2]),
      lessonCode: strCell(r[3]),
      conductingTeachers: strCell(r[4]),
      rubricOrganizational: strCell(r[5]),
      rubricGoalSetting: strCell(r[6]),
      rubricTechnologies: strCell(r[7]),
      rubricInformation: strCell(r[8]),
      rubricGeneralContent: strCell(r[9]),
      rubricCultural: strCell(r[10]),
      rubricReflection: strCell(r[11]),
      generalThoughts: strCell(r[12]),
      methodologicalScore: scoreCell(r[13]),
    });
  }

  return { sheetName, rows, warnings };
}

export function readTeacherChecklistAprilArrayBuffer(buf: ArrayBuffer): ParseTeacherChecklistResult {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return parseTeacherChecklistAprilWorkbook(wb);
}

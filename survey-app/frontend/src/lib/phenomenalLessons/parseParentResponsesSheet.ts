import * as XLSX from 'xlsx';

/** Одна строка выгрузки (Google Forms / произвольный Excel): заголовки колонок → значения. */
export interface ParentResponsesSheetRow {
  answers_labeled: Record<string, string>;
  /** Если в таблице есть колонка времени — подставляется для сортировки/LLM */
  created_at?: string;
}

export interface ParseParentResponsesResult {
  sheetName: string;
  rows: ParentResponsesSheetRow[];
  warnings: string[];
}

function strCell(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    try {
      return v.toISOString();
    } catch {
      return String(v);
    }
  }
  return String(v).trim();
}

function headerCell(v: unknown, idx: number): string {
  const s = strCell(v);
  if (s) return s.replace(/\s+/g, ' ').trim();
  return `Колонка ${idx + 1}`;
}

/**
 * Первый лист: строка 0 — заголовки, далее — ответы (как экспорт Google Forms или ручная таблица).
 */
export function readParentResponsesSheetArrayBuffer(buf: ArrayBuffer): ParseParentResponsesResult {
  const warnings: string[] = [];
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0] || 'Sheet1';
  const sh = wb.Sheets[sheetName];
  if (!sh) {
    return { sheetName, rows: [], warnings: ['Пустая книга'] };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true });
  if (!matrix.length) {
    return { sheetName, rows: [], warnings: ['Пустой лист'] };
  }

  const headerRow = matrix[0];
  if (!Array.isArray(headerRow)) {
    return { sheetName, rows: [], warnings: ['Некорректная строка заголовков'] };
  }

  const headers = headerRow.map((h, i) => headerCell(h, i));
  const timeHeaderIdx = headers.findIndex(
    (h) =>
      /отметка\s*времени|timestamp|time\s*stamp|дата\s*отправки/i.test(h) ||
      /^date$/i.test(h),
  );

  const rows: ParentResponsesSheetRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!Array.isArray(line)) continue;
    const nonempty = line.some((c) => c !== '' && c != null);
    if (!nonempty) continue;

    const answers_labeled: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = strCell(line[c]);
      if (val) answers_labeled[key] = val;
    }
    if (Object.keys(answers_labeled).length === 0) continue;

    let created_at: string | undefined;
    if (timeHeaderIdx >= 0) {
      const raw = line[timeHeaderIdx];
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        created_at = raw.toISOString();
      } else {
        const t = strCell(raw);
        if (t) created_at = t;
      }
    }

    rows.push({ answers_labeled, ...(created_at ? { created_at } : {}) });
  }

  if (rows.length > 0 && timeHeaderIdx < 0) {
    warnings.push(
      'Колонка времени не распознана по заголовку — даты в «создано» не заполнены; сопоставление всё равно идёт по всем ячейкам.',
    );
  }

  return { sheetName, rows, warnings };
}

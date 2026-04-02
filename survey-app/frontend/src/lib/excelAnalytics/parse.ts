import * as XLSX from 'xlsx';

const MAX_SHEETS = 24;
const MAX_MATRIX_ROWS = 12000;
const MAX_COLS = 120;

export type CellPrimitive = string | number | boolean | Date | null;

function normalizeCell(c: unknown): CellPrimitive {
  if (c == null || c === '') return null;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'boolean') return c;
  if (c instanceof Date) return c;
  const s = String(c);
  return s.length > 8000 ? `${s.slice(0, 7997)}…` : s;
}

/** Сырые имена листов и матрица без нормализации строки заголовков. */
export function readWorkbookMeta(buffer: ArrayBuffer): { sheetNames: string[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return { sheetNames: wb.SheetNames.slice(0, MAX_SHEETS).map((n) => n.slice(0, 120)) };
}

export function getSheetMatrix(buffer: ArrayBuffer, sheetName: string): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sh = wb.Sheets[sheetName];
  if (!sh) throw new Error(`Лист «${sheetName}» не найден`);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true }) as unknown[][];
  return matrix.slice(0, MAX_MATRIX_ROWS);
}

/**
 * @param headerRow1Based номер строки с заголовками (1 = первая строка файла)
 */
export function extractHeadersAndRows(
  matrix: unknown[][],
  headerRow1Based: number,
  maxDataRows: number,
): { headers: string[]; rows: CellPrimitive[][] } {
  if (headerRow1Based < 1) throw new Error('Номер строки заголовков должен быть ≥ 1');
  const idx = headerRow1Based - 1;
  if (idx >= matrix.length) throw new Error('Строка заголовков за пределами листа');

  const headerRow = matrix[idx] ?? [];
  const headers = Array.from({ length: MAX_COLS }, (_, i) => {
    const h = headerRow[i];
    return String(h ?? '').trim() || `Колонка ${i + 1}`;
  });

  const rows: CellPrimitive[][] = [];
  for (let r = idx + 1; r < matrix.length && rows.length < maxDataRows; r++) {
    const line = matrix[r];
    const arr = Array.isArray(line) ? line : [];
    const row = headers.map((_, i) => normalizeCell(arr[i]));
    if (row.every((c) => c == null || c === '')) continue;
    rows.push(row);
  }

  return { headers, rows };
}

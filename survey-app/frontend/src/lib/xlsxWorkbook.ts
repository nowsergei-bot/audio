import * as XLSX from 'xlsx';
import type { WorkbookSheet } from '../types';

const MAX_SHEETS = 12;
const MAX_ROWS = 400;
const MAX_COLS = 80;

function normalizeCell(c: unknown): string | number | boolean | null {
  if (c == null || c === '') return null;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'boolean') return c;
  if (c instanceof Date) return c.toISOString().slice(0, 19);
  const s = String(c);
  return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
}

/** Произвольная книга Excel для блока «дополнительная статистика» (без привязки к вопросам опроса). */
export function parseWorkbookXlsxBuffer(buffer: ArrayBuffer): { sheets: WorkbookSheet[] } {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets: WorkbookSheet[] = [];

  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const sh = wb.Sheets[name];
    if (!sh) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true }) as unknown[][];
    if (!matrix.length) continue;

    const headers = matrix[0].slice(0, MAX_COLS).map((h) => String(h ?? ''));
    if (!headers.some((h) => h.trim())) continue;

    const rows: (string | number | boolean | null)[][] = [];
    for (let r = 1; r < matrix.length && rows.length < MAX_ROWS; r++) {
      const line = matrix[r];
      const arr = Array.isArray(line) ? line : [];
      const row = headers.map((_, i) => normalizeCell(arr[i]));
      if (row.every((c) => c == null || c === '')) continue;
      rows.push(row);
    }

    sheets.push({ name: name.slice(0, 120), headers, rows });
  }

  if (!sheets.length) {
    throw new Error('Не удалось извлечь таблицы: проверьте, что на листе есть строка заголовков');
  }

  return { sheets };
}

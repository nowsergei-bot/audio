import type { WorkbookSheet } from '../types';
import { parseWorkbookXlsxBuffer } from './xlsxWorkbook';

export interface PedagogicalExcelParseResult {
  /** По одному текстовому блоку на строку таблицы (педагог); для сервера — псевдонимизация с обходом каждого блока. */
  blocks: string[];
  /** Склейка блоков для показа и редактирования в одном поле. */
  plain: string;
  teacherColumnIndex: number;
  rowCount: number;
  headers: string[];
  sheetName: string;
}

const BLOCK_SEPARATOR = '\n\n';

function scoreTeacherHeader(h: string): number {
  const s = h.trim();
  if (!s) return 0;
  let n = 0;
  if (/педагог|учитель|teacher/i.test(s)) n += 3;
  if (/фио|ф\.?\s*и\.?\s*о/i.test(s)) n += 2;
  if (/фамилия|имя|отчество/i.test(s)) n += 1;
  return n;
}

function fmtCell(c: unknown): string {
  if (c == null || c === '') return '';
  if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  if (typeof c === 'boolean') return c ? 'да' : 'нет';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const t = String(c);
  return t.length > 2000 ? `${t.slice(0, 1997)}…` : t;
}

function sheetToBlocks(sh: WorkbookSheet): PedagogicalExcelParseResult {
  const { headers, rows, name } = sh;
  if (!headers.length || !rows.length) {
    throw new Error('На первом листе нужны строка заголовков и хотя бы одна строка данных');
  }

  let teacherCol = 0;
  let best = -1;
  headers.forEach((h, i) => {
    const sc = scoreTeacherHeader(h);
    if (sc > best) {
      best = sc;
      teacherCol = i;
    }
  });
  if (best <= 0) teacherCol = 0;

  const blocks: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const teacherRaw = fmtCell(row[teacherCol]).trim();
    const teacher = teacherRaw || `(строка ${r + 2}, ФИО не указано)`;
    const lines: string[] = [`Педагог: ${teacher}`];
    for (let c = 0; c < headers.length; c++) {
      const hdr = String(headers[c] ?? '').trim();
      if (!hdr) continue;
      const v = fmtCell(row[c]).trim();
      if (!v) continue;
      lines.push(`${hdr}: ${v}`);
    }
    if (lines.length <= 1) continue;
    blocks.push(lines.join('\n'));
  }

  if (!blocks.length) {
    throw new Error('Не удалось собрать ни одной строки с данными');
  }

  return {
    blocks,
    plain: blocks.join(BLOCK_SEPARATOR),
    teacherColumnIndex: teacherCol,
    rowCount: blocks.length,
    headers: headers.map((h) => String(h ?? '')),
    sheetName: name,
  };
}

/** Первый лист книги → блоки по строкам (один педагог = один блок для поэтапной псевдонимизации на сервере). */
export function parsePedagogicalExcelBuffer(buffer: ArrayBuffer): PedagogicalExcelParseResult {
  const { sheets } = parseWorkbookXlsxBuffer(buffer);
  const sh = sheets[0];
  if (!sh) throw new Error('В файле нет подходящего листа');
  return sheetToBlocks(sh);
}

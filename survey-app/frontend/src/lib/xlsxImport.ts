import * as XLSX from 'xlsx';
import type { AnswerSubmit, Question } from '../types';

const SKIP_HEADER =
  /^(id|id\s|№|номер|почта|email|время|timestamp|респондент|respondent|имя|фамилия|телефон|дата\s+ответа|дата\s+заполнения)$/i;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveHeaderToQuestionId(header: string, sorted: Question[], used: Set<number>): number | null {
  const raw = String(header ?? '').trim();
  if (!raw || SKIP_HEADER.test(raw)) return null;

  const m = /^q_?(\d+)$/i.exec(raw);
  if (m) {
    const id = Number(m[1]);
    if (sorted.some((q) => q.id === id) && !used.has(id)) return id;
    return null;
  }
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (sorted.some((q) => q.id === id) && !used.has(id)) return id;
    return null;
  }

  const n = norm(raw);
  for (const q of sorted) {
    if (used.has(q.id)) continue;
    if (norm(q.text) === n) return q.id;
  }
  for (const q of sorted) {
    if (used.has(q.id)) continue;
    if (n.length >= 8 && norm(q.text).includes(n)) return q.id;
  }
  return null;
}

export function buildColumnMap(headers: string[], questions: Question[]): (number | null)[] {
  const sorted = [...questions].sort((a, b) => a.sort_order - b.sort_order);
  const used = new Set<number>();
  const map: (number | null)[] = headers.map(() => null);

  for (let c = 0; c < headers.length; c++) {
    const qid = resolveHeaderToQuestionId(headers[c], sorted, used);
    if (qid != null) {
      map[c] = qid;
      used.add(qid);
    }
  }

  let qi = 0;
  for (let c = 0; c < headers.length; c++) {
    if (map[c] != null) continue;
    const raw = String(headers[c] ?? '').trim();
    if (!raw || SKIP_HEADER.test(raw)) continue;
    while (qi < sorted.length && used.has(sorted[qi].id)) qi++;
    if (qi >= sorted.length) break;
    map[c] = sorted[qi].id;
    used.add(sorted[qi].id);
    qi++;
  }

  return map;
}

function cellToPrimitive(cell: unknown): string | number | boolean | Date | null {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
  if (typeof cell === 'boolean') return cell;
  if (cell instanceof Date) return cell;
  return String(cell);
}

function excelSerialToIsoDate(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  // Excel serial date base (Windows): 1899-12-30
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function coerceCell(cell: unknown, q: Question): string | number | string[] | null {
  const v = cellToPrimitive(cell);
  if (v == null) return null;
  if (v instanceof Date) {
    const s = v.toISOString().slice(0, 10);
    return q.type === 'text' || q.type === 'radio' || q.type === 'date' ? s : null;
  }
  if (typeof v === 'boolean') {
    const s = v ? 'да' : 'нет';
    return q.type === 'text' || q.type === 'radio' ? s : null;
  }
  if (q.type === 'text') {
    const s = String(v).trim();
    return s.length ? s : null;
  }
  if (q.type === 'radio') {
    const s = String(v).trim();
    return s.length ? s : null;
  }
  if (q.type === 'date') {
    if (typeof v === 'number') return excelSerialToIsoDate(v);
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (q.type === 'scale' || q.type === 'rating') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  if (q.type === 'checkbox') {
    const s = String(v).trim();
    if (!s) return null;
    const parts = s.split(/[,;|\n\r]+/).map((x) => x.trim()).filter(Boolean);
    return parts.length ? parts : null;
  }
  return null;
}

export type ParsedImportBatch = {
  rows: { answers: AnswerSubmit[] }[];
  warnings: string[];
  columnMap: (number | null)[];
  headers: string[];
};

const MAX_CLIENT_ROWS = 3000;

export function parseSurveyXlsxBuffer(buffer: ArrayBuffer, questions: Question[]): ParsedImportBatch {
  if (!questions.length) {
    throw new Error('В опросе нет вопросов для сопоставления столбцов');
  }

  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) throw new Error('В книге нет листов');
  const sheet = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  }) as unknown[][];

  if (!matrix.length) throw new Error('Пустой лист');

  const headers = matrix[0].map((h) => String(h ?? ''));
  const colMap = buildColumnMap(headers, questions);
  const byId = new Map(questions.map((q) => [q.id, q]));

  const rows: { answers: AnswerSubmit[] }[] = [];
  const warnings: string[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every((c) => c == null || String(c).trim() === '')) continue;

    const answers: AnswerSubmit[] = [];
    for (let c = 0; c < colMap.length; c++) {
      const qid = colMap[c];
      if (qid == null) continue;
      const q = byId.get(qid);
      if (!q) continue;
      const val = coerceCell(line[c], q);
      if (val == null) continue;
      answers.push({ question_id: qid, value: val });
    }

    if (answers.length) {
      rows.push({ answers });
    } else {
      warnings.push(`Строка ${r + 1} таблицы: не удалось сопоставить ответы с вопросами (проверьте заголовки).`);
    }
  }

  if (rows.length > MAX_CLIENT_ROWS) {
    warnings.push(`Отправлены только первые ${MAX_CLIENT_ROWS} непустых строк (лимит за один импорт).`);
    return {
      rows: rows.slice(0, MAX_CLIENT_ROWS),
      warnings,
      columnMap: colMap,
      headers,
    };
  }

  return { rows, warnings, columnMap: colMap, headers };
}

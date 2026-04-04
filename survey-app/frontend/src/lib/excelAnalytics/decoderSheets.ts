import * as XLSX from 'xlsx';

const MAX_SHEETS = 24;
const MAX_MATRIX_ROWS = 800;
const MAX_COLS = 40;
const MAX_PAIR_LINES = 450;
const MAX_BLOCK_CHARS = 12000;

function cellToString(c: unknown): string {
  if (c == null || c === '') return '';
  if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = String(c).trim();
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}

const CODE_HEADER =
  /шифр|код\s*педагог|код\s*учител|teacher\s*(id|code)|^код$|код\s*наставник|id\s*педагог|teacher\s*key/i;
const NAME_HEADER =
  /фио|наставник(?!\s*класс)|^педагог$|фамилия|имя\s*отчеств|полное\s*имя|учитель|ф\.?\s*и\.?\s*о\.?/i;
const SHEET_NAME_HINT = /расшифров|справочник|шифр|код.*фио|фио.*код|педагог.*код|decode|legend|reference|lookup/i;

function findHeaderRow(matrix: unknown[][], maxScan: number): number {
  const limit = Math.min(matrix.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const line = matrix[r];
    if (!Array.isArray(line)) continue;
    const cells = line.slice(0, MAX_COLS).map((c) => cellToString(c).toLowerCase());
    const joined = cells.join(' ');
    if (CODE_HEADER.test(joined) && NAME_HEADER.test(joined)) return r;
    if (SHEET_NAME_HINT.test(joined) && cells.filter(Boolean).length >= 2) return r;
  }
  return 0;
}

function pickCodeNameColumns(headers: string[], sheetName: string): { code: number; name: number } | null {
  let code = -1;
  let name = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] || '';
    if (code < 0 && CODE_HEADER.test(h)) code = i;
    if (name < 0 && NAME_HEADER.test(h)) name = i;
  }
  if (code >= 0 && name >= 0 && code !== name) return { code, name };

  if (SHEET_NAME_HINT.test(sheetName) && headers.length >= 2) {
    return { code: 0, name: 1 };
  }

  return null;
}

function parseSheetCodebook(sheetName: string, matrix: unknown[][]): string[] | null {
  if (matrix.length < 2) return null;
  const headerRowIdx = findHeaderRow(matrix, 6);
  const headerLine = matrix[headerRowIdx];
  if (!Array.isArray(headerLine)) return null;
  const headers = Array.from({ length: MAX_COLS }, (_, i) => cellToString(headerLine[i]));
  const cols = pickCodeNameColumns(headers, sheetName);
  if (!cols) return null;

  const lines: string[] = [];
  const seen = new Set<string>();
  for (let r = headerRowIdx + 1; r < matrix.length && lines.length < MAX_PAIR_LINES; r++) {
    const line = matrix[r];
    if (!Array.isArray(line)) continue;
    const code = cellToString(line[cols.code]);
    const name = cellToString(line[cols.name]);
    if (!code || !name) continue;
    const key = `${code}\t${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  • ${code} → ${name}`);
  }

  if (lines.length < 2) return null;
  return [`Лист «${sheetName.slice(0, 80)}» (${headers[cols.code] || 'код'} → ${headers[cols.name] || 'ФИО'}):`, ...lines];
}

/**
 * Собирает текстовый блок «шифр → ФИО» с остальных листов .xlsx (расшифровка, справочник),
 * чтобы ИИ мог сопоставлять коды из основной таблицы наблюдений с именами — без выдумывания.
 */
export function extractWorkbookCodebookRu(buffer: ArrayBuffer, mainSheetName: string): string {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const blocks: string[] = [];

  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    if (name === mainSheetName) continue;
    const sh = wb.Sheets[name];
    if (!sh) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: '', raw: true }) as unknown[][];
    const trimmed = matrix.slice(0, MAX_MATRIX_ROWS);
    const part = parseSheetCodebook(name, trimmed);
    if (part) blocks.push(part.join('\n'));
  }

  if (blocks.length === 0) return '';

  const intro =
    '=== СПРАВОЧНИК: соответствие кода/шифра и ФИО (взято с других листов этой же книги Excel, не с листа наблюдений) ===\n' +
    'Используй только эти пары для имён; если кода нет в списке — не придумывай ФИО.\n';
  let body = intro + blocks.join('\n\n');
  if (body.length > MAX_BLOCK_CHARS) body = `${body.slice(0, MAX_BLOCK_CHARS - 1)}…`;
  return body;
}

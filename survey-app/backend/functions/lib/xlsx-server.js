/**
 * Разбор .xlsx на сервере (тот же контракт, что и при использовании xlsx на фронте).
 * Пакет read-excel-file заметно легче «полного» xlsx — архив функции помещается в лимит загрузки из консоли Яндекса (~3,5 МБ).
 */
const readXlsxFile = require('read-excel-file/node').default;
const { readSheetNames } = require('read-excel-file/node');

const MAX_SHEETS = 12;
const MAX_ROWS = 400;
const MAX_COLS = 80;

function normalizeCell(c) {
  if (c == null || c === '') return null;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (typeof c === 'boolean') return c;
  if (c instanceof Date) return c.toISOString().slice(0, 19);
  const s = String(c);
  return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ sheets: { name: string, headers: string[], rows: (string|number|boolean|null)[][] }[] }>}
 */
async function xlsxBufferToSheets(buffer) {
  const names = await readSheetNames(buffer);
  const sheets = [];

  for (const name of names.slice(0, MAX_SHEETS)) {
    const matrix = await readXlsxFile(buffer, { sheet: name });
    if (!matrix.length) continue;

    const headers = matrix[0].slice(0, MAX_COLS).map((h) => String(h ?? ''));
    if (!headers.some((h) => h.trim())) continue;

    const rows = [];
    for (let r = 1; r < matrix.length && rows.length < MAX_ROWS; r++) {
      const line = matrix[r];
      const arr = Array.isArray(line) ? line : [];
      const row = headers.map((_, i) => normalizeCell(arr[i]));
      if (row.every((c) => c == null || c === '')) continue;
      rows.push(row);
    }

    sheets.push({ name: String(name).slice(0, 120), headers, rows });
  }

  if (!sheets.length) {
    throw new Error('Не удалось извлечь таблицы: нужна строка заголовков на первом листе');
  }

  return { sheets };
}

module.exports = { xlsxBufferToSheets };

const { json, parseBody } = require('./lib/http');

const MAX_SHEETS = 12;
const MAX_ROWS_PER_SHEET = 400;
const MAX_COLS = 80;

function normalizeSheets(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sheets)) {
    return { ok: false, error: 'Ожидается объект { sheets: [...] }' };
  }
  const sheets = raw.sheets.slice(0, MAX_SHEETS);
  const out = [];
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (!sh || typeof sh !== 'object') return { ok: false, error: `Некорректный лист #${i + 1}` };
    const name = String(sh.name || `Лист ${i + 1}`).slice(0, 120);
    if (!Array.isArray(sh.headers)) return { ok: false, error: `Лист «${name}»: нет строки заголовков` };
    const headers = sh.headers.slice(0, MAX_COLS).map((h) => String(h ?? '').slice(0, 500));
    if (!headers.length) return { ok: false, error: `Лист «${name}»: пустые заголовки` };
    if (!Array.isArray(sh.rows)) return { ok: false, error: `Лист «${name}»: нет строк данных` };
    const rows = [];
    for (let r = 0; r < Math.min(sh.rows.length, MAX_ROWS_PER_SHEET); r++) {
      const line = sh.rows[r];
      if (!Array.isArray(line)) return { ok: false, error: `Лист «${name}», строка ${r + 1}: ожидается массив` };
      const cells = line.slice(0, MAX_COLS).map((c) => {
        if (c == null) return null;
        if (typeof c === 'number' && Number.isFinite(c)) return c;
        if (typeof c === 'boolean') return c;
        if (c instanceof Date) return c.toISOString().slice(0, 19);
        const s = String(c);
        return s.length > 4000 ? `${s.slice(0, 3997)}…` : s;
      });
      while (cells.length < headers.length) cells.push(null);
      rows.push(cells.slice(0, headers.length));
    }
    out.push({ name, headers, rows });
  }
  if (!out.length) return { ok: false, error: 'Нет ни одного листа с данными' };
  return { ok: true, sheets: out };
}

async function handlePostWorkbook(pool, surveyId, event) {
  const ex = await pool.query(`SELECT id FROM surveys WHERE id = $1`, [surveyId]);
  if (!ex.rows.length) return json(404, { error: 'Опрос не найден' });

  const body = parseBody(event) || {};
  const filename = String(body.filename || 'таблица.xlsx').slice(0, 240);
  const norm = normalizeSheets(body);
  if (!norm.ok) return json(400, { error: norm.error });

  const ins = await pool.query(
    `INSERT INTO survey_workbooks (survey_id, filename, sheets) VALUES ($1, $2, $3::jsonb) RETURNING id, filename, sheets, ai_commentary, created_at::text`,
    [surveyId, filename, JSON.stringify(norm.sheets)]
  );
  const row = ins.rows[0];
  return json(201, {
    workbook: {
      id: row.id,
      filename: row.filename,
      sheets: row.sheets,
      ai_commentary: row.ai_commentary,
      created_at: row.created_at,
    },
  });
}

module.exports = { handlePostWorkbook, normalizeSheets };

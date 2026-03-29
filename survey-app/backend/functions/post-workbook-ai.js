const { json } = require('./lib/http');
const { truncate } = require('./lib/insight-dashboard');

function sheetsDigestForLlm(sheets, maxChars = 12000) {
  let used = 0;
  const parts = [];
  for (const sh of sheets) {
    const name = truncate(sh.name, 80);
    const hdr = (sh.headers || []).map((h) => truncate(String(h), 60)).join(' | ');
    const lines = [];
    const rows = sh.rows || [];
    for (let i = 0; i < Math.min(rows.length, 35); i++) {
      const line = (rows[i] || []).map((c) => truncate(String(c ?? ''), 120)).join(' | ');
      lines.push(line);
      used += line.length + 2;
      if (used >= maxChars) break;
    }
    const block = `## ${name}\nКолонки: ${hdr}\nСтроки (фрагмент):\n${lines.join('\n')}`;
    used += block.length;
    parts.push(block);
    if (used >= maxChars) break;
  }
  let s = parts.join('\n\n');
  if (s.length > maxChars) s = `${s.slice(0, maxChars - 1)}…`;
  return s;
}

async function handlePostWorkbookAi(pool, surveyId, workbookId) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(503, { error: 'Нейросеть не настроена (нет ключа на функции)' });

  const r = await pool.query(
    `SELECT id, filename, sheets FROM survey_workbooks WHERE id = $1 AND survey_id = $2`,
    [workbookId, surveyId]
  );
  if (!r.rows.length) return json(404, { error: 'Файл не найден' });

  const row = r.rows[0];
  const sheets = Array.isArray(row.sheets) ? row.sheets : [];
  const digest = sheetsDigestForLlm(sheets);

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Ты аналитик данных. Пиши только по-русски. По фрагменту таблицы (статистика, отчёт, выгрузка) дай: ' +
          '(1) краткое описание, что за данные; (2) 5–12 маркированных наблюдений — тренды, выбросы, соотношения; ' +
          '(3) 2–4 практических вывода для руководителя. Не выдумывай цифр, которых нет во фрагменте. ' +
          'Без упоминания нейросети.',
      },
      {
        role: 'user',
        content: `Файл: «${row.filename}». Проанализируй таблицу:\n\n${digest}`,
      },
    ],
    max_tokens: 1100,
    temperature: 0.35,
  };

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return json(502, { error: 'Запрос к нейросети не выполнен' });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    const commentary = typeof text === 'string' && text.trim() ? text.trim() : null;
    if (!commentary) return json(502, { error: 'Пустой ответ модели' });

    await pool.query(`UPDATE survey_workbooks SET ai_commentary = $1 WHERE id = $2`, [commentary, workbookId]);
    return json(200, { ok: true, ai_commentary: commentary });
  } catch {
    return json(502, { error: 'Ошибка при обращении к нейросети' });
  }
}

module.exports = { handlePostWorkbookAi };

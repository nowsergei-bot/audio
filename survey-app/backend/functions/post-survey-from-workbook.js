const { randomUUID } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { json, parseBody } = require('./lib/http');
const { getHeader, parseMultipartFileField } = require('./lib/multipart');
const { xlsxBufferToSheets } = require('./lib/xlsx-server');
const { normalizeSheets } = require('./post-workbook');
const { inferQuestionsFromSheet, coerceCellForQuestion } = require('./lib/infer-survey-from-sheet');
const { validatePartialImportAnswers } = require('./lib/validation');
const { loadSurveyWithQuestions } = require('./get-survey');

const MAX_IMPORT_ROWS = 500;

function ruValidationError(en) {
  if (!en || typeof en !== 'string') return en;
  return en
    .replace(/Question (\d+):/g, 'Вопрос $1:')
    .replace(/invalid option/g, 'недопустимый вариант')
    .replace(/No valid answers in row/g, 'В строке нет ни одного допустимого ответа');
}

/**
 * Черновик опроса из Excel: вопросы выводятся из первого листа, строки импортируются как ответы.
 * Предпочтительно: multipart/form-data с полем file (тело файла, без огромного JSON — лимиты шлюза).
 * Совместимо: application/json { filename, sheets } для небольших книг и тестов.
 */
async function handlePostSurveyFromWorkbook(pool, event) {
  const access_link = uuidv4().replace(/-/g, '');
  let filename = 'таблица.xlsx';
  let norm;

  const ct = getHeader(event, 'content-type');
  if (ct.toLowerCase().includes('multipart/form-data')) {
    try {
      const { buffer, filename: fn } = await parseMultipartFileField(event, 'file');
      filename = String(fn || filename).slice(0, 240);
      if (!filename.toLowerCase().endsWith('.xlsx')) {
        return json(400, { error: 'Нужен файл .xlsx' });
      }
      const parsed = await xlsxBufferToSheets(buffer);
      norm = normalizeSheets({ sheets: parsed.sheets });
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === 'NO_FILE_FIELD') {
        return json(400, { error: 'В форме нет файла: поле должно называться file' });
      }
      return json(400, { error: msg.includes('Не удалось') ? msg : `Файл Excel: ${msg}` });
    }
  } else {
    const body = parseBody(event) || {};
    filename = String(body.filename || filename).slice(0, 240);

    const b64 =
      typeof body.file_base64 === 'string'
        ? body.file_base64
        : typeof body.fileBase64 === 'string'
          ? body.fileBase64
          : '';
    if (b64.length > 0) {
      try {
        const buffer = Buffer.from(b64.replace(/\s/g, ''), 'base64');
        if (!buffer.length) {
          return json(400, { error: 'Пустой файл после декодирования base64' });
        }
        const parsed = await xlsxBufferToSheets(buffer);
        norm = normalizeSheets({ sheets: parsed.sheets });
      } catch (e) {
        const msg = String(e.message || e);
        return json(400, { error: msg.includes('Не удалось') ? msg : `Файл Excel (base64): ${msg}` });
      }
    } else {
      norm = normalizeSheets(body);
    }
  }

  if (!norm.ok) return json(400, { error: norm.error });

  const titleBase = filename.replace(/\.xlsx$/i, '').trim() || 'Опрос из Excel';
  const title = titleBase.slice(0, 500);

  const sheet0 = norm.sheets[0];
  const inferred = inferQuestionsFromSheet(sheet0);
  if (!inferred.length) {
    return json(400, { error: 'Не удалось сформировать вопросы: проверьте первую строку (заголовки столбцов).' });
  }

  const description =
    'Автоматически создан из Excel. Вопросы и ответы сформированы по первому листу. Проверьте типы и варианты, затем при необходимости опубликуйте опрос.';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const director_token = randomUUID().replace(/-/g, '');
    const insS = await client.query(
      `INSERT INTO surveys (title, description, status, access_link, director_token)
       VALUES ($1, $2, 'draft'::survey_status, $3, $4)
       RETURNING id, title, description, created_at, created_by, status, access_link, director_token`,
      [title, description, access_link, director_token]
    );
    const survey = insS.rows[0];

    const colQuestions = [];
    for (let i = 0; i < inferred.length; i++) {
      const spec = inferred[i];
      const opts = spec.options != null ? spec.options : spec.type === 'scale' ? { min: 1, max: 10 } : [];
      const qins = await client.query(
        `INSERT INTO questions (survey_id, text, type, options, sort_order, required)
         VALUES ($1, $2, $3::question_type, $4::jsonb, $5, $6)
         RETURNING id, survey_id, text, type, options, sort_order, required`,
        [survey.id, spec.text.slice(0, 2000), spec.type, JSON.stringify(opts), i, false]
      );
      colQuestions.push({ colIndex: spec.colIndex, question: qins.rows[0] });
    }

    const batchId = randomUUID();
    let imported = 0;
    const importErrors = [];

    const dataRows = sheet0.rows.slice(0, MAX_IMPORT_ROWS);
    for (let ri = 0; ri < dataRows.length; ri++) {
      const line = dataRows[ri];
      if (!line || line.every((c) => c == null || String(c).trim() === '')) continue;

      const answersPayload = [];
      for (const { colIndex, question } of colQuestions) {
        const cell = line[colIndex];
        const val = coerceCellForQuestion(cell, question);
        if (val != null) {
          answersPayload.push({ question_id: question.id, value: val });
        }
      }

      if (!answersPayload.length) continue;

      const v = validatePartialImportAnswers(
        colQuestions.map((c) => c.question),
        answersPayload
      );
      if (!v.ok) {
        importErrors.push({ row: ri + 2, error: ruValidationError(v.error) });
        continue;
      }

      const respondent_id = `import:${batchId}:${ri}:${randomUUID().slice(0, 10)}`;
      const insR = await client.query(
        `INSERT INTO responses (survey_id, respondent_id) VALUES ($1, $2) RETURNING id`,
        [survey.id, respondent_id]
      );
      const responseId = insR.rows[0].id;
      for (const a of v.answers) {
        await client.query(
          `INSERT INTO answer_values (response_id, question_id, value) VALUES ($1, $2, $3::jsonb)`,
          [responseId, a.question_id, JSON.stringify(a.value)]
        );
      }
      imported++;
    }

    const wb = await client.query(
      `INSERT INTO survey_workbooks (survey_id, filename, sheets) VALUES ($1, $2, $3::jsonb)
       RETURNING id, filename, sheets, ai_commentary, created_at::text`,
      [survey.id, filename, JSON.stringify(norm.sheets)]
    );
    const wbRow = wb.rows[0];

    await client.query('COMMIT');

    const full = await loadSurveyWithQuestions(pool, survey.id);

    return json(201, {
      survey: full,
      workbook: {
        id: wbRow.id,
        filename: wbRow.filename,
        sheets: wbRow.sheets,
        ai_commentary: wbRow.ai_commentary,
        created_at: wbRow.created_at,
      },
      import: { imported, errors: importErrors.slice(0, 50) },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return json(409, { error: 'access_link collision — повторите запрос' });
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { handlePostSurveyFromWorkbook };

const { getPool } = require('./lib/pool');
const { json, normalizePath, getMethod, parseBody, CORS_HEADERS } = require('./lib/http');
const { requireApiKey } = require('./lib/auth');
const { handleGetSurveys } = require('./get-surveys');
const { handleCreateSurvey } = require('./create-survey');
const { handleGetSurvey } = require('./get-survey');
const { handleUpdateSurvey } = require('./update-survey');
const { handleDeleteSurvey } = require('./delete-survey');
const { handleGetResults } = require('./get-results');
const { handleSaveResponse, handleSaveResponseByLink } = require('./save-response');
const { handleGetComments } = require('./get-comments');
const { handlePostComment } = require('./post-comment');
const { handleGetPublicSurveyByLink } = require('./get-public-survey');
const { handlePostAiInsights } = require('./post-ai-insights');
const { handlePostTextQuestionInsights } = require('./post-text-question-insights');
const { handlePostImportRows } = require('./post-import-rows');
const { handlePostWorkbook } = require('./post-workbook');
const { handleDeleteWorkbook } = require('./delete-workbook');
const { handlePostWorkbookAi } = require('./post-workbook-ai');
const { handlePostSurveyFromWorkbook } = require('./post-survey-from-workbook');
const { handleGetExportRows } = require('./get-export-rows');
const { handleGetTextAnswers } = require('./get-text-answers');

function segmentsFromPath(path) {
  return path
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);
}

async function handlerImpl(event) {
  const method = getMethod(event);
  const headers = event.headers || {};

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
      isBase64Encoded: false,
    };
  }

  const path = normalizePath(event);
  const segs = segmentsFromPath(path);

  // Без БД и без ключа — чтобы отличить «шлюз + рантайм ок» от ошибок Postgres/таймаута
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'ping' && segs.length === 2) {
    return json(200, { ok: true, service: 'survey-api' });
  }

  // Публичные маршруты (без API-ключа)
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'public' && segs[2] === 'surveys' && segs[3] && !segs[4]) {
    const pool = getPool();
    return handleGetPublicSurveyByLink(pool, segs[3]);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'surveys' &&
    segs[3] &&
    segs[4] === 'responses'
  ) {
    const pool = getPool();
    return handleSaveResponseByLink(pool, segs[3], event);
  }

  // POST ответа по id опроса (ТЗ) — только для опубликованных, без ключа
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'responses') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid survey id' });
    const pool = getPool();
    return handleSaveResponse(pool, id, event);
  }

  const auth = requireApiKey(event);
  if (!auth.ok) {
    return json(401, { error: auth.error });
  }

  const pool = getPool();

  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs.length === 2) {
    return handleGetSurveys(pool);
  }
  // Excel → черновик: шлюз Яндекса иногда даёт лишние префиксы (этап, $default), поэтому ищем хвост …/surveys/from-workbook
  function isPostFromWorkbookRoute() {
    if (method !== 'POST') return false;
    const i = segs.lastIndexOf('from-workbook');
    if (i < 1) return false;
    if (segs[i - 1] !== 'surveys') return false;
    if (i >= 2 && segs[i - 2] === 'api') return true;
    if (i === 1 && segs[0] === 'surveys') return true;
    return false;
  }
  if (isPostFromWorkbookRoute()) {
    return handlePostSurveyFromWorkbook(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs.length === 2) {
    return handleCreateSurvey(pool, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleGetSurvey(pool, id);
  }
  if (method === 'PUT' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleUpdateSurvey(pool, id, event);
  }
  if (method === 'DELETE' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleDeleteSurvey(pool, id);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'results') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleGetResults(pool, id);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'export-rows' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleGetExportRows(pool, id);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'text-answers' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleGetTextAnswers(pool, id, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'comments') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleGetComments(pool, id);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'comments') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePostComment(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'ai-insights') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePostAiInsights(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'text-question-insights') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePostTextQuestionInsights(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'import-rows') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePostImportRows(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'workbooks' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePostWorkbook(pool, id, event);
  }
  if (
    method === 'DELETE' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'workbooks' &&
    segs[4] &&
    segs.length === 5
  ) {
    const surveyId = Number(segs[2]);
    const wid = Number(segs[4]);
    if (!Number.isFinite(surveyId) || !Number.isFinite(wid)) return json(400, { error: 'Invalid id' });
    return handleDeleteWorkbook(pool, surveyId, wid);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'workbooks' &&
    segs[4] &&
    segs[5] === 'ai' &&
    segs.length === 6
  ) {
    const surveyId = Number(segs[2]);
    const wid = Number(segs[4]);
    if (!Number.isFinite(surveyId) || !Number.isFinite(wid)) return json(400, { error: 'Invalid id' });
    return handlePostWorkbookAi(pool, surveyId, wid);
  }
  return json(404, {
    error: 'Not found',
    path,
    method,
    segments: segs,
  });
}

module.exports.handler = async (event, context) => {
  try {
    return await handlerImpl(event);
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Internal error', message: String(err.message || err) });
  }
};

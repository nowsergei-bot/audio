const { getPool } = require('./lib/pool');
const { isSmtpConfigured } = require('./lib/mailer');
const { json, normalizePath, getMethod, parseBody, CORS_HEADERS } = require('./lib/http');
const { requireUser } = require('./lib/session-auth');
const { handleGetSurveys } = require('./get-surveys');
const { handleGetSurveyGroups } = require('./get-survey-groups');
const { handlePostSurveyGroup } = require('./post-survey-group');
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
const { handlePostAnalyticsChat } = require('./post-analytics-chat');
const { handlePostPulseExcelChat } = require('./post-pulse-excel-chat');
const { handlePostExcelFilterSections } = require('./post-excel-filter-sections');
const { handlePostExcelFilterValueGroups } = require('./post-excel-filter-value-groups');
const { handlePostExcelDerivedFilters } = require('./post-excel-derived-filters');
const { handlePostExcelNarrativeSummary } = require('./post-excel-narrative-summary');
const { handlePostExcelDirectorDossier } = require('./post-excel-director-dossier');
const { handlePostExcelDashboardAi } = require('./post-excel-dashboard-ai');
const {
  handleGetExcelAnalyticsProjects,
  handleGetExcelAnalyticsProject,
  handlePostExcelAnalyticsProject,
  handleDeleteExcelAnalyticsProject,
} = require('./excel-analytics-projects');
const {
  handleGetPedagogicalSessions,
  handleGetPedagogicalSession,
  handlePostPedagogicalSession,
  handleDeletePedagogicalSession,
  handlePostPedagogicalNotify,
} = require('./pedagogical-analytics-sessions');
const { handlePostPedagogicalAnalyticsLlm } = require('./post-pedagogical-analytics-llm');
const {
  handlePostPedagogicalLlmTeacher,
  handlePostPedagogicalLlmTeachersBatch,
} = require('./post-pedagogical-analytics-llm-teachers');
const { handlePostPedagogicalPiiTokenize } = require('./post-pedagogical-pii-tokenize');
const { handlePostMultiSurveyAnalytics } = require('./post-multi-survey-analytics');
const { handlePostTextQuestionInsights } = require('./post-text-question-insights');
const { handlePostImportRows } = require('./post-import-rows');
const { handlePostWorkbook } = require('./post-workbook');
const { handleDeleteWorkbook } = require('./delete-workbook');
const { handlePostWorkbookAi } = require('./post-workbook-ai');
const { handlePostSurveyFromWorkbook } = require('./post-survey-from-workbook');
const { handleGetExportRows } = require('./get-export-rows');
const { handlePostPhenomenalLessonsMerge } = require('./post-phenomenal-lessons-merge');
const {
  handlePostPhenomenalLessonsClusterReportBlocks,
} = require('./post-phenomenal-lessons-cluster-report-blocks');
const {
  handlePostPhenomenalPreviewPulseComments,
} = require('./post-phenomenal-preview-pulse-comments');
const { handleGetAnalyticsFacets } = require('./get-analytics-facets');
const { handlePostResultsFilter } = require('./post-results-filter');
const { handleGetTextAnswers } = require('./get-text-answers');
const { handlePostAuthRegister } = require('./post-auth-register');
const { handlePostAuthLogin } = require('./post-auth-login');
const { handleGetAuthMe } = require('./get-auth-me');
const {
  handleGetSurveyInvites,
  handlePostSurveyInvites,
  handlePostSurveyInvitesSend,
  handlePostSurveyInvitesRemind,
  handleGetSurveyInviteTemplate,
  handlePutSurveyInviteTemplate,
} = require('./survey-invites');
const { handlePostPublicPhotoWallUpload } = require('./post-public-photo-wall-upload');
const { handleGetPublicPhotoWallApproved } = require('./get-public-photo-wall-approved');
const { handleGetPhotoWallPhotos } = require('./get-photo-wall-photos');
const { handleGetPhotoWallPhotoFull } = require('./get-photo-wall-photo-full');
const { handlePatchPhotoWallPhoto } = require('./patch-photo-wall-photo');
const { handlePostPhotoWallClear } = require('./post-photo-wall-clear');
const { handlePostPhotoWallApproveAll } = require('./post-photo-wall-approve-all');
const {
  handleGetPublicDirectorResults,
  handleGetPublicDirectorLessonGroups,
  handlePostPublicDirectorAiInsights,
} = require('./get-public-director');
const { handleGetPublicPhenomenalReport } = require('./get-public-phenomenal-report');
const {
  handleListPhenomenalReportProjects,
  handlePostPhenomenalReportProject,
  handleGetPhenomenalReportProject,
  handlePutPhenomenalReportProject,
  handleDeletePhenomenalReportProject,
} = require('./phenomenal-report-projects');

/** Смените при выкладке — по GET /api/ping видно, что в облаке свежий bundle */
const DEPLOY_STAMP = '2026-04-10-function-bundle-zip';

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
    return json(200, {
      ok: true,
      service: 'survey-api',
      deploy_stamp: DEPLOY_STAMP,
      smtp_configured: isSmtpConfigured(),
    });
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
  // Доп. сегменты в пути после approved иногда даёт API Gateway / этап — хвост не проверяем
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'photo-wall' &&
    segs[3] === 'approved'
  ) {
    const pool = getPool();
    return handleGetPublicPhotoWallApproved(pool);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'photo-wall' &&
    segs[3] === 'upload'
  ) {
    const pool = getPool();
    return handlePostPublicPhotoWallUpload(pool, event);
  }

  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'director' &&
    segs[3] &&
    segs[4] === 'lesson-groups'
  ) {
    const pool = getPool();
    return handleGetPublicDirectorLessonGroups(pool, segs[3]);
  }
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'director' &&
    segs[3] &&
    segs[4] === 'results'
  ) {
    const pool = getPool();
    return handleGetPublicDirectorResults(pool, segs[3], event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'director' &&
    segs[3] &&
    segs[4] === 'ai-insights'
  ) {
    const pool = getPool();
    return handlePostPublicDirectorAiInsights(pool, segs[3], event);
  }
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'public' &&
    segs[2] === 'phenomenal-report' &&
    segs[3] &&
    segs.length === 4
  ) {
    const pool = getPool();
    return handleGetPublicPhenomenalReport(pool, segs[3]);
  }

  // POST ответа по id опроса (ТЗ) — только для опубликованных, без ключа
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'responses') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid survey id' });
    const pool = getPool();
    return handleSaveResponse(pool, id, event);
  }

  const pool = getPool();

  // Auth (без X-Api-Key)
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'auth' && segs[2] === 'register') {
    return handlePostAuthRegister(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'auth' && segs[2] === 'login') {
    return handlePostAuthLogin(pool, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'auth' && segs[2] === 'me') {
    return handleGetAuthMe(pool, event);
  }

  const auth = await requireUser(pool, event);
  if (!auth.ok) return json(auth.code, { error: auth.error });
  const user = auth.user;
  const sessionUser = auth.sessionUser || null;

  async function canAccessSurvey(surveyId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const r = await pool.query(`SELECT owner_user_id FROM surveys WHERE id = $1`, [surveyId]);
    if (!r.rows.length) return null;
    return Number(r.rows[0].owner_user_id || 0) === Number(user.id || -1);
  }

  // Сводка по нескольким опросам — только POST; грубая проверка по подстрокам (устойчиво к шлюзу и регистру)
  const pLower = String(path).toLowerCase();
  const segLower = (s) => String(s).toLowerCase().replace(/\u2011|\u2010|\u2012|\u2013|\u2014/g, '-');
  const hasSeg = (name) => segs.some((s) => segLower(s) === name);
  const hitBatch =
    method === 'POST' &&
    (pLower.includes('batch-analytics') || segs.some((s) => segLower(s).includes('batch-analytics')));
  const hitMulti =
    method === 'POST' &&
    (pLower.includes('multi-survey') || segs.some((s) => segLower(s).includes('multi-survey')));
  if (hitBatch && (pLower.includes('surveys') || hasSeg('surveys'))) {
    return handlePostMultiSurveyAnalytics(pool, event, canAccessSurvey);
  }
  if (hitMulti && (pLower.includes('analytics') || hasSeg('analytics'))) {
    return handlePostMultiSurveyAnalytics(pool, event, canAccessSurvey);
  }

  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs.length === 2) {
    return handleGetSurveys(pool, user);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'survey-groups' && segs.length === 2) {
    return handleGetSurveyGroups(pool);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'survey-groups' && segs.length === 2) {
    return handlePostSurveyGroup(pool, event, user);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'photo-wall' && segs[2] === 'photos' && segs.length === 3) {
    return handleGetPhotoWallPhotos(pool);
  }
  /** POST …/photo-wall/photos/approve-all (иногда шлюз добавляет хвостовые сегменты — не требуем segs.length === 4). */
  function isPostPhotoWallApproveAllRoute() {
    if (method !== 'POST' || segs[0] !== 'api' || segs[1] !== 'photo-wall') return false;
    const i = segs.lastIndexOf('approve-all');
    if (i < 3) return false;
    return segs[i - 1] === 'photos' && segs[i - 2] === 'photo-wall' && segs[i - 3] === 'api';
  }
  if (isPostPhotoWallApproveAllRoute()) {
    if (user.role !== 'admin' && !auth.viaAdminKey) {
      return json(403, { error: 'Forbidden', message: 'Массовое одобрение доступно только администратору.' });
    }
    return handlePostPhotoWallApproveAll(pool);
  }
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'photo-wall' &&
    segs[2] === 'photos' &&
    segs.length === 5 &&
    segs[4] === 'full' &&
    segs[3]
  ) {
    const pid = Number(segs[3]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handleGetPhotoWallPhotoFull(pool, pid);
  }
  if (
    method === 'PATCH' &&
    segs[0] === 'api' &&
    segs[1] === 'photo-wall' &&
    segs[2] === 'photos' &&
    segs[3] &&
    !segs[4]
  ) {
    const id = Number(segs[3]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handlePatchPhotoWallPhoto(pool, event, id);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'photo-wall' && segs[2] === 'clear' && segs.length === 3) {
    if (user.role !== 'admin' && !auth.viaAdminKey) {
      return json(403, { error: 'Forbidden', message: 'Очистка фотостены доступна только администратору.' });
    }
    return handlePostPhotoWallClear(pool, event);
  }
  /** POST …/photo-wall/approve-all (допускаем хвостовые сегменты после approve-all). */
  function isPostPhotoWallApproveAllLegacyRoute() {
    if (method !== 'POST' || segs[0] !== 'api' || segs[1] !== 'photo-wall') return false;
    const i = segs.lastIndexOf('approve-all');
    return i === 2;
  }
  if (isPostPhotoWallApproveAllLegacyRoute()) {
    if (user.role !== 'admin' && !auth.viaAdminKey) {
      return json(403, { error: 'Forbidden', message: 'Массовое одобрение доступно только администратору.' });
    }
    return handlePostPhotoWallApproveAll(pool);
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
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'pulse-excel-chat' && segs.length === 2) {
    return handlePostPulseExcelChat(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-filter-sections' && segs.length === 2) {
    return handlePostExcelFilterSections(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-filter-value-groups' && segs.length === 2) {
    return handlePostExcelFilterValueGroups(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-derived-filters' && segs.length === 2) {
    return handlePostExcelDerivedFilters(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-narrative-summary' && segs.length === 2) {
    return handlePostExcelNarrativeSummary(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-director-dossier' && segs.length === 2) {
    return handlePostExcelDirectorDossier(pool, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-dashboard-ai' && segs.length === 2) {
    return handlePostExcelDashboardAi(pool, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'excel-analytics-projects' && segs.length === 2) {
    return handleGetExcelAnalyticsProjects(pool, user, auth.viaAdminKey, sessionUser);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'excel-analytics-projects' && segs[2] && segs.length === 3) {
    const pid = Number(segs[2]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handleGetExcelAnalyticsProject(pool, user, auth.viaAdminKey, sessionUser, pid);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'excel-analytics-projects' && segs.length === 2) {
    return handlePostExcelAnalyticsProject(pool, user, auth.viaAdminKey, sessionUser, event);
  }
  if (method === 'DELETE' && segs[0] === 'api' && segs[1] === 'excel-analytics-projects' && segs[2] && segs.length === 3) {
    const pid = Number(segs[2]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handleDeleteExcelAnalyticsProject(pool, user, auth.viaAdminKey, sessionUser, pid);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'pedagogical-analytics-sessions' && segs.length === 2) {
    return handleGetPedagogicalSessions(pool, user, auth.viaAdminKey, sessionUser);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'pedagogical-analytics-sessions' && segs[2] && segs.length === 3) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handleGetPedagogicalSession(pool, user, auth.viaAdminKey, sessionUser, sid);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'pedagogical-analytics-sessions' && segs.length === 2) {
    return handlePostPedagogicalSession(pool, user, auth.viaAdminKey, sessionUser, event);
  }
  if (method === 'DELETE' && segs[0] === 'api' && segs[1] === 'pedagogical-analytics-sessions' && segs[2] && segs.length === 3) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handleDeletePedagogicalSession(pool, user, auth.viaAdminKey, sessionUser, sid);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'pedagogical-analytics-sessions' &&
    segs[2] &&
    segs[3] === 'notify' &&
    segs.length === 4
  ) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handlePostPedagogicalNotify(pool, user, auth.viaAdminKey, sessionUser, sid, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'pedagogical-analytics-sessions' &&
    segs[2] &&
    segs[3] === 'llm' &&
    segs.length === 4
  ) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handlePostPedagogicalAnalyticsLlm(pool, user, auth.viaAdminKey, sessionUser, sid, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'pedagogical-analytics-sessions' &&
    segs[2] &&
    segs[3] === 'llm-teacher' &&
    segs.length === 4
  ) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handlePostPedagogicalLlmTeacher(pool, user, auth.viaAdminKey, sessionUser, sid, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'pedagogical-analytics-sessions' &&
    segs[2] &&
    segs[3] === 'llm-teachers-batch' &&
    segs.length === 4
  ) {
    const sid = Number(segs[2]);
    if (!Number.isFinite(sid)) return json(400, { error: 'Invalid id' });
    return handlePostPedagogicalLlmTeachersBatch(pool, user, auth.viaAdminKey, sessionUser, sid, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'pedagogical-pii-tokenize' && segs.length === 2) {
    return handlePostPedagogicalPiiTokenize(pool, user, auth.viaAdminKey, sessionUser, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs.length === 2) {
    return handleCreateSurvey(pool, event, user);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetSurvey(pool, id);
  }
  if (method === 'PUT' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleUpdateSurvey(pool, id, event, user);
  }
  if (method === 'DELETE' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs.length === 3) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    return handleDeleteSurvey(pool, id, user);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'results') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetResults(pool, id);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'analytics-facets' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetAnalyticsFacets(pool, id);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'results-filter' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostResultsFilter(pool, id, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'export-rows' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetExportRows(pool, id);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'phenomenal-lessons' && segs[2] === 'merge' && segs.length === 3) {
    return handlePostPhenomenalLessonsMerge(pool, event, canAccessSurvey);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'phenomenal-lessons' &&
    segs[2] === 'cluster-report-blocks' &&
    segs.length === 3
  ) {
    return handlePostPhenomenalLessonsClusterReportBlocks(pool, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'phenomenal-lessons' &&
    segs[2] === 'preview-pulse-comments' &&
    segs.length === 3
  ) {
    return handlePostPhenomenalPreviewPulseComments(pool, event, canAccessSurvey);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'phenomenal-report-projects' && segs.length === 2) {
    return handleListPhenomenalReportProjects(pool, user, auth.viaAdminKey, sessionUser);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'phenomenal-report-projects' && segs.length === 2) {
    return handlePostPhenomenalReportProject(pool, user, auth.viaAdminKey, sessionUser, event);
  }
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'phenomenal-report-projects' &&
    segs[2] &&
    segs.length === 3
  ) {
    const pid = Number(segs[2]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handleGetPhenomenalReportProject(pool, user, auth.viaAdminKey, sessionUser, pid);
  }
  if (
    method === 'PUT' &&
    segs[0] === 'api' &&
    segs[1] === 'phenomenal-report-projects' &&
    segs[2] &&
    segs.length === 3
  ) {
    const pid = Number(segs[2]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handlePutPhenomenalReportProject(pool, user, auth.viaAdminKey, sessionUser, pid, event);
  }
  if (
    method === 'DELETE' &&
    segs[0] === 'api' &&
    segs[1] === 'phenomenal-report-projects' &&
    segs[2] &&
    segs.length === 3
  ) {
    const pid = Number(segs[2]);
    if (!Number.isFinite(pid)) return json(400, { error: 'Invalid id' });
    return handleDeletePhenomenalReportProject(pool, user, auth.viaAdminKey, sessionUser, pid);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'text-answers' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetTextAnswers(pool, id, event);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'comments') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetComments(pool, id);
  }
  if (method === 'GET' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'invites' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetSurveyInvites(pool, id);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'invites' && segs.length === 4) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostSurveyInvites(pool, id, event);
  }
  if (
    method === 'GET' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'invites' &&
    segs[4] === 'template' &&
    segs.length === 5
  ) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handleGetSurveyInviteTemplate(pool, id);
  }
  if (
    method === 'PUT' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'invites' &&
    segs[4] === 'template' &&
    segs.length === 5
  ) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePutSurveyInviteTemplate(pool, id, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'invites' &&
    segs[4] === 'send' &&
    segs.length === 5
  ) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostSurveyInvitesSend(pool, id, event);
  }
  if (
    method === 'POST' &&
    segs[0] === 'api' &&
    segs[1] === 'surveys' &&
    segs[2] &&
    segs[3] === 'invites' &&
    segs[4] === 'remind' &&
    segs.length === 5
  ) {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostSurveyInvitesRemind(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'comments') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostComment(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'ai-insights') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostAiInsights(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'analytics-chat') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostAnalyticsChat(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'text-question-insights') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
    return handlePostTextQuestionInsights(pool, id, event);
  }
  if (method === 'POST' && segs[0] === 'api' && segs[1] === 'surveys' && segs[2] && segs[3] === 'import-rows') {
    const id = Number(segs[2]);
    if (!Number.isFinite(id)) return json(400, { error: 'Invalid id' });
    const ok = await canAccessSurvey(id);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });
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
    deploy_stamp: DEPLOY_STAMP,
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

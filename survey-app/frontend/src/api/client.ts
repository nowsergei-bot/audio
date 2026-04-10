import type { SavedExcelSession } from '../lib/excelAnalytics/excelSessionStorage';
import type { ParentResponsesSheetRow } from '../lib/phenomenalLessons/parseParentResponsesSheet';
import type { TeacherLessonChecklistRow } from '../lib/phenomenalLessons/parseTeacherChecklistApril';
import type { PhenomenalReportBlockDraft, PhenomenalReportDraft } from '../lib/phenomenalLessons/reportDraftTypes';
import type {
  AiInsightsPayload,
  AnalyticsChatMessage,
  AnalyticsChatResponse,
  AnalyticsFilter,
  PulseExcelChatResponse,
  ExcelFilterSectionsResponse,
  ExcelFilterValueGroupsResponse,
  ExcelDerivedFiltersResponse,
  ExcelNarrativeSummaryResponse,
  ExcelDirectorDossierResponse,
  ExcelDashboardAiResponse,
  MultiSurveyAnalyticsPayload,
  TextQuestionInsightsPayload,
  PedagogicalAnalyticsState,
  PedagogicalPiiEntityDraft,
  PedagogicalSessionListItem,
  PedagogicalSessionPayload,
  AnswerSubmit,
  CommentRow,
  ResultsPayload,
  DirectorLessonGroupsPayload,
  Survey,
  SurveyGroup,
  SurveyInviteRow,
  SurveyInviteTemplate,
  SurveyExportRowsPayload,
  PhenomenalLessonsMergePayload,
  SurveyWorkbook,
  TextAnswersPage,
  PhotoWallPhotoRow,
  PhotoWallModerationStatus,
} from '../types';

function normalizeApiBase(raw: string): string {
  let s = (raw || '').trim().replace(/\/+$/, '');
  if (s.endsWith('/api')) s = s.slice(0, -4).replace(/\/+$/, '');
  return s;
}

const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE || '');

/** Без этого catch браузер даёт только «Failed to fetch» при CORS/сети. */
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    const dev =
      API_BASE ?
        'Администратору: CORS в API Gateway (survey-api-gw.yaml), CORS_ORIGIN на функции, VITE_API_BASE без /api в конце.'
      : 'Администратору: соберите фронт с VITE_API_BASE (URL шлюза или функции).';
    console.warn('[api]', dev, input, e);
    const userMsg = API_BASE
      ? 'Не удалось связаться с сервером. Частые причины: блокировка CORS (в консоли F12 — красные ошибки), неверный адрес API при сборке, VPN или обрыв сети. Откройте вкладку «Сеть» и проверьте запрос к API.'
      : 'Не удалось выполнить запрос: для сайта не задан адрес API (при сборке нужен VITE_API_BASE — URL шлюза Yandex без /api в конце).';
    throw new Error(userMsg);
  }
}

function adminHeaders(): HeadersInit {
  const key = localStorage.getItem('admin_api_key') || '';
  const token = localStorage.getItem('auth_token') || '';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  // Оба заголовка, если заданы: функция по Bearer узнаёт пользователя для сущностей с user_id (педагогика, Excel-проекты),
  // а X-Api-Key по-прежнему даёт доступ админа. Только Bearer без ключа — как раньше.
  if (key.trim()) h['X-Api-Key'] = key.trim();
  if (token.trim()) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  let text = await res.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const t = text.trim();
  /** Пустое тело: не вызывать JSON.parse('') — иначе SyntaxError «Unexpected end of JSON input». Часто при 502/504 от шлюза. */
  if (!t) {
    return {} as T;
  }
  const lead = t.trimStart().slice(0, 1);
  if (lead === '<') {
    console.warn('[api] HTML/XML вместо JSON', res.status, API_BASE || '(нет VITE_API_BASE)', t.slice(0, 400));
    throw new Error(
      'Сервер вернул неожиданный формат ответа. Попробуйте позже или обратитесь к администратору.',
    );
  }
  try {
    return JSON.parse(t) as T;
  } catch (e) {
    const preview = t.replace(/\s+/g, ' ').slice(0, 220);
    console.warn('[api] parseJson', res.status, e, preview);
    throw new Error(
      `Сервер вернул некорректные данные (код ${res.status}). Подождите минуту и попробуйте снова.`,
    );
  }
}

export async function listSurveys(): Promise<Survey[]> {
  const res = await apiFetch(`${API_BASE}/api/surveys`, { headers: adminHeaders() });
  const data = await parseJson<{ surveys: Survey[] }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.surveys || [];
}

export async function getSurveyGroups(): Promise<SurveyGroup[]> {
  const res = await apiFetch(`${API_BASE}/api/survey-groups`, { headers: adminHeaders() });
  const data = await parseJson<{ groups: SurveyGroup[] }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.groups || [];
}

/** Создать раздел опросов (только роль admin или X-Api-Key). */
export async function createSurveyGroup(payload: {
  name: string;
  curator_name?: string;
  sort_order?: number;
  slug?: string;
}): Promise<SurveyGroup> {
  const res = await apiFetch(`${API_BASE}/api/survey-groups`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ group?: SurveyGroup; error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.group) throw new Error('Нет данных раздела');
  return data.group;
}

export async function getSurvey(id: number): Promise<Survey> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${id}`, { headers: adminHeaders() });
  const data = await parseJson<{ survey: Survey }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.survey;
}

export type SurveyWritePayload = Omit<Partial<Survey>, 'questions'> & { questions?: unknown[] };

export async function createSurvey(payload: SurveyWritePayload): Promise<Survey> {
  const res = await apiFetch(`${API_BASE}/api/surveys`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ survey: Survey }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.survey;
}

export async function updateSurvey(id: number, payload: SurveyWritePayload): Promise<Survey> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${id}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ survey: Survey }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.survey;
}

export async function deleteSurvey(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const data = await parseJson<{ error?: string }>(res);
    throw new Error(data.error || res.statusText);
  }
}

export async function getResults(id: number): Promise<ResultsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${id}/results`, { headers: adminHeaders() });
  const data = await parseJson<ResultsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function getAnalyticsFacets(surveyId: number): Promise<{ facets: Record<string, string[]> }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/analytics-facets`, { headers: adminHeaders() });
  const data = await parseJson<{ facets?: Record<string, string[]>; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return { facets: data.facets || {} };
}

export async function postResultsFilter(surveyId: number, filters: AnalyticsFilter[]): Promise<ResultsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/results-filter`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ filters }),
  });
  const data = await parseJson<ResultsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function getSurveyExportRows(surveyId: number): Promise<SurveyExportRowsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/export-rows`, { headers: adminHeaders() });
  const data = await parseJson<SurveyExportRowsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Автосопоставление чек-листа педагогов с ответами родителей: опрос в системе или второй Excel (LLM на сервере). */
export async function postPhenomenalLessonsMerge(
  teacherRows: TeacherLessonChecklistRow[],
  options: {
    surveyId?: number;
    parentRows?: ParentResponsesSheetRow[];
    parentSourceTitle?: string;
    confidenceThreshold?: number;
  } = {},
): Promise<PhenomenalLessonsMergePayload> {
  const { surveyId, parentRows, parentSourceTitle, confidenceThreshold } = options;
  const body: Record<string, unknown> = { teacher_rows: teacherRows };
  if (parentRows && parentRows.length > 0) {
    body.parent_rows = parentRows.map((r) => ({
      answers_labeled: r.answers_labeled,
      created_at: r.created_at ?? '',
    }));
    if (parentSourceTitle) body.parent_source_title = parentSourceTitle;
  } else if (surveyId != null && Number.isFinite(surveyId) && surveyId >= 1) {
    body.survey_id = surveyId;
  } else {
    throw new Error('Укажите опрос (surveyId) или загрузите Excel с ответами родителей (parentRows).');
  }
  if (typeof confidenceThreshold === 'number' && Number.isFinite(confidenceThreshold)) {
    body.confidence_threshold = confidenceThreshold;
  }
  const res = await apiFetch(`${API_BASE}/api/phenomenal-lessons/merge`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<
    PhenomenalLessonsMergePayload & { error?: string; message?: string }
  >(res);
  if (!res.ok) {
    throw new Error(
      (data as { message?: string; error?: string }).message ||
        (data as { error?: string }).error ||
        res.statusText,
    );
  }
  return data as PhenomenalLessonsMergePayload;
}

/** Превью текстовых ответов родителей с Пульса по полям блока (для редактора отчёта). */
export async function postPhenomenalPreviewPulseComments(
  surveyId: number,
  blocks: Pick<PhenomenalReportBlockDraft, 'id' | 'lessonCode' | 'conductingTeachers' | 'parentClassLabel'>[],
): Promise<{
  parent_pulse_comments: Record<string, { question: string; text: string }[]>;
  pulse_ready?: boolean;
  pulse_hint?: string | null;
}> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-lessons/preview-pulse-comments`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      survey_id: surveyId,
      blocks: blocks.map((b) => ({
        id: b.id,
        lessonCode: b.lessonCode,
        conductingTeachers: b.conductingTeachers,
        parentClassLabel: b.parentClassLabel ?? '',
      })),
    }),
  });
  const data = await parseJson<{
    parent_pulse_comments?: Record<string, { question: string; text: string }[]>;
    pulse_ready?: boolean;
    pulse_hint?: string | null;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return {
    parent_pulse_comments: data.parent_pulse_comments ?? {},
    pulse_ready: data.pulse_ready,
    pulse_hint: data.pulse_hint ?? null,
  };
}

export interface PhenomenalReportProjectRow {
  id: number;
  title: string;
  survey_id: number | null;
  director_share_token: string;
  created_at: string;
  updated_at: string;
}

export async function listPhenomenalReportProjects(): Promise<PhenomenalReportProjectRow[]> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-report-projects`, { headers: adminHeaders() });
  const data = await parseJson<{ projects?: PhenomenalReportProjectRow[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.projects ?? [];
}

export async function postPhenomenalReportProject(body: {
  title?: string;
  survey_id?: number | null;
  draft: PhenomenalReportDraft;
}): Promise<{ project: PhenomenalReportProjectRow; draft: PhenomenalReportDraft }> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-report-projects`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<{
    project?: PhenomenalReportProjectRow;
    draft?: PhenomenalReportDraft;
    error?: string;
  }>(res);
  if (!res.ok || !data.project || !data.draft) {
    const msg = [data.error, (data as { message?: string }).message].filter(Boolean).join(': ');
    throw new Error(msg || res.statusText);
  }
  return { project: data.project, draft: data.draft };
}

export async function getPhenomenalReportProject(
  projectId: number,
): Promise<{ project: PhenomenalReportProjectRow; draft: PhenomenalReportDraft }> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-report-projects/${projectId}`, { headers: adminHeaders() });
  const data = await parseJson<{
    project?: PhenomenalReportProjectRow;
    draft?: PhenomenalReportDraft;
    error?: string;
  }>(res);
  if (!res.ok || !data.project || !data.draft) throw new Error(data.error || res.statusText);
  return { project: data.project, draft: data.draft };
}

export async function putPhenomenalReportProject(
  projectId: number,
  body: {
    title?: string;
    survey_id?: number | null;
    draft: PhenomenalReportDraft;
  },
): Promise<{ project: PhenomenalReportProjectRow; draft: PhenomenalReportDraft }> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-report-projects/${projectId}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<{
    project?: PhenomenalReportProjectRow;
    draft?: PhenomenalReportDraft;
    error?: string;
  }>(res);
  if (!res.ok || !data.project || !data.draft) {
    const msg = [data.error, (data as { message?: string }).message].filter(Boolean).join(': ');
    throw new Error(msg || res.statusText);
  }
  return { project: data.project, draft: data.draft };
}

export interface PublicPhenomenalReportPayload {
  title: string;
  period_label: string;
  survey_linked: boolean;
  blocks: Array<{
    id: string;
    lessonCode: string;
    conductingTeachers: string;
    subjects: string;
    methodologicalScore: string;
    teacherNotes: string;
    parentClassLabel: string;
    rubricOrganizational?: string;
    rubricGoalSetting?: string;
    rubricTechnologies?: string;
    rubricInformation?: string;
    rubricGeneralContent?: string;
    rubricCultural?: string;
    rubricReflection?: string;
    reviews: {
      id: string;
      text: string;
      fromMergedParent?: boolean;
      fromPulse?: boolean;
      respondentName?: string;
      overallRating?: string;
      comments?: string;
    }[];
  }>;
  parent_pulse_comments: Record<string, { question: string; text: string }[]>;
}

export async function getPublicPhenomenalReport(shareToken: string): Promise<PublicPhenomenalReportPayload> {
  const enc = encodeURIComponent(shareToken);
  const res = await apiFetch(`${API_BASE}/api/public/phenomenal-report/${enc}`, { cache: 'no-store' });
  const data = await parseJson<PublicPhenomenalReportPayload & { error?: string }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data;
}

/** Публичная страница отчёта для руководителя (отзывы с Пульса подгружаются с сервера без ИИ). */
export function phenomenalReportPublicUrl(shareToken: string): string {
  const enc = encodeURIComponent(shareToken);
  return `${clientAppBase()}/phenomenal-report/${enc}`;
}

/** ИИ: сгруппировать блоки отчёта, если один урок попал в несколько блоков из-за расхождений в шифре. */
export async function postPhenomenalLessonsClusterReportBlocks(
  blocks: PhenomenalReportBlockDraft[],
): Promise<{ groups: number[][]; llm_provider: string | null; warning?: string }> {
  const res = await apiFetch(`${API_BASE}/api/phenomenal-lessons/cluster-report-blocks`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      blocks: blocks.map((b) => ({
        lessonCode: b.lessonCode,
        conductingTeachers: b.conductingTeachers,
        subjects: b.subjects,
        observerName: b.observerName,
        teacherNotes: b.teacherNotes,
      })),
    }),
  });
  const data = await parseJson<{
    groups?: number[][];
    llm_provider?: string | null;
    warning?: string;
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(
      (data as { message?: string }).message || (data as { error?: string }).error || res.statusText,
    );
  }
  if (!data.groups || !Array.isArray(data.groups)) {
    throw new Error('Нет поля groups в ответе');
  }
  return {
    groups: data.groups,
    llm_provider: data.llm_provider ?? null,
    ...(data.warning ? { warning: data.warning } : {}),
  };
}

export async function importRowsFromXlsxParse(
  surveyId: number,
  rows: { answers: AnswerSubmit[] }[],
): Promise<{ ok: boolean; imported: number; skipped: number; batch_id: string; errors: { row: number; error: string }[] }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/import-rows`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ rows }),
  });
  const data = await parseJson<{ error?: string } & {
    ok: boolean;
    imported: number;
    skipped: number;
    batch_id: string;
    errors: { row: number; error: string }[];
  }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as any;
}

export async function authRegister(payload: { email: string; password: string }): Promise<{ user: { id: number; email: string; role: string } }> {
  const res = await apiFetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ user?: { id: number; email: string; role: string }; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.user) throw new Error('Нет данных пользователя');
  return { user: data.user };
}

export async function authLogin(payload: { email: string; password: string }): Promise<{ token: string; user: { id: number; email: string; role: string }; expires_at: string }> {
  const res = await apiFetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ token?: string; user?: { id: number; email: string; role: string }; expires_at?: string; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.token || !data.user) throw new Error('Нет токена');
  return { token: data.token, user: data.user, expires_at: data.expires_at || '' };
}

export async function authMe(): Promise<{ id: number; email: string; role: string }> {
  const res = await apiFetch(`${API_BASE}/api/auth/me`, { headers: adminHeaders() });
  const data = await parseJson<{ user?: { id: number; email: string; role: string }; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  if (!data.user) throw new Error('Нет данных пользователя');
  return data.user;
}

export async function getSurveyInvites(surveyId: number): Promise<SurveyInviteRow[]> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites`, { headers: adminHeaders() });
  const data = await parseJson<{ invites?: SurveyInviteRow[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.invites || [];
}

export async function saveSurveyInvites(surveyId: number, emailsText: string): Promise<{ ok: boolean; saved: number }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ emails: emailsText }),
  });
  const data = await parseJson<{ ok?: boolean; saved?: number; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return { ok: Boolean(data.ok), saved: Number(data.saved || 0) };
}

export async function getSurveyInviteTemplate(surveyId: number): Promise<SurveyInviteTemplate> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites/template`, { headers: adminHeaders() });
  const data = await parseJson<{ template?: SurveyInviteTemplate; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.template || { subject: '', html: '', updated_at: null };
}

export async function putSurveyInviteTemplate(
  surveyId: number,
  payload: { subject: string; html: string }
): Promise<{ ok: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites/template`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ ok?: boolean; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return { ok: Boolean(data.ok) };
}

export async function sendSurveyInvites(
  surveyId: number,
  payload?: { limit?: number; subject?: string }
): Promise<{ ok: boolean; attempted: number; sent: number; errors: number; details: { email: string; ok: boolean; error?: string }[] }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites/send`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload || {}),
  });
  const data = await parseJson<
    | {
        ok?: boolean;
        attempted?: number;
        sent?: number;
        errors?: number;
        details?: { email: string; ok: boolean; error?: string }[];
        error?: string;
      }
    | any
  >(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return {
    ok: Boolean(data.ok),
    attempted: Number(data.attempted || 0),
    sent: Number(data.sent || 0),
    errors: Number(data.errors || 0),
    details: Array.isArray(data.details) ? data.details : [],
  };
}

export async function remindSurveyInvites(
  surveyId: number,
  payload?: { limit?: number; min_hours_between?: number; subject?: string }
): Promise<{ ok: boolean; attempted: number; sent: number; errors: number; details: { email: string; ok: boolean; error?: string }[] }> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/invites/remind`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload || {}),
  });
  const data = await parseJson<
    | {
        ok?: boolean;
        attempted?: number;
        sent?: number;
        errors?: number;
        details?: { email: string; ok: boolean; error?: string }[];
        error?: string;
      }
    | any
  >(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return {
    ok: Boolean(data.ok),
    attempted: Number(data.attempted || 0),
    sent: Number(data.sent || 0),
    errors: Number(data.errors || 0),
    details: Array.isArray(data.details) ? data.details : [],
  };
}

function textAnswersQueryString(params: { question_id?: number; q?: string; offset?: number; limit?: number }) {
  const sp = new URLSearchParams();
  if (params.question_id != null) sp.set('question_id', String(params.question_id));
  if (params.q) sp.set('q', params.q);
  sp.set('offset', String(params.offset ?? 0));
  sp.set('limit', String(params.limit ?? 40));
  return sp.toString();
}

export async function getSurveyTextAnswers(
  surveyId: number,
  params: { question_id?: number; q?: string; offset?: number; limit?: number }
): Promise<TextAnswersPage> {
  const qs = textAnswersQueryString(params);
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/text-answers?${qs}`, { headers: adminHeaders() });
  const data = await parseJson<TextAnswersPage & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Несколько опросов: сводка, темы, выбранные диаграммы + связный текст (LLM: GigaChat / OpenAI / OpenRouter / Yandex — см. окружение функции). */
export async function postMultiSurveyAnalytics(surveyIds: number[]): Promise<MultiSurveyAnalyticsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/batch-analytics`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ survey_ids: surveyIds }),
  });
  const data = await parseJson<
    MultiSurveyAnalyticsPayload & {
      error?: string;
      message?: string;
      path?: string;
      method?: string;
      segments?: string[];
    }
  >(res);
  if (!res.ok) {
    console.warn('[api] multi-survey-analytics', res.status, data);
    const bodyMsg = (data.message || data.error || '').trim();
    const short =
      res.status === 504 || res.status === 502
        ? 'Сервер долго не отвечает. Попробуйте меньше опросов за раз или повторите позже.'
        : bodyMsg || `Запрос не выполнен (код ${res.status}).`;
    throw new Error(short);
  }
  if (!data || typeof data !== 'object' || !('source' in data)) {
    console.warn('[api] multi-survey incomplete payload', data);
    throw new Error(
      'Сводка пришла неполной (часто из‑за таймаута). Уменьшите число опросов в одном запросе и попробуйте снова.',
    );
  }
  return data;
}

/** Аналитика: структурированный дашборд + опционально текст от нейросети (ключ только на функции). */
export async function requestAiInsights(surveyId: number, filters?: AnalyticsFilter[]): Promise<AiInsightsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/ai-insights`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ filters: filters ?? [] }),
  });
  const data = await parseJson<AiInsightsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Публичная сводка по секретному токену директора (без авторизации). */
export async function getDirectorSurveyResults(
  directorToken: string,
  opts?: { lessonKey?: string },
): Promise<ResultsPayload> {
  const enc = encodeURIComponent(directorToken);
  const q =
    opts?.lessonKey != null && String(opts.lessonKey).trim() !== ''
      ? `?lesson_key=${encodeURIComponent(String(opts.lessonKey).trim())}`
      : '';
  const res = await apiFetch(`${API_BASE}/api/public/director/${enc}/results${q}`, { cache: 'no-store' });
  const data = await parseJson<ResultsPayload & { error?: string; message?: string }>(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || res.statusText);
  }
  return data;
}

/** Список уроков для сводки директора (группировка по учителю, классу, шифру урока). */
export async function getDirectorLessonGroups(directorToken: string): Promise<DirectorLessonGroupsPayload> {
  const enc = encodeURIComponent(directorToken);
  const res = await apiFetch(`${API_BASE}/api/public/director/${enc}/lesson-groups`, { cache: 'no-store' });
  const data = await parseJson<DirectorLessonGroupsPayload & { error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

export async function requestDirectorAiInsights(
  directorToken: string,
  opts?: { lessonKey?: string },
): Promise<AiInsightsPayload> {
  const enc = encodeURIComponent(directorToken);
  const body: Record<string, unknown> = { filters: [] };
  if (opts?.lessonKey != null && String(opts.lessonKey).trim() !== '') {
    body.lesson_key = String(opts.lessonKey).trim();
  }
  const res = await apiFetch(`${API_BASE}/api/public/director/${enc}/ai-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson<AiInsightsPayload & { error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data;
}

/** Диалог с нейроаналитиком по текущей выборке и срезу (на функции нужен OPENAI_API_KEY). */
export async function postAnalyticsChat(
  surveyId: number,
  payload: { filters: AnalyticsFilter[]; messages: AnalyticsChatMessage[] },
): Promise<AnalyticsChatResponse> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/analytics-chat`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ filters: payload.filters, messages: payload.messages }),
  });
  const data = await parseJson<AnalyticsChatResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** ПУЛЬС: диалог по Excel-дашборду (на функции нужен OPENAI_API_KEY). Может вернуть apply_filters для среза. */
export async function postPulseExcelChat(payload: {
  messages: AnalyticsChatMessage[];
  context: {
    facetOptions: Record<string, string[]>;
    facetLabels: Record<string, string>;
    currentFilters: Record<string, string[] | null>;
    numericSummary: string;
    extraContext?: string;
  };
}): Promise<PulseExcelChatResponse> {
  const res = await apiFetch(`${API_BASE}/api/pulse-excel-chat`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<PulseExcelChatResponse & { error?: string }>(res);
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        'Нужна авторизация: на главной админки введите тот же X-Api-Key, что в ADMIN_API_KEY функции, или войдите по почте.',
      );
    }
    throw new Error(data.error || res.statusText);
  }
  return data;
}

/** ИИ: отобрать опросные фильтры + сгруппировать ключи в разделы панели (нужен OPENAI_API_KEY). */
export async function postExcelFilterSections(payload: {
  structuralKeys: string[];
  surveyCandidateKeys: string[];
  columns: {
    filterKey: string;
    role: string;
    roleLabel: string;
    header: string;
    samples: string[];
  }[];
}): Promise<ExcelFilterSectionsResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-filter-sections`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelFilterSectionsResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** ИИ: нормализация значений, иерархии, NL-срез, объяснение среза, подсказки по графикам. */
export async function postExcelDashboardAi(
  payload: { action: string } & Record<string, unknown>,
): Promise<ExcelDashboardAiResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-dashboard-ai`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelDashboardAiResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** ИИ: сгруппировать «сырые» значения одного фильтра (классы, метки) по смыслу. */
export async function postExcelFilterValueGroups(payload: {
  filterKey: string;
  header: string;
  values: string[];
}): Promise<ExcelFilterValueGroupsResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-filter-value-groups`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelFilterValueGroupsResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** ИИ: смысловые группы по значениям одной колонки → отдельные измерения среза (кафедры, блоки и т.д.). */
export async function postExcelDerivedFilters(payload: {
  sourceFilterKey: string;
  sourceHeader: string;
  values: string[];
}): Promise<ExcelDerivedFiltersResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-derived-filters`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelDerivedFiltersResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Связный «Сводный анализ» по машинной сводке и контексту (нужен OPENAI_API_KEY). */
export async function postExcelNarrativeSummary(payload: {
  context: {
    numericSummary: string;
    extraContext?: string;
    facetLabels?: Record<string, string>;
    meta?: {
      filteredRowCount?: number;
      /** @deprecated use uniqueImportRows */
      uniqueLessonCount?: number;
      uniqueImportRows?: number;
      semanticLessonCount?: number;
    };
    /** standard (по умолчанию) | deep — расширенный отчёт по тому же срезу */
    analysisMode?: 'standard' | 'deep';
    /** Человекочитаемое описание активных фильтров (параметры среза). */
    filterSummary?: string;
    /** Доп. пожелания к акцентам анализа. */
    userFocus?: string;
  };
}): Promise<ExcelNarrativeSummaryResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-narrative-summary`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelNarrativeSummaryResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Пакет ИИ-записок для директора по нескольким педагогам (или парам педагог+предмет); до 8 сегментов за запрос. */
export async function postExcelDirectorDossier(payload: {
  packets: { segmentId: string; teacher: string; subject?: string | null; factsSummary: string }[];
  /** Справочник шифр→ФИО с других листов книги (опционально). */
  sharedCodebook?: string;
}): Promise<ExcelDirectorDossierResponse> {
  const res = await apiFetch(`${API_BASE}/api/excel-director-dossier`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<ExcelDirectorDossierResponse & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Список сохранённых на сервере проектов Excel-аналитики (нужен вход по логину, не только API-ключ). */
export type ExcelAnalyticsProjectListItem = {
  id: number;
  title: string;
  fingerprint: string;
  file_name: string;
  sheet: string | null;
  updated_at: string;
};

export async function listExcelAnalyticsProjects(): Promise<ExcelAnalyticsProjectListItem[]> {
  const res = await apiFetch(`${API_BASE}/api/excel-analytics-projects`, { headers: adminHeaders() });
  const data = await parseJson<{ projects?: ExcelAnalyticsProjectListItem[]; error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data.projects || [];
}

export async function getExcelAnalyticsProject(id: number): Promise<{
  id: number;
  title: string;
  session: SavedExcelSession;
  file_name: string;
  fingerprint: string;
}> {
  const res = await apiFetch(`${API_BASE}/api/excel-analytics-projects/${id}`, { headers: adminHeaders() });
  const data = await parseJson<{
    project?: { id: number; title: string; session: SavedExcelSession; file_name: string; fingerprint: string };
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.project?.session) throw new Error('Нет данных проекта');
  return {
    id: data.project.id,
    title: data.project.title,
    session: data.project.session,
    file_name: data.project.file_name,
    fingerprint: data.project.fingerprint,
  };
}

export async function saveExcelAnalyticsProject(payload: {
  title: string;
  session: SavedExcelSession;
  id?: number;
}): Promise<{ id: number; title: string; updated_at: string }> {
  const res = await apiFetch(`${API_BASE}/api/excel-analytics-projects`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{
    project?: { id: number; title: string; updated_at: string };
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.project) throw new Error('Нет ответа');
  return data.project;
}

export async function deleteExcelAnalyticsProject(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/excel-analytics-projects/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  const data = await parseJson<{ error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
}

export async function listPedagogicalSessions(): Promise<PedagogicalSessionListItem[]> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions`, { headers: adminHeaders() });
  const data = await parseJson<{ sessions?: PedagogicalSessionListItem[]; error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data.sessions || [];
}

export async function getPedagogicalSession(id: number): Promise<PedagogicalSessionPayload> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${id}`, { headers: adminHeaders() });
  const data = await parseJson<{ session?: PedagogicalSessionPayload; error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.session) throw new Error('Нет данных сессии');
  return data.session;
}

export async function savePedagogicalSession(payload: {
  title: string;
  state: PedagogicalAnalyticsState;
  id?: number;
}): Promise<{ id: number; title: string; updated_at: string; state: PedagogicalAnalyticsState }> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{
    session?: { id: number; title: string; updated_at: string; state: PedagogicalAnalyticsState };
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.session) throw new Error('Нет ответа');
  return data.session;
}

/** Псевдонимизация: в LLM уходит только redactedText; map храните в сессии, не отправляйте в провайдера. */
export async function postPedagogicalPiiTokenize(
  plain: string,
  entities: PedagogicalPiiEntityDraft[],
  opts?: { auto?: boolean }
): Promise<{ redactedText: string; map: Record<string, string>; entityCount?: number }> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-pii-tokenize`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      plain,
      auto: opts?.auto === true,
      entities: entities.map((e) => ({ type: e.type, value: e.value })),
    }),
  });
  const data = await parseJson<{
    redactedText?: string;
    map?: Record<string, string>;
    entityCount?: number;
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return { redactedText: data.redactedText ?? '', map: data.map ?? {}, entityCount: data.entityCount };
}

/** Авто-псевдонимизация на сервере + LLM; в провайдер уходит только redacted-текст. */
export async function postPedagogicalAnalyticsLlm(
  sessionId: number,
  body?: {
    maxTokens?: number;
    /** Текущий черновик с клиента (если ещё не сохранён в сессию). */
    sourcePlain?: string;
    /** По одному фрагменту на педагога (строка Excel); авто-ПДн на сервере обходит каждый блок отдельно. */
    sourceBlocks?: string[];
    extraEntities?: PedagogicalPiiEntityDraft[];
  }
): Promise<{
  replyRedacted: string;
  replyPlain: string;
  provider?: string;
  session: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState };
}> {
  const payload: Record<string, unknown> = {};
  if (body?.maxTokens != null) payload.maxTokens = body.maxTokens;
  if (body?.sourcePlain != null && body.sourcePlain.trim()) payload.sourcePlain = body.sourcePlain.trim();
  if (body?.sourceBlocks?.length) {
    payload.sourceBlocks = body.sourceBlocks.map((s) => String(s ?? '')).filter((s) => s.trim());
  }
  if (body?.extraEntities?.length) {
    payload.extraEntities = body.extraEntities
      .filter((e) => e.value.trim())
      .map((e) => ({ type: e.type, value: e.value.trim() }));
  }
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${sessionId}/llm`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{
    ok?: boolean;
    replyRedacted?: string;
    replyPlain?: string;
    provider?: string;
    session?: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState };
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.session || data.replyPlain == null) throw new Error('Нет ответа сессии');
  return {
    replyRedacted: data.replyRedacted ?? '',
    replyPlain: data.replyPlain ?? '',
    provider: data.provider,
    session: data.session,
  };
}

/** Один педагог по индексу в sourceBlocks; для прогресс-бара — вызывать по очереди с restart при index === 0. */
export async function postPedagogicalLlmTeacher(
  sessionId: number,
  body: {
    index: number;
    restart?: boolean;
    sourceBlocks?: string[];
    extraEntities?: PedagogicalPiiEntityDraft[];
    maxTokens?: number;
  },
): Promise<{ session: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState } }> {
  const payload: Record<string, unknown> = {
    index: body.index,
    restart: body.restart === true,
  };
  if (body.sourceBlocks?.length) {
    payload.sourceBlocks = body.sourceBlocks.map((s) => String(s ?? '')).filter((s) => s.trim());
  }
  if (body.extraEntities?.length) {
    payload.extraEntities = body.extraEntities
      .filter((e) => e.value.trim())
      .map((e) => ({ type: e.type, value: e.value.trim() }));
  }
  if (body.maxTokens != null) payload.maxTokens = body.maxTokens;
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${sessionId}/llm-teacher`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{
    session?: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState };
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.session) throw new Error('Нет ответа сессии');
  return { session: data.session };
}

/** Параллельная обработка всех педагогов на сервере (пул). */
export async function postPedagogicalLlmTeachersBatch(
  sessionId: number,
  body?: {
    sourceBlocks?: string[];
    extraEntities?: PedagogicalPiiEntityDraft[];
    maxTokens?: number;
    /** Степень параллелизма на сервере (1–5). */
    parallel?: number;
    /** Если задано — пересчитать только эти индексы педагогов. */
    selectedIndices?: number[];
  },
): Promise<{
  ok: boolean;
  message?: string;
  session: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState };
}> {
  const payload: Record<string, unknown> = {};
  if (body?.sourceBlocks?.length) {
    payload.sourceBlocks = body.sourceBlocks.map((s) => String(s ?? '')).filter((s) => s.trim());
  }
  if (body?.extraEntities?.length) {
    payload.extraEntities = body.extraEntities
      .filter((e) => e.value.trim())
      .map((e) => ({ type: e.type, value: e.value.trim() }));
  }
  if (body?.maxTokens != null) payload.maxTokens = body.maxTokens;
  if (body?.parallel != null) payload.parallel = body.parallel;
  if (body?.selectedIndices?.length) {
    payload.selectedIndices = body.selectedIndices
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v >= 0)
      .map((v) => Math.floor(v));
  }
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${sessionId}/llm-teachers-batch`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{
    ok?: boolean;
    message?: string;
    session?: { id: number; title: string; updated_at?: string; state: PedagogicalAnalyticsState };
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  if (!data.session) throw new Error('Нет ответа сессии');
  return { ok: data.ok !== false, message: data.message, session: data.session };
}

export async function deletePedagogicalSession(id: number): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  const data = await parseJson<{ error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
}

export async function postPedagogicalNotify(
  sessionId: number,
  body: {
    consent: boolean;
    emails?: string[];
    maxWebhookUrl?: string;
    subject?: string;
    html?: string;
    text?: string;
    /** Текст для вебхука; по умолчанию без расшифровки токенов (как в сессии). */
    maxText?: string;
    detokenizeEmail?: boolean;
    maxDetokenize?: boolean;
  }
): Promise<{
  ok: boolean;
  smtp_configured?: boolean;
  results: {
    email: { sent: number; failed: { to: string; error: string }[] };
    max: { ok: boolean; detail: string | null };
  };
}> {
  const res = await apiFetch(`${API_BASE}/api/pedagogical-analytics-sessions/${sessionId}/notify`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<
    { ok?: boolean; results?: unknown; error?: string; message?: string } & Record<string, unknown>
  >(res);
  if (!res.ok) throw new Error(data.message || data.error || res.statusText);
  return data as {
    ok: boolean;
    results: {
      email: { sent: number; failed: { to: string; error: string }[] };
      max: { ok: boolean; detail: string | null };
    };
  };
}

/** Компиляция и вывод по всем текстовым ответам на один вопрос (ИИ — если OPENAI_API_KEY на функции). */
export async function requestTextQuestionInsights(
  surveyId: number,
  questionId: number
): Promise<TextQuestionInsightsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/text-question-insights`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ question_id: questionId }),
  });
  const data = await parseJson<TextQuestionInsightsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function getComments(surveyId: number): Promise<CommentRow[]> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/comments`, { headers: adminHeaders() });
  const data = await parseJson<{ comments: CommentRow[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.comments || [];
}

export async function postComment(
  surveyId: number,
  body: { text: string; question_id?: number | null }
): Promise<CommentRow> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/comments`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ comment: CommentRow; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.comment;
}

export async function getPublicSurvey(accessLink: string): Promise<Survey> {
  const res = await apiFetch(`${API_BASE}/api/public/surveys/${encodeURIComponent(accessLink)}`);
  const data = await parseJson<{ survey: Survey; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.survey;
}

/**
 * У API Gateway Яндекса лимит тела запроса по умолчанию 4 МБ (4194304).
 * Base64 увеличивает размер файла ~на 4/3, плюс рамка JSON и имя файла — нельзя брать «сырой» лимит 4 МБ.
 */
const YC_APIGW_DEFAULT_BODY_BYTES = 4 * 1024 * 1024;
const WORKBOOK_JSON_OVERHEAD_BYTES = 48 * 1024;
const WORKBOOK_BASE64_MAX_BYTES = Math.max(
  256 * 1024,
  Math.floor(((YC_APIGW_DEFAULT_BODY_BYTES - WORKBOOK_JSON_OVERHEAD_BYTES) * 3) / 4),
);

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/**
 * Новый черновик из Excel: предпочтительно JSON + file_base64 (стабильно через API Gateway);
 * для крупных файлов — multipart (поле file).
 */
export async function postSurveyFromWorkbook(file: File): Promise<{
  survey: Survey;
  workbook: SurveyWorkbook;
  import?: { imported: number; errors: { row: number; error: string }[] };
}> {
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem('admin_api_key') || '' : '';
  const url = `${API_BASE}/api/surveys/from-workbook`;

  let res: Response;
  if (file.size <= WORKBOOK_BASE64_MAX_BYTES) {
    const file_base64 = await readFileAsBase64(file);
    res = await apiFetch(url, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ filename: file.name, file_base64 }),
    });
  } else {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const headers: Record<string, string> = {};
    if (key) headers['X-Api-Key'] = key;
    res = await apiFetch(url, {
      method: 'POST',
      headers,
      body: fd,
    });
  }

  const text = await res.text();
  let data: {
    survey?: Survey;
    workbook?: SurveyWorkbook;
    import?: { imported: number; errors: { row: number; error: string }[] };
    error?: string;
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    if (!res.ok && (res.status === 413 || /4194304|4\s*МБ|размер файла/i.test(text))) {
      throw new Error(
        'Файл слишком большой для лимита шлюза (обычно 4 МБ на один запрос). Уменьшите .xlsx, либо в Яндекс Облаке у API Gateway увеличьте максимальный размер тела запроса; для больших файлов приложение отправляет multipart вместо JSON.',
      );
    }
    throw new Error(
      res.ok ? 'Некорректный ответ сервера' : 'Сервер вернул не JSON — проверьте VITE_API_BASE и шлюз',
    );
  }
  if (!res.ok) {
    const apiErr = (data as { error?: string }).error || res.statusText;
    if (res.status === 413 || /4194304|4\s*МБ/i.test(apiErr)) {
      throw new Error(
        'Файл слишком большой для лимита шлюза (4 МБ). Уменьшите .xlsx или увеличьте лимит тела запроса в настройках API Gateway.',
      );
    }
    throw new Error(apiErr);
  }
  if (!data.survey) throw new Error(data.error || 'Нет данных опроса в ответе');
  return {
    survey: data.survey,
    workbook: data.workbook as SurveyWorkbook,
    import: data.import,
  };
}

export async function submitResponse(
  accessLink: string,
  respondentId: string,
  answers: AnswerSubmit[]
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/public/surveys/${encodeURIComponent(accessLink)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ respondent_id: respondentId, answers }),
  });
  const data = await parseJson<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
}

export type PhotoWallApprovedPhoto = { id: number; image_data: string };

/** Ответ публичного списка одобренных: часть снимков может быть отсечена лимитом размера JSON на бэкенде. */
export type GetPublicPhotoWallApprovedResult = {
  photos: PhotoWallApprovedPhoto[];
  truncated?: boolean;
  hint?: string;
};

export async function getPublicPhotoWallApproved(): Promise<GetPublicPhotoWallApprovedResult> {
  const res = await apiFetch(`${API_BASE}/api/public/photo-wall/approved`, {
    /** default: браузер может кэшировать при Cache-Control с бэкенда (лёгкие URL), меньше нагрузка на Neon */
    cache: 'default',
    headers: { Accept: 'application/json' },
  });
  const data = await parseJson<{
    photos?: { id: number; image_data?: string; imageData?: string }[];
    truncated?: boolean;
    photo_wall_hint?: string;
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) {
    const code =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    const detail = typeof data.message === 'string' && data.message && data.message !== code ? data.message : '';
    let msg = code;
    if (code === 'photo_wall_approved_failed' || /photo_wall_approved_failed/i.test(code)) {
      msg =
        'Не удалось загрузить коллаж. Проверьте миграции БД для фотостены (009–012), подключение к PostgreSQL и логи Cloud Function.';
      if (detail) msg = `${msg} Технически: ${detail}`;
    } else if (code === 'photo_wall_payload_too_large' || res.status === 413) {
      msg =
        'Ответ с фотостены слишком большой. Включите Object Storage (PHOTO_WALL_STORAGE=1) и URL в БД или уменьшите число одобренных снимков.';
      if (detail) msg = `${msg} ${detail}`;
    }
    throw new Error(msg);
  }
  const rows = data.photos || [];
  const photos = rows
    .map((row) => {
      const image_data = row.image_data ?? row.imageData ?? '';
      return { id: row.id, image_data: typeof image_data === 'string' ? image_data : '' };
    })
    .filter((row) => row.image_data.length > 0);
  return {
    photos,
    truncated: Boolean(data.truncated),
    hint: typeof data.photo_wall_hint === 'string' ? data.photo_wall_hint : undefined,
  };
}

export async function postPublicPhotoWallUpload(
  respondentId: string,
  imageData: string,
  thumbData?: string,
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/public/photo-wall/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      respondent_id: respondentId,
      image_data: imageData,
      ...(thumbData ? { thumb_data: thumbData } : {}),
    }),
  });
  const data = await parseJson<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
}

export async function getPhotoWallPhotos(): Promise<PhotoWallPhotoRow[]> {
  const res = await apiFetch(`${API_BASE}/api/photo-wall/photos`, { headers: adminHeaders() });
  const data = await parseJson<{ photos?: PhotoWallPhotoRow[]; error?: string; message?: string }>(res);
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.photos || [];
}

/** Полное фото одной записи (модерация): HTTPS из статики или data URL из БД. */
export async function getPhotoWallPhotoFull(id: number): Promise<{ image_data: string }> {
  const res = await apiFetch(`${API_BASE}/api/photo-wall/photos/${id}/full`, { headers: adminHeaders() });
  const data = await parseJson<{ image_data?: string; image_url?: string; error?: string; message?: string }>(res);
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const url = typeof data.image_url === 'string' ? data.image_url.trim() : '';
  if (url) return { image_data: url };
  const image_data = typeof data.image_data === 'string' ? data.image_data : '';
  if (!image_data) throw new Error('Пустое изображение');
  return { image_data };
}

export type PhotoWallClearScope = 'approved' | 'pending' | 'rejected' | 'all';

export type PhotoWallClearResult = {
  deleted: number;
  storage_deleted?: number;
  storage_skipped?: boolean;
  storage_error?: string;
};

/** Массовая очистка фотостены (админ). При scope=all можно удалить объекты в бакете (photo-wall/). */
export async function postPhotoWallClear(
  scope: PhotoWallClearScope,
  opts?: { purgeObjectStorage?: boolean },
): Promise<PhotoWallClearResult> {
  const body: Record<string, unknown> = { scope, confirm: true };
  if (scope === 'all' && opts?.purgeObjectStorage) {
    body.purge_object_storage = true;
  }
  const res = await apiFetch(`${API_BASE}/api/photo-wall/clear`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<{
    deleted?: number;
    storage_deleted?: number;
    storage_skipped?: boolean;
    storage_error?: string;
    error?: string;
    message?: string;
  }>(res);
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return {
    deleted: Number(data.deleted ?? 0),
    ...(typeof data.storage_deleted === 'number' ? { storage_deleted: data.storage_deleted } : {}),
    ...(typeof data.storage_skipped === 'boolean' ? { storage_skipped: data.storage_skipped } : {}),
    ...(typeof data.storage_error === 'string' ? { storage_error: data.storage_error } : {}),
  };
}

export type PostPhotoWallApproveAllOptions = {
  /** Если массовый POST недоступен (старая функция / 404), одобряем через уже существующий PATCH по списку id. */
  fallbackPendingIds?: number[];
};

/** Одобрить все pending (админ). Два URL + при 404 запасной вариант PATCH по id. */
export async function postPhotoWallApproveAll(options?: PostPhotoWallApproveAllOptions): Promise<{ updated: number }> {
  const urls = [`${API_BASE}/api/photo-wall/photos/approve-all`, `${API_BASE}/api/photo-wall/approve-all`];
  let lastFail: Error | null = null;

  for (const url of urls) {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    });
    const data = await parseJson<{ updated?: number; error?: string; message?: string }>(res);
    if (res.ok) {
      return { updated: Number(data.updated ?? 0) };
    }
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    lastFail = new Error(msg);
    if (res.status === 404) continue;
    throw lastFail;
  }

  const ids = (options?.fallbackPendingIds ?? []).filter((id) => Number.isFinite(id));
  if (ids.length === 0) {
    throw lastFail ?? new Error('Not found');
  }
  await Promise.all(ids.map((id) => patchPhotoWallPhoto(id, 'approved')));
  return { updated: ids.length };
}

export async function patchPhotoWallPhoto(
  id: number,
  moderation_status: PhotoWallModerationStatus,
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/photo-wall/photos/${id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ moderation_status }),
  });
  const data = await parseJson<{ error?: string; message?: string }>(res);
  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      res.statusText ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

/** Корень SPA (не текущий путь — иначе из /surveys/1/results получится …/results/s/…). */
function clientAppBase(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const path = base === '/' ? '' : base.replace(/\/$/, '');
  return `${window.location.origin}${path}`;
}

export function publicFormUrl(accessLink: string): string {
  return `${clientAppBase()}/s/${accessLink}`;
}

/** Публичная сводка для руководителя (без входа в админку). */
export function directorSurveyUrl(directorToken: string): string {
  const enc = encodeURIComponent(directorToken);
  return `${clientAppBase()}/director/${enc}`;
}

/** Сводка для руководителя: список уроков → отдельные диаграммы по каждому уроку (феноменальные опросы). */
export function directorSurveyLessonsUrl(directorToken: string): string {
  const enc = encodeURIComponent(directorToken);
  return `${clientAppBase()}/director/${enc}/lessons`;
}

import type {
  AiInsightsPayload,
  AnalyticsChatMessage,
  AnalyticsChatResponse,
  AnalyticsFilter,
  PulseExcelChatResponse,
  ExcelFilterSectionsResponse,
  ExcelFilterValueGroupsResponse,
  ExcelNarrativeSummaryResponse,
  ExcelDirectorDossierResponse,
  TextQuestionInsightsPayload,
  AnswerSubmit,
  CommentRow,
  ResultsPayload,
  Survey,
  SurveyInviteRow,
  SurveyInviteTemplate,
  SurveyExportRowsPayload,
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
  } catch {
    const hint = API_BASE
      ? 'Проверьте: 1) в спецификации API Gateway блок x-yc-apigateway.cors (см. scripts/survey-api-gw.yaml); 2) CORS_ORIGIN на функции совпадает с сайтом; 3) VITE_API_BASE без лишнего /api в конце.'
      : 'Соберите фронт с VITE_API_BASE=https://… (URL шлюза) и снова залейте в бакет.';
    throw new Error(`Запрос к API не выполнился (сеть или CORS). ${hint}`);
  }
}

function adminHeaders(): HeadersInit {
  const key = localStorage.getItem('admin_api_key') || '';
  const token = localStorage.getItem('auth_token') || '';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  // Ключ из главной админки должен иметь приоритет: иначе просроченный Bearer перекрывает валидный X-Api-Key.
  if (key.trim()) h['X-Api-Key'] = key.trim();
  else if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  let text = await res.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text) return {} as T;
  const t = text.trim();
  const lead = t.trimStart().slice(0, 1);
  if (lead === '<') {
    throw new Error(
      API_BASE
        ? 'Сервер ответил страницей/XML вместо JSON — проверьте VITE_API_BASE и путь API.'
        : 'API не настроен: соберите фронт с VITE_API_BASE=https://… (URL функции или API Gateway) и залейте в бакет снова.',
    );
  }
  try {
    return JSON.parse(t) as T;
  } catch (e) {
    const preview = t.replace(/\s+/g, ' ').slice(0, 220);
    const base = API_BASE || '(VITE_API_BASE не задан при сборке)';
    const hint =
      e instanceof SyntaxError
        ? ' Похоже на обрезанный ответ, HTML вместо JSON или неверный URL (не вставляйте адрес API в консоль без fetch/кавычек).'
        : '';
    throw new Error(
      `Ответ не JSON (HTTP ${res.status}).${hint} ` +
        (preview ? `Начало ответа: ${preview}` : 'Пустой или битый ответ') +
        `. Ожидался JSON с ${base}/api/… Проверьте адрес API в сборке, маршруты шлюза и CORS_ORIGIN на функции.`,
    );
  }
}

export async function listSurveys(): Promise<Survey[]> {
  const res = await apiFetch(`${API_BASE}/api/surveys`, { headers: adminHeaders() });
  const data = await parseJson<{ surveys: Survey[] }>(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data.surveys || [];
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
export async function getDirectorSurveyResults(directorToken: string): Promise<ResultsPayload> {
  const enc = encodeURIComponent(directorToken);
  const res = await apiFetch(`${API_BASE}/api/public/director/${enc}/results`, { cache: 'no-store' });
  const data = await parseJson<ResultsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function requestDirectorAiInsights(directorToken: string): Promise<AiInsightsPayload> {
  const enc = encodeURIComponent(directorToken);
  const res = await apiFetch(`${API_BASE}/api/public/director/${enc}/ai-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: [] }),
  });
  const data = await parseJson<AiInsightsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
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

/** ИИ: сгруппировать ключи фильтров в разделы боковой панели по контексту колонок (нужен OPENAI_API_KEY). */
export async function postExcelFilterSections(payload: {
  filterKeys: string[];
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

/** Связный «Сводный анализ» по машинной сводке и контексту (нужен OPENAI_API_KEY). */
export async function postExcelNarrativeSummary(payload: {
  context: {
    numericSummary: string;
    extraContext?: string;
    facetLabels?: Record<string, string>;
    meta?: { filteredRowCount?: number; uniqueLessonCount?: number };
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

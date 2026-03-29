import type {
  AiInsightsPayload,
  TextQuestionInsightsPayload,
  AnswerSubmit,
  CommentRow,
  ResultsPayload,
  Survey,
  SurveyExportRowsPayload,
  SurveyWorkbook,
  TextAnswersPage,
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
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h['X-Api-Key'] = key;
  return h;
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  const t = text.trim();
  if (t.startsWith('<!') || t.startsWith('<html') || t.startsWith('<?xml')) {
    throw new Error(
      API_BASE
        ? 'Сервер ответил страницей/XML вместо JSON — проверьте VITE_API_BASE и путь API.'
        : 'API не настроен: соберите фронт с VITE_API_BASE=https://… (URL функции или API Gateway) и залейте в бакет снова.'
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Ответ не JSON. Проверьте URL API и CORS на стороне функции.');
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

export async function getSurveyExportRows(surveyId: number): Promise<SurveyExportRowsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/export-rows`, { headers: adminHeaders() });
  const data = await parseJson<SurveyExportRowsPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
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
export async function requestAiInsights(surveyId: number): Promise<AiInsightsPayload> {
  const res = await apiFetch(`${API_BASE}/api/surveys/${surveyId}/ai-insights`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({}),
  });
  const data = await parseJson<AiInsightsPayload & { error?: string }>(res);
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

export function publicFormUrl(accessLink: string): string {
  const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
  return `${base}/s/${accessLink}`;
}

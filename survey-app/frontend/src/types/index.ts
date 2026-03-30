export type SurveyStatus = 'draft' | 'published' | 'closed';
export type QuestionType = 'radio' | 'checkbox' | 'scale' | 'text' | 'rating' | 'date';

export interface Question {
  id: number;
  survey_id: number;
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
}

export interface Survey {
  id: number;
  title: string;
  description: string;
  created_at: string;
  created_by: number | null;
  status: SurveyStatus;
  access_link: string;
  media?: { photos?: { src: string; name?: string }[] };
  questions?: Question[];
}

export interface SurveyInviteRow {
  email: string;
  status: 'pending' | 'sent' | 'error' | 'responded' | string;
  sent_at: string | null;
  last_sent_at?: string | null;
  responded_at?: string | null;
  attempts?: number;
  last_error: string | null;
  created_at: string;
}

export interface SurveyInviteTemplate {
  subject: string;
  html: string;
  updated_at: string | null;
}

export interface AnswerSubmit {
  question_id: number;
  value: string | number | string[];
}

export interface CommentRow {
  id: number;
  survey_id: number;
  question_id: number | null;
  user_id: number | null;
  text: string;
  created_at: string;
}

export interface ResultQuestion {
  question_id: number;
  type: QuestionType;
  text: string;
  response_count: number;
  distribution?: { label: string | number; count: number }[];
  average?: number | null;
  min?: number | null;
  max?: number | null;
  /** Пустой в публичном API; полный список — через text-answers */
  samples?: string[];
  /** Самые содержательные уникальные ответы (по длине текста) */
  samples_highlight?: string[];
  samples_total?: number;
}

export interface TextWordCloudWord {
  text: string;
  count: number;
}

export interface TextAnswersPage {
  rows: { question_id: number; text: string; submitted_at: string }[];
  total: number;
  question_ids?: number[];
}

export interface ResultsChartDailyPoint {
  date: string;
  total: number;
}

export interface ResultsChartQuestionSeries {
  question_id: number;
  short_label: string;
  points: { date: string; count: number }[];
}

export interface ResultsChartDowStack {
  dow: number;
  label: string;
  stacks: { question_id: number; label: string; count: number }[];
}

export interface ResultsChartsBlock {
  daily: ResultsChartDailyPoint[];
  top_questions_timeseries: ResultsChartQuestionSeries[];
  dow_stacked: ResultsChartDowStack[];
}

export interface WorkbookSheet {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

export interface SurveyWorkbook {
  id: number;
  filename: string;
  sheets: WorkbookSheet[];
  ai_commentary: string | null;
  created_at: string;
}

/** Срез для аналитики по выборке (совпадает с телом filters у API). */
export interface AnalyticsFilter {
  question_id: number;
  value: string;
}

export interface AnalyticsChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalyticsChatResponse {
  source: string;
  reply: string;
  total_responses: number;
}

export interface ResultsPayload {
  survey: Pick<Survey, 'id' | 'title' | 'status' | 'access_link'>;
  total_responses: number;
  questions: ResultQuestion[];
  charts?: ResultsChartsBlock;
  /** Облако слов по всем свободным ответам опроса */
  text_word_cloud?: { words: TextWordCloudWord[] };
  /** Если ответ пришёл с POST /results-filter — какие условия применены */
  filters_applied?: AnalyticsFilter[];
  workbooks?: SurveyWorkbook[];
}

export type InsightTone = 'positive' | 'neutral' | 'attention' | 'negative';

export interface InsightKpi {
  id: string;
  label: string;
  value: string;
  hint: string | null;
}

export interface InsightBlock {
  title: string;
  body: string;
  tone: InsightTone;
}

export interface InsightQuestionSummary {
  question_id: number;
  title: string;
  type: QuestionType;
  response_count: number;
  detail: string;
  avg?: number | null;
  min?: number | null;
  max?: number | null;
  bars: { label: string; pct: number }[];
}

export interface InsightDashboard {
  kpis: InsightKpi[];
  highlights: InsightBlock[];
  alerts: InsightBlock[];
  questions: InsightQuestionSummary[];
  meta: { generated: string; response_count: number };
}

export interface InsightRelation {
  a: number;
  b: number;
  n: number;
  method: 'pearson_abs' | 'cramers_v' | 'eta2' | string;
  score: number;
  why: string;
  a_type?: string;
  b_type?: string;
  a_text?: string;
  b_text?: string;
}

export interface AiInsightsPayload {
  source: string;
  dashboard: InsightDashboard;
  relations?: InsightRelation[];
  narrative: string | null;
  survey: Pick<Survey, 'id' | 'title' | 'status' | 'access_link' | 'questions'>;
  total_responses: number;
}

/** Сводка по одному текстовому вопросу: эвристика + опционально нейросеть. */
export interface TextQuestionInsightsPayload {
  source: string;
  question_id: number;
  question_text: string;
  answers_used: number;
  heuristic_summary: string;
  top_terms: { word: string; count: number }[];
  narrative: string | null;
}

/** Сырые строки для выгрузки ответов в Excel (админка). */
export interface SurveyExportRowsPayload {
  survey: { id: number; title: string };
  questions: { id: number; text: string; type: QuestionType }[];
  rows: {
    respondent_id: string;
    created_at: string;
    answers: Record<number, unknown>;
  }[];
}

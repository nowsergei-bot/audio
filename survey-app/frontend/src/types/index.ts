export type SurveyStatus = 'draft' | 'published' | 'closed';
export type QuestionType = 'radio' | 'checkbox' | 'scale' | 'text' | 'rating';

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
  questions?: Question[];
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

export interface ResultsPayload {
  survey: Pick<Survey, 'id' | 'title' | 'status' | 'access_link'>;
  total_responses: number;
  questions: ResultQuestion[];
  charts?: ResultsChartsBlock;
  /** Облако слов по всем свободным ответам опроса */
  text_word_cloud?: { words: TextWordCloudWord[] };
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
  bars: { label: string; pct: number }[];
}

export interface InsightDashboard {
  kpis: InsightKpi[];
  highlights: InsightBlock[];
  alerts: InsightBlock[];
  questions: InsightQuestionSummary[];
  meta: { generated: string; response_count: number };
}

export interface AiInsightsPayload {
  source: string;
  dashboard: InsightDashboard;
  narrative: string | null;
  survey: Pick<Survey, 'id' | 'title' | 'status' | 'access_link'>;
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

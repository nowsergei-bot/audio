export type SurveyStatus = 'draft' | 'published' | 'closed';
export type QuestionType = 'radio' | 'checkbox' | 'scale' | 'text' | 'rating' | 'date';

/** Раздел (группа) опросов в админке — для методистов и сводной аналитики */
export interface SurveyGroup {
  id: number;
  slug: string;
  name: string;
  curator_name: string;
  sort_order: number;
}

export interface Question {
  id: number;
  survey_id: number;
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
  required: boolean;
}

export interface Survey {
  id: number;
  title: string;
  description: string;
  created_at: string;
  created_by: number | null;
  status: SurveyStatus;
  access_link: string;
  allow_multiple_responses?: boolean;
  /** false — в БД нет колонки, настройка не сохраняется (нужна миграция). */
  allow_multiple_responses_supported?: boolean;
  /** Секрет для страницы «для директора» (не путать с access_link формы). */
  director_token?: string | null;
  media?: { photos?: { src: string; name?: string }[] };
  questions?: Question[];
  survey_group_id?: number | null;
  survey_group?: SurveyGroup | null;
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

/** Ответ ПУЛЬСА по Excel-дашборду: текст + опционально срез фильтров. */
export interface PulseExcelChatResponse {
  source: string;
  reply: string;
  apply_filters: Record<string, string[]> | null;
}

/** План разделов боковой панели фильтров Excel-дашборда (ИИ или null + fallback на клиенте). */
export interface ExcelFilterSectionPlan {
  id: string;
  title: string;
  keys: string[];
}

export interface ExcelFilterSectionsResponse {
  source: string;
  sections: ExcelFilterSectionPlan[] | null;
  /** Подмножество опросных ключей, отобранное ИИ (пустой массив = без опросных фильтров). */
  surveyFilterKeys?: string[] | null;
  hint?: string;
}

/** Смысловые подгруппы значений одного фильтра (ИИ). */
export interface ExcelFilterValueGroup {
  id: string;
  label: string;
  values: string[];
}

export interface ExcelFilterValueGroupsResponse {
  source: string;
  filterKey: string;
  groups: ExcelFilterValueGroup[] | null;
  hint?: string;
}

/** Унифицированный ответ `POST /api/excel-dashboard-ai` (поля зависят от action). */
export type ExcelDashboardAiAction =
  | 'normalize_values'
  | 'value_hierarchy'
  | 'nl_slice'
  | 'explain_slice'
  | 'chart_interpret'
  | 'chart_anomalies'
  | 'chart_spec';

export interface ExcelDashboardAiResponse {
  source: string;
  hint?: string;
  canonicalMap?: Record<string, string> | null;
  groups?: { id: string; label: string; parentId: string | null; values: string[] }[] | null;
  reply?: string | null;
  apply_filters?: Record<string, string[]> | null;
  explanation?: string | null;
  insight?: string | null;
  bullets?: string[] | null;
  recommendation?: string | null;
  focusFilterKey?: string | null;
  focusMetricLabel?: string | null;
}

/** ИИ: 1–3 производных измерения (каждое — маппинг значения базовой колонки → группа). */
export interface ExcelDerivedFilterDimensionPayload {
  title: string;
  assignments: Record<string, string>;
}

export interface ExcelDerivedFiltersResponse {
  source: string;
  dimensions: ExcelDerivedFilterDimensionPayload[] | null;
  hint?: string;
}

/** Сохраняется на клиенте вместе с id и исходным ключом фильтра */
export interface ExcelDerivedFilterDimension extends ExcelDerivedFilterDimensionPayload {
  id: string;
  sourceFilterKey: string;
}

/** Связный текст сводки Excel-дашборда (ИИ по машинной сводке). */
export interface ExcelNarrativeSummaryResponse {
  source: string;
  narrative: string | null;
  hint?: string;
  /** Оценка длины отчёта (слова), если ответ от LLM прошёл проверку. */
  wordCount?: number;
  /** Вернётся с бэкенда: standard | deep */
  analysisMode?: string;
}

/** Записки для директора по сегментам (педагог / педагог+предмет). */
export interface ExcelDirectorDossierItem {
  segmentId: string;
  narrative: string;
}

export interface ExcelDirectorDossierResponse {
  source: string;
  items: ExcelDirectorDossierItem[] | null;
  hint?: string;
}

export interface ResultsPayload {
  survey: {
    id: number;
    title: string;
    status: SurveyStatus;
    access_link?: string;
    director_token?: string | null;
  };
  total_responses: number;
  questions: ResultQuestion[];
  charts?: ResultsChartsBlock;
  /** Облако слов по всем свободным ответам опроса */
  text_word_cloud?: { words: TextWordCloudWord[] };
  /** Если ответ пришёл с POST /results-filter — какие условия применены */
  filters_applied?: AnalyticsFilter[];
  workbooks?: SurveyWorkbook[];
  /** Срез по одному уроку (публичная ссылка директора с lesson_key) */
  lesson_key?: string;
  lesson_filter_active?: boolean;
}

/** Урок для сводки директора по феноменальным опросам (группировка ответов родителей) */
export interface DirectorLessonGroup {
  lesson_key: string;
  teacher: string;
  class_label: string;
  lesson_code: string;
  response_count: number;
}

export type DirectorLessonSplitMode =
  | 'triple'
  | 'code_teacher'
  | 'code_class'
  | 'code_only'
  | 'entire_survey';

export interface DirectorLessonGroupsPayload {
  survey: { id: number; title: string; status: SurveyStatus };
  lesson_split: {
    source: string;
    mode: DirectorLessonSplitMode;
    teacher_question_id: number | null;
    class_question_id: number | null;
    lesson_code_question_id: number | null;
  };
  groups: DirectorLessonGroup[];
  hint?: string;
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
  /** Если нейросеть не ответила, краткая причина (для админов; ключи не раскрываются). */
  llm_error?: string;
  dashboard: InsightDashboard;
  relations?: InsightRelation[];
  narrative: string | null;
  survey: Pick<Survey, 'id' | 'title' | 'status' | 'access_link' | 'questions'>;
  total_responses: number;
}

/** Секция связного текста мультисводки (нейросеть). */
export interface MultiSurveyNarrativeSection {
  heading: string;
  body: string;
}

/** Объединённые моделью схожие вопросы из разных волн опроса. */
export interface MultiSurveyMergedTheme {
  theme_title: string;
  refs: string[];
  synthesis: string;
  takeaway: string;
}

/** Вопрос с данными для диаграммы — выбран моделью или эвристикой. */
export interface MultiSurveyHighlight {
  survey_id: number;
  survey_title: string;
  question: ResultQuestion;
  /** Зачем показан этот график (от ИИ). */
  chart_rationale?: string;
}

/** Почему вместо LLM показана эвристика (только при source heuristic_multi). */
export interface MultiSurveyLlmFallback {
  code: string;
  hint_ru: string;
}

/** Сводка и текстовая аналитика сразу по нескольким опросам (админка). */
export interface MultiSurveyAnalyticsPayload {
  source: 'llm_multi' | 'llm_multi_partial' | 'heuristic_multi' | string;
  narrative: string | null;
  /** Структурированный текст при ответе нейросети. */
  narrative_sections?: MultiSurveyNarrativeSection[];
  merged_themes?: MultiSurveyMergedTheme[];
  highlight_questions?: MultiSurveyHighlight[];
  /** Уточнение, если сработала автосводка вместо нейросети. */
  llm_fallback?: MultiSurveyLlmFallback | null;
  surveys: {
    id: number;
    title: string;
    status: SurveyStatus;
    total_responses: number;
    question_count: number;
  }[];
  grand_total_responses: number;
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

/** Слияние ответов родителей (опрос) со строками чек-листа педагогов через LLM на сервере. */
export interface PhenomenalMergeRow {
  parent_row_index: number;
  teacher_row_index: number | null;
  confidence: number;
  reason: string;
  parent: {
    created_at: string;
    respondent_id: string;
    answers_labeled: Record<string, unknown>;
  } | null;
  teacher: {
    lessonCode: string;
    conductingTeachers: string;
    subjects: string;
    submittedAt: string | null;
    methodologicalScore: number | null;
    /** Все баллы по строкам чек-листа с тем же шифром (после сведения на сервере). */
    methodologicalScores?: number[];
    generalThoughts: string;
    observerName: string;
    rubricOrganizational?: string;
    rubricGoalSetting?: string;
    rubricTechnologies?: string;
    rubricInformation?: string;
    rubricGeneralContent?: string;
    rubricCultural?: string;
    rubricReflection?: string;
  } | null;
}

export interface PhenomenalLessonsMergePayload {
  survey: { id: number; title: string };
  /** Откуда взяты строки родителей: опрос в системе или второй Excel */
  parent_source?: 'survey' | 'excel';
  confidence_threshold: number;
  warnings: string[];
  llm_provider: string | null;
  stats: {
    parent_rows: number;
    teacher_rows: number;
    merged_high_confidence: number;
    uncertain_or_no_match: number;
  };
  merged: PhenomenalMergeRow[];
  uncertain: PhenomenalMergeRow[];
  unmatched_parent_indices: number[];
  unmatched_teacher_indices: number[];
}

/** Тип сущности для псевдонимизации перед отправкой в LLM (префикс токена на сервере). */
export type PedagogicalPiiEntityType = 'teacher' | 'phone' | 'address' | 'class' | 'child' | 'other';

export interface PedagogicalPiiEntityDraft {
  type: PedagogicalPiiEntityType;
  value: string;
}

/** Последний ответ LLM по сессии (replyRedacted — как от модели; replyPlain — после подстановки на сервере). */
export interface PedagogicalLlmLast {
  at: string;
  provider: string;
  replyRedacted: string;
  replyPlain: string;
}

/** Мета авто-псевдонимизации последнего прогона. */
export interface PedagogicalPiiAutoMeta {
  at: string;
  entityCount: number;
  autoDetectedCount: number;
}

/** Сегмент педагогической аналитики (один педагог / пара педагог+предмет). */
export interface PedagogicalSegmentState {
  id: string;
  teacher: string;
  subject?: string | null;
  /** Текст от ИИ (после обработки). */
  narrative?: string;
  /** Ответ модели с токенами (для сводки сессии). */
  narrativeRedacted?: string;
  /** Статус генерации. */
  genStatus?: 'pending' | 'running' | 'done' | 'failed';
  /** Сообщение при genStatus === 'failed'. */
  genError?: string;
  /** Согласование методистом. */
  reviewStatus?: 'pending' | 'approved' | 'skipped';
  /** Строки-опоры из сводки (кратко). */
  sourceSnippet?: string;
}

/** Состояние сессии «Педагогическая аналитика» (хранится в JSON на сервере). */
export interface PedagogicalAnalyticsState {
  v: 1;
  step: 'draft' | 'generating' | 'review' | 'report' | 'sent';
  job: {
    status: 'idle' | 'running' | 'done' | 'failed';
    done: number;
    total: number;
    error?: string | null;
  };
  segments: PedagogicalSegmentState[];
  notification: {
    emailEnabled: boolean;
    maxWebhookUrl: string;
    consent: boolean;
    lastNotifiedAt?: string;
  };
  excelProjectId?: number | null;
  /**
   * Если задано (например после загрузки .xlsx), авто-ПДн на сервере собирается по каждому элементу отдельно, затем объединяется.
   * Редактирование текста вручную в поле фактов сбрасывает этот режим (см. клиент).
   */
  sourceBlocks?: string[] | null;
  /** token → исходное значение; в промпт LLM не передаётся. */
  piiMap: Record<string, string>;
  /** Текст для ИИ после замены ПДн на токены. */
  redactedSource: string;
  /** Черновик исходного текста с ПДн. */
  sourcePlain: string;
  piiEntitiesDraft: PedagogicalPiiEntityDraft[];
  llmLast: PedagogicalLlmLast | null;
  piiAuto: PedagogicalPiiAutoMeta | null;
}

export interface PedagogicalSessionListItem {
  id: number;
  title: string;
  step: string | null;
  updated_at: string;
}

export interface PedagogicalSessionPayload {
  id: number;
  title: string;
  state: PedagogicalAnalyticsState;
  created_at: string;
  updated_at: string;
}

/** Автономная фотостена (не опрос) */
export type PhotoWallModerationStatus = 'pending' | 'approved' | 'rejected';

export interface PhotoWallPhotoRow {
  id: number;
  respondent_id: string;
  created_at: string;
  moderation_status: PhotoWallModerationStatus;
  /** Превью для списка модерации (лёгкий JPEG data URL) */
  preview_data: string;
  /** Старые записи без thumb — подгружаем полное фото отдельным запросом */
  needs_full_image: boolean;
}

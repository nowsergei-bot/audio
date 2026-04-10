/**
 * Целевая структура отчёта по образцу «феноменальная неделя» (лист «Отзывы» в Excel).
 * Используется для согласования парсера, API и выгрузки.
 */
export interface PhenomenalLessonHeader {
  /** Класс / группа, например 1AB, 3АС */
  gradeGroup: string;
  /** Учитель 1 (часто классный / хозяин урока) */
  teacherPrimary: string;
  departmentPrimary: string;
  /** Учитель 2 (часто ведущий предметный блок / гость) */
  teacherSecondary: string;
  departmentSecondary: string;
  lessonTopic: string;
  /** Средняя или агрегированная оценка методического уровня (как в эталоне: 9.6, 8.5…) */
  methodologicalLevelScore: number | null;
}

export interface PhenomenalParentReview {
  index: number;
  text: string;
}

export interface PhenomenalLessonBlock {
  header: PhenomenalLessonHeader;
  parentReviews: PhenomenalParentReview[];
  /** Уверенность сопоставления двух источников (0–1), заполняется пайплайном */
  matchConfidence?: number;
  matchNotes?: string;
}

export interface PhenomenalThanksSheet {
  /** Лист «благодарности» — список ФИО колонками */
  names: string[][];
}

export interface PhenomenalWeekReport {
  title: string;
  periodLabel?: string;
  lessons: PhenomenalLessonBlock[];
  thanks?: PhenomenalThanksSheet;
  generatedAt?: string;
}

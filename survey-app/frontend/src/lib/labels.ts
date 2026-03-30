import type { QuestionType, SurveyStatus } from '../types';

/** Подписи типов вопросов для интерфейса (без технических имён вроде scale). */
export const QUESTION_TYPE_LABEL_RU: Record<QuestionType, string> = {
  radio: 'Один вариант',
  checkbox: 'Несколько вариантов',
  scale: 'Числовая шкала',
  rating: 'Оценка по звёздам',
  text: 'Свободный ответ',
  date: 'Дата',
};

export function questionTypeLabelRu(type: string): string {
  return QUESTION_TYPE_LABEL_RU[type as QuestionType] ?? 'Вопрос';
}

export const SURVEY_STATUS_LABEL_RU: Record<SurveyStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  closed: 'Закрыт',
};

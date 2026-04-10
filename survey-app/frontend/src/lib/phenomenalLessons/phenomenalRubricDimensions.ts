import type { PhenomenalCompetencyKey } from './competencyScores';

/** Полные формулировки критериев рубрики (как в методичке / анкете гимназии). */
export interface PhenomenalRubricDimension {
  key: PhenomenalCompetencyKey;
  /** Короткий заголовок в интерфейсе */
  titleRu: string;
  /** Полный текст критерия (RU + EN по исходной анкете) */
  description: string;
}

export const PHENOMENAL_RUBRIC_DIMENSIONS: PhenomenalRubricDimension[] = [
  {
    key: 'rubricOrganizational',
    titleRu: 'Организационно-технические условия',
    description:
      'Организационно-технические условия проведения урока: учитель готов к уроку (имеется план урока; аудитория проветрена; образовательное пространство соответствует теме урока; подготовлены наглядные и дополнительные дидактические материалы, ТСО). ' +
      'Оценка организации образовательного пространства по чек-листу.',
  },
  {
    key: 'rubricGoalSetting',
    titleRu: 'Целеполагание урока',
    description:
      'Lesson goal-setting / Целеполагание урока: цели и структура урока, логика этапов, соответствие целей содержанию и результатам.',
  },
  {
    key: 'rubricTechnologies',
    titleRu: 'Педагогические / образовательные технологии',
    description:
      'Pedagogical / educational technologies used in the lesson (experimental activities, problem-based learning, group work, pair work, research work, project activities, game activities, case method, debates, museum pedagogy, workshop technology, etc.). ' +
      'Педагогические/образовательные технологии (экспериментальная деятельность, проблемное обучение, групповая и парная работа, исследовательская работа, проектная и игровая деятельность, кейс-метод, дебаты, музейная педагогика, технология мастерских и пр.), использованные на уроке.',
  },
  {
    key: 'rubricInformation',
    titleRu: 'Информационное обеспечение урока',
    description:
      'Source of information / Информационное обеспечение урока: источники и работа с информацией, ИКТ-аспекты в рамках темы.',
  },
  {
    key: 'rubricGeneralContent',
    titleRu: 'Общее содержание (феномен «Космос»)',
    description:
      'General content (uncovering the phenomenon of «Space»): the topic of the lesson, logic, lesson structure, variability of types of educational activities and learning tasks, the quality of educational content, soft skills, interdisciplinary connections. ' +
      'Общее содержание (раскрытие феномена «Космос»): тема урока, логика и структура урока, вариативность видов учебной деятельности и учебных заданий, качество образовательного контента, soft skills, межпредметные связи.',
  },
  {
    key: 'rubricCultural',
    titleRu: 'Общекультурные компетенции педагога',
    description:
      'The general cultural competencies of the teacher: literate speech, absence of factual errors in the subject, psychological atmosphere, correspondence of the teacher’s image to the code of the Gymnasium teacher, ICT competencies. ' +
      'Общекультурные компетенции педагога: грамотная речь, отсутствие фактологических ошибок по предмету, психологическая атмосфера на уроке, соответствие образа преподавателя кодексу педагогического работника Гимназии, ИКТ-компетенции.',
  },
  {
    key: 'rubricReflection',
    titleRu: 'Рефлексия',
    description: 'Reflection / Рефлексия: осмысление урока участниками, обратная связь, итоги.',
  },
];

export function rubricDimensionByKey(key: PhenomenalCompetencyKey): PhenomenalRubricDimension | undefined {
  return PHENOMENAL_RUBRIC_DIMENSIONS.find((d) => d.key === key);
}

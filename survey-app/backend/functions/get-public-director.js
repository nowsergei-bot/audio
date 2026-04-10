const { json, parseQuery, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchResultsSnapshot } = require('./get-results');
const { runAiInsights } = require('./post-ai-insights');
const {
  resolveDirectorLessonSplit,
  buildLessonGroups,
  findResponseIdsForLessonKey,
} = require('./lib/director-lesson-groups');

async function resolveSurveyIdByDirectorToken(pool, token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length > 80) return null;
  const r = await pool.query(
    `SELECT id FROM surveys WHERE director_token = $1 AND status IN ('published', 'closed') LIMIT 1`,
    [raw],
  );
  return r.rows[0]?.id ?? null;
}

async function handleGetPublicDirectorResults(pool, token, event) {
  const surveyId = await resolveSurveyIdByDirectorToken(pool, token);
  if (!surveyId) return json(404, { error: 'Not found' });

  const q = parseQuery(event || {});
  const lessonKeyRaw = q.lesson_key ? String(q.lesson_key).trim() : '';
  let responseIds = null;

  if (lessonKeyRaw) {
    const survey = await loadSurveyWithQuestions(pool, surveyId);
    if (!survey) return json(404, { error: 'Not found' });
    const split = resolveDirectorLessonSplit(survey.questions, survey.media);
    const ids = await findResponseIdsForLessonKey(pool, surveyId, split, lessonKeyRaw);
    if (!ids || !ids.length) {
      return json(404, {
        error: 'lesson_not_found',
        message: 'Урок не найден или нет ответов с нужными полями (шифр, при необходимости класс и педагог).',
      });
    }
    responseIds = new Set(ids);
  }

  const snap = await fetchResultsSnapshot(pool, surveyId, { forPublicApi: false, responseIds });
  if (!snap) return json(404, { error: 'Not found' });

  return json(200, {
    survey: {
      id: snap.survey.id,
      title: snap.survey.title,
      status: snap.survey.status,
    },
    total_responses: snap.total_responses,
    questions: snap.questions,
    charts: snap.charts,
    text_word_cloud: snap.text_word_cloud,
    lesson_key: lessonKeyRaw || undefined,
    lesson_filter_active: Boolean(lessonKeyRaw),
  });
}

async function handleGetPublicDirectorLessonGroups(pool, token) {
  const surveyId = await resolveSurveyIdByDirectorToken(pool, token);
  if (!surveyId) return json(404, { error: 'Not found' });

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });

  const split = resolveDirectorLessonSplit(survey.questions, survey.media);
  const groups = await buildLessonGroups(pool, surveyId, split);

  let hint;
  if (split.mode === 'entire_survey') {
    hint =
      'В форме не найден вопрос со шифром или кодом урока — показана одна общая группа по всем ответам. Для разбивки по урокам добавьте поле шифра или укажите id вопросов в surveys.media.directorLessonSplit.';
  } else if (split.mode !== 'triple') {
    hint =
      'Группировка по шифру урока; при совпадении шифра в разных классах или у разных педагогов уточните форму (класс и педагог) или задайте все три id в directorLessonSplit для максимально точного сопоставления.';
  }

  return json(200, {
    survey: { id: survey.id, title: survey.title, status: survey.status },
    lesson_split: {
      source: split.source,
      mode: split.mode,
      teacher_question_id: split.teacherQuestionId,
      class_question_id: split.classQuestionId,
      lesson_code_question_id: split.lessonCodeQuestionId,
    },
    groups,
    ...(hint ? { hint } : {}),
  });
}

async function handlePostPublicDirectorAiInsights(pool, token, event) {
  const surveyId = await resolveSurveyIdByDirectorToken(pool, token);
  if (!surveyId) return json(404, { error: 'Not found' });
  const body = parseBody(event) || {};
  const lk = body.lesson_key != null ? String(body.lesson_key).trim() : '';
  if (!lk) {
    return runAiInsights(pool, surveyId, event);
  }
  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });
  const split = resolveDirectorLessonSplit(survey.questions, survey.media);
  const ids = await findResponseIdsForLessonKey(pool, surveyId, split, lk);
  if (!ids || !ids.length) {
    return json(404, { error: 'lesson_not_found', message: 'Урок не найден.' });
  }
  return runAiInsights(pool, surveyId, event, { presetResponseIds: new Set(ids) });
}

module.exports = {
  handleGetPublicDirectorResults,
  handleGetPublicDirectorLessonGroups,
  handlePostPublicDirectorAiInsights,
  resolveSurveyIdByDirectorToken,
};

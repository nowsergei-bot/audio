const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { resolveDirectorLessonSplit } = require('./lib/director-lesson-groups');
const { buildParentCommentSnippetsByBlock } = require('./lib/phenomenal-parent-sync');

/**
 * POST { survey_id, blocks: [{ id, lessonCode?, conductingTeachers?, parentClassLabel? }] }
 * → { parent_pulse_comments, pulse_ready?, pulse_hint? }
 * Для редактора отчёта: те же SQL-фрагменты, что у публичной страницы руководителя.
 */
async function handlePostPhenomenalPreviewPulseComments(pool, event, canAccessSurvey) {
  const body = parseBody(event) || {};
  const surveyId = Number(body.survey_id ?? body.surveyId);
  if (!Number.isFinite(surveyId) || surveyId < 1) {
    return json(400, { error: 'survey_id required' });
  }

  const ok = await canAccessSurvey(surveyId);
  if (ok === null) return json(404, { error: 'Not found' });
  if (!ok) return json(403, { error: 'Forbidden' });

  const blocksRaw = body.blocks;
  if (!Array.isArray(blocksRaw) || blocksRaw.length === 0) {
    return json(400, { error: 'blocks: непустой массив' });
  }

  const blocks = blocksRaw
    .map((b) => ({
      id: String(b?.id ?? '').trim(),
      lessonCode: b?.lessonCode != null ? String(b.lessonCode) : '',
      conductingTeachers: b?.conductingTeachers != null ? String(b.conductingTeachers) : '',
      parentClassLabel: b?.parentClassLabel != null ? String(b.parentClassLabel) : '',
    }))
    .filter((b) => b.id);

  if (!blocks.length) {
    return json(400, { error: 'У каждого блока нужен id' });
  }

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Опрос не найден' });
  if (survey.status !== 'published' && survey.status !== 'closed') {
    return json(400, { error: 'Опрос должен быть опубликован или закрыт' });
  }

  const split = resolveDirectorLessonSplit(survey.questions, survey.media);
  if (split.mode === 'entire_survey') {
    return json(200, {
      parent_pulse_comments: {},
      pulse_ready: false,
      pulse_hint:
        'В опросе не найден вопрос со шифром или кодом урока — комментарии с Пульса к блокам отчёта не сопоставляются. Добавьте поле шифра или задайте lesson_code_question_id в surveys.media.directorLessonSplit.',
    });
  }

  try {
    const parent_pulse_comments = await buildParentCommentSnippetsByBlock(pool, surveyId, split, blocks);
    return json(200, { parent_pulse_comments, pulse_ready: true });
  } catch (e) {
    console.error('[phenomenal preview pulse]', e);
    return json(200, {
      parent_pulse_comments: {},
      pulse_ready: false,
      pulse_hint: 'Не удалось загрузить комментарии (БД или опрос).',
    });
  }
}

module.exports = { handlePostPhenomenalPreviewPulseComments };

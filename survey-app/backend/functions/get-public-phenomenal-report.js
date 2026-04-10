const { json } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { resolveDirectorLessonSplit } = require('./lib/director-lesson-groups');
const { buildParentCommentSnippetsByBlock } = require('./lib/phenomenal-parent-sync');

function publicBlockShape(b) {
  if (!b || typeof b !== 'object') return b;
  const {
    id,
    lessonCode,
    conductingTeachers,
    subjects,
    methodologicalScore,
    teacherNotes,
    parentClassLabel,
    reviews,
    rubricOrganizational,
    rubricGoalSetting,
    rubricTechnologies,
    rubricInformation,
    rubricGeneralContent,
    rubricCultural,
    rubricReflection,
  } = b;
  return {
    id,
    lessonCode: lessonCode ?? '',
    conductingTeachers: conductingTeachers ?? '',
    subjects: subjects ?? '',
    methodologicalScore: methodologicalScore ?? '',
    teacherNotes: teacherNotes ?? '',
    parentClassLabel: parentClassLabel ?? '',
    rubricOrganizational: rubricOrganizational ?? '',
    rubricGoalSetting: rubricGoalSetting ?? '',
    rubricTechnologies: rubricTechnologies ?? '',
    rubricInformation: rubricInformation ?? '',
    rubricGeneralContent: rubricGeneralContent ?? '',
    rubricCultural: rubricCultural ?? '',
    rubricReflection: rubricReflection ?? '',
    reviews: Array.isArray(reviews)
      ? reviews.map((r) => ({
          id: r.id,
          text: r.text,
          fromMergedParent: r.fromMergedParent,
          fromPulse: r.fromPulse,
          respondentName: r.respondentName,
          overallRating: r.overallRating,
          comments: r.comments,
        }))
      : [],
  };
}

async function handleGetPublicPhenomenalReport(pool, tokenRaw) {
  const token = String(tokenRaw || '').trim();
  if (!token || token.length > 80) return json(404, { error: 'Not found' });

  const r = await pool.query(
    `SELECT id, title, survey_id, state_json
     FROM phenomenal_report_projects
     WHERE director_share_token = $1
     LIMIT 1`,
    [token],
  );
  if (!r.rows.length) return json(404, { error: 'Not found' });

  const row = r.rows[0];
  const rawState = row.state_json && typeof row.state_json === 'object' ? row.state_json : {};
  const draft = rawState.draft && typeof rawState.draft === 'object' ? rawState.draft : rawState;
  const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];

  const title = String(row.title || draft.title || 'Отчёт по феноменальным урокам').trim();
  const periodLabel = String(draft.periodLabel || '').trim();

  const surveyId = row.survey_id != null ? Number(row.survey_id) : null;
  /** @type {Record<string, { question: string; text: string }[]>} */
  let parent_pulse_comments = {};

  if (surveyId && Number.isFinite(surveyId)) {
    const survey = await loadSurveyWithQuestions(pool, surveyId);
    if (survey && (survey.status === 'published' || survey.status === 'closed')) {
      const split = resolveDirectorLessonSplit(survey.questions, survey.media);
      if (split.mode !== 'entire_survey') {
        try {
          parent_pulse_comments = await buildParentCommentSnippetsByBlock(pool, surveyId, split, blocks);
        } catch (e) {
          console.error('[phenomenal public] parent sync', e);
          parent_pulse_comments = {};
        }
      }
    }
  }

  return json(200, {
    title,
    period_label: periodLabel,
    survey_linked: Boolean(surveyId && Number.isFinite(surveyId)),
    blocks: blocks.map(publicBlockShape),
    parent_pulse_comments,
  });
}

module.exports = { handleGetPublicPhenomenalReport };

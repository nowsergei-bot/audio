import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDirectorSurveyResults } from '../api/client';
import AnimatedNumber from '../components/AnimatedNumber';
import CommentsWordCloud from '../components/CommentsWordCloud';
import InsightsPanel from '../components/InsightsPanel';
import ResultQuestionCard from '../components/ResultQuestionCard';
import { fadeIn, staggerContainer } from '../motion/resultsMotion';
import type { ResultsPayload } from '../types';

export default function SurveyDirectorPage() {
  const { directorToken: rawToken } = useParams();
  const directorToken = rawToken ? decodeURIComponent(rawToken) : '';
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!directorToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getDirectorSurveyResults(directorToken);
      setData(r);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [directorToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const drillToQuestion = useCallback((questionId: number) => {
    const el = document.getElementById(`question-${questionId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.classList.add('results-q-card--flash');
    window.setTimeout(() => el?.classList.remove('results-q-card--flash'), 1400);
  }, []);

  const hasTextCloud = Boolean(data?.text_word_cloud?.words?.length);

  const questionCount = data?.questions?.length ?? 0;

  const narrativeLead = useMemo(() => {
    if (!data) return null;
    return (
      <div className="director-survey-meta" aria-label="Сводные цифры">
        <div className="director-survey-meta-item">
          <span className="director-survey-meta-value">
            <AnimatedNumber value={data.total_responses} />
          </span>
          <span className="director-survey-meta-label">отправленных анкет</span>
        </div>
        <div className="director-survey-meta-item">
          <span className="director-survey-meta-value">
            <AnimatedNumber value={questionCount} />
          </span>
          <span className="director-survey-meta-label">вопросов в опросе</span>
        </div>
      </div>
    );
  }, [data, questionCount]);

  if (!directorToken) {
    return (
      <div className="page director-survey-page director-survey-page--narrow">
        <p className="err">Некорректная ссылка</p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-admin director-survey-page">
        <motion.div className="page director-survey-inner" {...fadeIn}>
          <header className="director-survey-hero">
            {loading && <p className="muted director-survey-loading">Загрузка…</p>}
            {err && <p className="err">{err}</p>}
            {data && (
              <>
                <p className="director-survey-kicker">Результаты опроса</p>
                <h1 className="director-survey-title">{data.survey.title || 'Без названия'}</h1>
                {narrativeLead}
              </>
            )}
          </header>

          {data && hasTextCloud && (
            <section className="director-survey-cloud" aria-label="Облако тем">
              <h2 className="director-survey-section-title">Темы в свободных ответах</h2>
              <CommentsWordCloud
                words={data.text_word_cloud!.words}
                onSelectWord={() => {
                  /* без перехода на другие страницы */
                }}
              />
            </section>
          )}

          <motion.div
            className="director-survey-questions"
            variants={staggerContainer}
            initial="hidden"
            animate={data && !loading ? 'show' : 'hidden'}
          >
            {data?.questions.map((q, i) => (
              <ResultQuestionCard key={q.question_id} q={q} index={i} />
            ))}
          </motion.div>

          {data && data.questions.length > 0 && (
            <div className="director-survey-insights-tail">
              <InsightsPanel
                surveyId={data.survey.id}
                directorToken={directorToken}
                autoRun
                onDrillDown={drillToQuestion}
              />
            </div>
          )}
        </motion.div>
      </div>
    </MotionConfig>
  );
}

import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDirectorSurveyResults } from '../api/client';
import AnimatedNumber from './AnimatedNumber';
import CommentsWordCloud from './CommentsWordCloud';
import InsightsPanel from './InsightsPanel';
import ResultQuestionCard from './ResultQuestionCard';
import ResultsChartsGrid from './ResultsChartsGrid';
import TextAnswersExplorerModal from './TextAnswersExplorerModal';
import { fadeIn, staggerContainer } from '../motion/resultsMotion';
import type { ResultsPayload, TextAnswersPage } from '../types';

export function directorLoadErrorHint(message: string): string {
  const m = (message || '').trim();
  if (/not\s*found|lesson_not_found/i.test(m)) {
    return (
      'Сводка недоступна: неверная или устаревшая ссылка, либо опрос не в статусе «Опубликован» / «Закрыт», либо урок не найден. ' +
      'Скопируйте ссылку заново у методиста.'
    );
  }
  if (/lesson_groups_unavailable/i.test(m)) {
    return (
      'Для этого опроса не настроена группировка по урокам (нужны вопросы про учителя, класс и шифр урока). ' +
      'Используйте общую сводку для руководителя или попросите методиста проверить формулировки вопросов.'
    );
  }
  return m || 'Не удалось загрузить данные';
}

type Props = {
  directorToken: string;
  /** Срез только по ответам, относящимся к одному уроку */
  lessonKey?: string;
  /** Под общей сводкой — ссылка на список уроков */
  showLessonsHubLink?: boolean;
};

export default function DirectorResultsView({ directorToken, lessonKey, showLessonsHubLink }: Props) {
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [textModalQuestionId, setTextModalQuestionId] = useState<number | undefined>();

  const load = useCallback(async () => {
    if (!directorToken) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getDirectorSurveyResults(directorToken, {
        lessonKey: lessonKey && lessonKey.trim() ? lessonKey.trim() : undefined,
      });
      setData(r);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [directorToken, lessonKey]);

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

  const directorTextFetch = useCallback(
    async (params: {
      question_id?: number;
      q?: string;
      offset: number;
      limit?: number;
    }): Promise<TextAnswersPage> => {
      const qs = data?.questions ?? [];
      const lim = params.limit ?? 50;
      const needle = params.q?.trim().toLowerCase();
      const rowsAccum: { question_id: number; text: string }[] = [];

      const pushSamples = (qq: (typeof qs)[0]) => {
        if (qq.type !== 'text' || !qq.samples?.length) return;
        for (const t of qq.samples) {
          if (t == null || String(t).trim() === '') continue;
          const s = String(t);
          if (needle && !s.toLowerCase().includes(needle)) continue;
          rowsAccum.push({ question_id: qq.question_id, text: s });
        }
      };

      if (params.question_id != null) {
        const qq = qs.find((x) => x.question_id === params.question_id);
        if (qq) pushSamples(qq);
      } else {
        for (const qq of qs) pushSamples(qq);
      }

      const offset = params.offset;
      const slice = rowsAccum.slice(offset, offset + lim);
      return {
        total: rowsAccum.length,
        rows: slice.map((r, i) => ({
          question_id: r.question_id,
          text: r.text,
          submitted_at: `r${offset + i}`,
        })),
      };
    },
    [data],
  );

  const textModalTitle = useMemo(() => {
    if (textModalQuestionId == null || !data) return 'Текстовые ответы';
    const q = data.questions.find((x) => x.question_id === textModalQuestionId);
    const t = (q?.text || '').trim();
    if (!t) return 'Текстовые ответы';
    const short = t.length > 72 ? `${t.slice(0, 69)}…` : t;
    return `Ответы: ${short}`;
  }, [data, textModalQuestionId]);

  const narrativeLead = useMemo(() => {
    if (!data) return null;
    return (
      <div className="director-survey-meta" aria-label="Сводные цифры">
        <div className="director-survey-meta-item">
          <span className="director-survey-meta-value">
            <AnimatedNumber value={data.total_responses} />
          </span>
          <span className="director-survey-meta-label">
            {data.lesson_filter_active ? 'анкет по этому уроку' : 'отправленных анкет'}
          </span>
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

  const lessonsPath = `/director/${encodeURIComponent(directorToken)}/lessons`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-admin director-survey-page">
        <motion.div className="page director-survey-inner" {...fadeIn}>
          <header className="director-survey-hero">
            {loading && <p className="muted director-survey-loading">Загрузка…</p>}
            {err && <p className="err">{directorLoadErrorHint(err)}</p>}
            {data && (
              <>
                {lessonKey ? (
                  <p className="director-survey-kicker">Сводка по одному уроку</p>
                ) : (
                  <p className="director-survey-kicker">Результаты опроса</p>
                )}
                <h1 className="director-survey-title">{data.survey.title || 'Без названия'}</h1>
                {lessonKey ? (
                  <p className="muted" style={{ marginTop: '0.35rem' }}>
                    <Link to={lessonsPath} className="phenomenal-report-back-link">
                      ← К списку уроков
                    </Link>
                  </p>
                ) : null}
                {showLessonsHubLink && !lessonKey ? (
                  <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.92rem' }}>
                    <Link to={lessonsPath}>Сводка по каждому уроку отдельно (для опросов родителей)</Link>
                  </p>
                ) : null}
                {narrativeLead}
              </>
            )}
          </header>

          {data && hasTextCloud && (
            <section className="director-survey-cloud" aria-label="Облако тем">
              <h2 className="director-survey-section-title">Темы в свободных ответах</h2>
              <CommentsWordCloud
                words={data.text_word_cloud!.words}
                onSelectWord={() => {}}
                interactive={false}
              />
            </section>
          )}

          {data && data.charts && data.total_responses > 0 && (
            <section className="director-survey-charts director-survey-charts--embed" aria-label="Динамика и графики">
              <h2 className="director-survey-section-title">Диаграммы по выборке</h2>
              <ResultsChartsGrid charts={data.charts} onDrillDown={drillToQuestion} compact forceTwoColumn />
            </section>
          )}

          <motion.div
            className="director-survey-questions"
            variants={staggerContainer}
            initial="hidden"
            animate={data && !loading ? 'show' : 'hidden'}
          >
            {data?.questions.map((q, i) => (
              <ResultQuestionCard
                key={q.question_id}
                q={q}
                index={i}
                tapTextBlockOpensAnswers={q.type === 'text'}
                onOpenTextAnswers={
                  q.type === 'text'
                    ? ({ question_id }) => {
                        setTextModalQuestionId(question_id);
                        setTextModalOpen(true);
                      }
                    : undefined
                }
              />
            ))}
          </motion.div>

          {data && data.questions.length > 0 && (
            <div className="director-survey-insights-tail">
              <InsightsPanel
                surveyId={data.survey.id}
                directorToken={directorToken}
                directorLessonKey={lessonKey && lessonKey.trim() ? lessonKey.trim() : undefined}
                autoRun
                onDrillDown={drillToQuestion}
              />
            </div>
          )}
        </motion.div>
        <TextAnswersExplorerModal
          open={textModalOpen}
          onClose={() => setTextModalOpen(false)}
          title={textModalTitle}
          textFetch={directorTextFetch}
          initialQuestionId={textModalQuestionId}
        />
      </div>
    </MotionConfig>
  );
}

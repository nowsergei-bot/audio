import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getResults, getSurveyExportRows, getSurveyTextAnswers, publicFormUrl } from '../api/client';
import { downloadSurveyResponsesXlsx } from '../lib/exportResponsesXlsx';
import AnimatedNumber from '../components/AnimatedNumber';
import CommentsWordCloud from '../components/CommentsWordCloud';
import ResultQuestionCard from '../components/ResultQuestionCard';
import InsightsPanel from '../components/InsightsPanel';
import TextAnswersExplorerModal from '../components/TextAnswersExplorerModal';
import TextQuestionInsightModal from '../components/TextQuestionInsightModal';
import ResultsChartsGrid from '../components/ResultsChartsGrid';
import { fadeIn, staggerContainer } from '../motion/resultsMotion';
import { SURVEY_STATUS_LABEL_RU } from '../lib/labels';
import type { ResultsPayload, SurveyStatus } from '../types';

export default function SurveyResults() {
  const { id } = useParams();
  const surveyId = Number(id);
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [textModal, setTextModal] = useState<{ open: boolean; question_id?: number; q?: string }>({ open: false });
  const [textInsightModal, setTextInsightModal] = useState<{ open: boolean; question_id: number | null }>({
    open: false,
    question_id: null,
  });
  const [exporting, setExporting] = useState(false);

  const textQuestionOptions = useMemo(() => {
    if (!data?.questions) return [];
    return data.questions
      .filter((q) => q.type === 'text')
      .map((q) => ({
        id: q.question_id,
        label:
          (q.text || 'Без названия').length > 88
            ? `${(q.text || '').slice(0, 85)}…`
            : q.text || 'Без названия',
      }));
  }, [data?.questions]);

  const hasTextResponses = Boolean(
    data?.questions?.some(
      (q) => q.type === 'text' && ((q.samples_total ?? 0) > 0 || (q.response_count ?? 0) > 0),
    )
  );

  const load = useCallback(async () => {
    if (!Number.isFinite(surveyId)) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getResults(surveyId);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    setData(null);
    setTextModal({ open: false });
    void load();
  }, [surveyId, load]);

  const drillToQuestion = useCallback((questionId: number) => {
    const el = document.getElementById(`question-${questionId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.classList.add('results-q-card--flash');
    window.setTimeout(() => el?.classList.remove('results-q-card--flash'), 1400);
  }, []);

  const fetchTextPage = useCallback(
    (p: Parameters<typeof getSurveyTextAnswers>[1]) => getSurveyTextAnswers(surveyId, p),
    [surveyId]
  );

  const exportExcel = useCallback(async () => {
    if (!Number.isFinite(surveyId)) return;
    setExporting(true);
    setErr(null);
    try {
      const rowsPayload = await getSurveyExportRows(surveyId);
      const rawTitle = data?.survey.title || `opros-${surveyId}`;
      const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
      downloadSurveyResponsesXlsx(rowsPayload, `${safeTitle}-otvety.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось выгрузить Excel');
    } finally {
      setExporting(false);
    }
  }, [surveyId, data?.survey.title]);

  if (!Number.isFinite(surveyId)) {
    return (
      <div className="page">
        <p className="err">Некорректный номер опроса</p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page results-page" {...fadeIn}>
        <motion.header
          className="card results-hero results-hero--no-aside glass-surface"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="results-hero-main">
            <p className="results-hero-kicker">Пульс · сводка по опросу</p>
            <h1 className="results-hero-title">Результаты</h1>
            {data && (
              <>
                <motion.div
                  className="results-hero-title-row"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12, duration: 0.35 }}
                >
                  <span className="results-survey-name">{data.survey.title || 'Без названия'}</span>
                  <span className={`badge ${data.survey.status}`}>
                    {SURVEY_STATUS_LABEL_RU[data.survey.status as SurveyStatus]}
                  </span>
                </motion.div>
                <p className="results-hero-links muted">
                  Публичная форма:{' '}
                  <a href={publicFormUrl(data.survey.access_link ?? '')} target="_blank" rel="noreferrer">
                    открыть в новой вкладке
                  </a>
                </p>
              </>
            )}
            {loading && (
              <div className="results-loading-line" aria-hidden>
                <motion.div
                  className="results-loading-bar"
                  animate={{ x: ['-40%', '140%'] }}
                  transition={{ repeat: Infinity, duration: 1.15, ease: 'easeInOut' }}
                />
              </div>
            )}
            {err && <p className="err">{err}</p>}
          </div>
          {data && (
            <motion.div
              className="results-hero-actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link to={`/surveys/${surveyId}/analytics`} className="btn primary">
                  Перейти к аналитике по выборке
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link to={`/surveys/${surveyId}/edit`} className="btn">
                  Редактировать опрос
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={exporting}
                  onClick={() => void exportExcel()}
                >
                  {exporting ? 'Выгрузка…' : 'Скачать ответы (Excel)'}
                </button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link to="/" className="btn">
                  К списку опросов
                </Link>
              </motion.div>
            </motion.div>
          )}
        </motion.header>

        {data && data.questions.length === 0 && (
          <motion.div
            className="card results-empty-survey glass-surface"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="muted">В опросе пока нет вопросов.</p>
          </motion.div>
        )}

        <motion.div
          className="results-questions-stack"
          variants={staggerContainer}
          initial="hidden"
          animate={data && !loading ? 'show' : 'hidden'}
        >
          {data?.questions.map((q, i) => (
            <ResultQuestionCard
              key={q.question_id}
              q={q}
              index={i}
              onOpenTextAnswers={({ question_id }) =>
                setTextModal({ open: true, question_id, q: undefined })
              }
              onOpenTextInsight={(question_id) => setTextInsightModal({ open: true, question_id })}
            />
          ))}
        </motion.div>

        {data && (data.text_word_cloud?.words?.length || hasTextResponses) && (
          <div className="results-text-analytics-block">
            {data.text_word_cloud && data.text_word_cloud.words.length > 0 && (
              <CommentsWordCloud
                words={data.text_word_cloud.words}
                onSelectWord={(w) => setTextModal({ open: true, q: w, question_id: undefined })}
              />
            )}
            {textQuestionOptions.length > 0 && hasTextResponses && (
              <motion.div
                className="card results-text-all-btn-wrap glass-surface"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="results-text-all-btn-lead muted">Все свободные формулировки из опроса</p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setTextModal({ open: true, q: undefined, question_id: undefined })}
                >
                  Открыть полный список комментариев
                </button>
              </motion.div>
            )}
          </div>
        )}

        {data && data.questions.length > 0 && (
          <motion.section
            className="results-fill-analytics"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            aria-label="Динамика заполнения опроса"
          >
            <h2 className="results-fill-analytics-title">Динамика заполнения</h2>
            <p className="muted results-fill-analytics-lead">
              Сколько ответов собрано и когда респонденты заполняли форму (по дням и дням недели).
            </p>
            <div className="results-fill-stats-row" aria-label="Ключевые показатели">
              <motion.div
                className="results-stat-tile"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 450, damping: 18 }}
              >
                <span className="results-stat-tile-value">
                  <AnimatedNumber value={data.total_responses} />
                </span>
                <span className="results-stat-tile-label">Всего ответов</span>
              </motion.div>
              <motion.div
                className="results-stat-tile results-stat-tile-secondary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 450, damping: 18 }}
              >
                <span className="results-stat-tile-value">
                  <AnimatedNumber value={data.questions.length} />
                </span>
                <span className="results-stat-tile-label">Вопросов</span>
              </motion.div>
            </div>
            {data.charts && data.total_responses > 0 && (
              <ResultsChartsGrid
                charts={data.charts}
                onDrillDown={drillToQuestion}
                compact
              />
            )}
            {data.total_responses === 0 && (
              <p className="muted results-fill-analytics-empty">Пока нет ответов — графики появятся после первых отправок формы.</p>
            )}
          </motion.section>
        )}

        <InsightsPanel surveyId={surveyId} onDrillDown={drillToQuestion} />

        <TextAnswersExplorerModal
          open={textModal.open}
          onClose={() => setTextModal({ open: false })}
          title={
            textModal.question_id != null
              ? `Ответы: ${(() => {
                  const raw =
                    textQuestionOptions.find((o) => o.id === textModal.question_id)?.label ??
                    `вопрос ${textModal.question_id}`;
                  return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
                })()}`
              : 'Все текстовые ответы'
          }
          textFetch={fetchTextPage}
          questionOptions={textQuestionOptions}
          initialQuestionId={textModal.question_id}
          initialQ={textModal.q}
        />

        <TextQuestionInsightModal
          open={textInsightModal.open}
          onClose={() => setTextInsightModal({ open: false, question_id: null })}
          surveyId={surveyId}
          questionId={textInsightModal.question_id}
        />
      </motion.div>
    </MotionConfig>
  );
}

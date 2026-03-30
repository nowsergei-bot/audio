import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAnalyticsFacets,
  getResults,
  getSurvey,
  getSurveyTextAnswers,
  postResultsFilter,
  publicFormUrl,
} from '../api/client';
import AnalyticsAnalystChat from '../components/AnalyticsAnalystChat';
import AnimatedNumber from '../components/AnimatedNumber';
import CommentsWordCloud from '../components/CommentsWordCloud';
import ResultQuestionCard from '../components/ResultQuestionCard';
import InsightsPanel from '../components/InsightsPanel';
import TextAnswersExplorerModal from '../components/TextAnswersExplorerModal';
import TextQuestionInsightModal from '../components/TextQuestionInsightModal';
import ResultsChartsGrid from '../components/ResultsChartsGrid';
import { fadeIn, staggerContainer } from '../motion/resultsMotion';
import { questionTypeLabelRu, SURVEY_STATUS_LABEL_RU } from '../lib/labels';
import type { AnalyticsFilter, Question, ResultsPayload, SurveyStatus } from '../types';

const LS_ROWS = (id: number) => `pulse_analytics_slice_rows_${id}`;
const MAX_SLICE_ROWS = 16;

type SliceRow = { uid: string; question_id: number | null; value: string };

function newUid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function defaultRows(): SliceRow[] {
  return [{ uid: newUid(), question_id: null, value: '' }];
}

function buildFiltersFromRows(rows: SliceRow[]): AnalyticsFilter[] {
  const out: AnalyticsFilter[] = [];
  for (const row of rows) {
    if (row.question_id != null && row.value.trim()) {
      out.push({ question_id: row.question_id, value: row.value.trim() });
    }
  }
  return out;
}

function humanizeApiError(e: unknown): string {
  const raw = e instanceof Error ? e.message : 'Ошибка загрузки';
  if (raw === 'Not found') {
    return 'Опрос не найден или нет доступа. Войдите в кабинет или проверьте ссылку.';
  }
  return raw;
}

function parseRowsFromStorage(raw: string | null): SliceRow[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out: SliceRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as { question_id?: unknown; value?: unknown; uid?: unknown };
      const qid = o.question_id != null && o.question_id !== '' ? Number(o.question_id) : null;
      const value = String(o.value ?? '');
      out.push({
        uid: typeof o.uid === 'string' ? o.uid : newUid(),
        question_id: Number.isFinite(qid as number) ? (qid as number) : null,
        value,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export default function SurveyAnalytics() {
  const { id } = useParams();
  const surveyId = Number(id);
  const [survey, setSurvey] = useState<{ title: string; status: SurveyStatus; access_link: string } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [sliceRows, setSliceRows] = useState<SliceRow[]>(defaultRows);
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<AnalyticsFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** true если на сервере нет маршрутов analytics-facets / results-filter (старая Cloud Function). */
  const [legacySliceApi, setLegacySliceApi] = useState(false);
  const [textModal, setTextModal] = useState<{ open: boolean; question_id?: number; q?: string }>({ open: false });
  const [textInsightModal, setTextInsightModal] = useState<{ open: boolean; question_id: number | null }>({
    open: false,
    question_id: null,
  });

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
    ),
  );

  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [questions],
  );

  const load = useCallback(async () => {
    if (!Number.isFinite(surveyId)) return;
    setLoading(true);
    setErr(null);
    setLegacySliceApi(false);
    try {
      const s = await getSurvey(surveyId);
      setSurvey({ title: s.title, status: s.status, access_link: s.access_link });
      setQuestions(s.questions || []);
      setAppliedFilters([]);

      try {
        const [f, initial] = await Promise.all([getAnalyticsFacets(surveyId), postResultsFilter(surveyId, [])]);
        setFacets(f.facets || {});
        setData(initial);
        setLegacySliceApi(false);
      } catch {
        const initial = await getResults(surveyId);
        setFacets({});
        setData(initial);
        setLegacySliceApi(true);
      }

      try {
        const stored = parseRowsFromStorage(localStorage.getItem(LS_ROWS(surveyId)));
        setSliceRows(stored ?? defaultRows());
      } catch {
        setSliceRows(defaultRows());
      }
    } catch (e) {
      setErr(humanizeApiError(e));
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ROWS(surveyId),
        JSON.stringify(sliceRows.map((r) => ({ uid: r.uid, question_id: r.question_id, value: r.value }))),
      );
    } catch {
      /* ignore */
    }
  }, [surveyId, sliceRows]);

  const applyFilters = useCallback(async () => {
    if (!Number.isFinite(surveyId)) return;
    if (legacySliceApi) {
      setErr('Срезы по выборке требуют обновлённую версию Cloud Function в Яндекс.Облаке (маршруты analytics-facets и results-filter).');
      return;
    }
    setApplying(true);
    setErr(null);
    try {
      const f = buildFiltersFromRows(sliceRows);
      const next = await postResultsFilter(surveyId, f);
      setData(next);
      setAppliedFilters(f);
    } catch (e) {
      setErr(humanizeApiError(e));
    } finally {
      setApplying(false);
    }
  }, [surveyId, sliceRows, legacySliceApi]);

  const resetSliceVals = useCallback(() => {
    setSliceRows((rows) => rows.map((r) => ({ ...r, value: '' })));
  }, []);

  const addSliceRow = useCallback(() => {
    setSliceRows((rows) => (rows.length >= MAX_SLICE_ROWS ? rows : [...rows, { uid: newUid(), question_id: null, value: '' }]));
  }, []);

  const removeSliceRow = useCallback((uid: string) => {
    setSliceRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.uid !== uid)));
  }, []);

  const drillToQuestion = useCallback((questionId: number) => {
    const el = document.getElementById(`question-${questionId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.classList.add('results-q-card--flash');
    window.setTimeout(() => el?.classList.remove('results-q-card--flash'), 1400);
  }, []);

  const fetchTextPage = useCallback(
    (p: Parameters<typeof getSurveyTextAnswers>[1]) => getSurveyTextAnswers(surveyId, p),
    [surveyId],
  );

  if (!Number.isFinite(surveyId)) {
    return (
      <div className="page">
        <p className="err">Некорректный номер опроса</p>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page results-page analytics-slice-page" {...fadeIn}>
        <motion.header
          className="card results-hero analytics-slice-hero glass-surface"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="results-hero-main">
            <p className="results-hero-kicker">Пульс · аналитика по выборке</p>
            <h1 className="results-hero-title">Умная аналитика</h1>
            {survey && (
              <>
                <motion.div
                  className="results-hero-title-row"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12, duration: 0.35 }}
                >
                  <span className="results-survey-name">{survey.title || 'Без названия'}</span>
                  <span className={`badge ${survey.status}`}>{SURVEY_STATUS_LABEL_RU[survey.status]}</span>
                </motion.div>
                <p className="results-hero-links muted">
                  Публичная форма:{' '}
                  <a href={publicFormUrl(survey.access_link)} target="_blank" rel="noreferrer">
                    открыть
                  </a>
                  {' · '}
                  <Link to={`/surveys/${surveyId}/results`}>Все результаты без среза</Link>
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
          <motion.div
            className="results-hero-actions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link to={`/surveys/${surveyId}/results`} className="btn primary">
                К результатам опроса
              </Link>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link to={`/surveys/${surveyId}/edit`} className="btn">
                Редактировать опрос
              </Link>
            </motion.div>
          </motion.div>
        </motion.header>

        <motion.section
          className="card analytics-slice-filters glass-surface"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <h2 className="analytics-slice-filters-title">Срезы по вопросам опроса</h2>
          <p className="muted analytics-slice-filters-lead">
            Добавьте одно или несколько условий: <strong>вопрос из этого опроса</strong> и значение ответа из фактических
            данных. Условия объединяются по И — остаются только анкеты, где совпали <strong>все</strong> выбранные ответы.
            Один и тот же вопрос нельзя выбрать в двух строках (уберите дубль или ослабьте срез).
          </p>
          {legacySliceApi && (
            <div className="analytics-slice-legacy-banner" role="status">
              <strong>Сервер без новых маршрутов API.</strong> Показаны полные результаты опроса. Чтобы включить срезы и чат
              с аналитиком, обновите версию Cloud Function (залейте актуальный ZIP из каталога{' '}
              <code className="inline-code">survey-app/backend/functions</code>, см.{' '}
              <code className="inline-code">scripts/deploy-functions.sh</code>).
            </div>
          )}
          <div className="analytics-slice-grid">
            {sliceRows.map((row, ri) => {
              const takenIds = new Set(
                sliceRows
                  .filter((r) => r.uid !== row.uid && r.question_id != null)
                  .map((r) => r.question_id as number),
              );
              const qOptions = sortedQuestions.filter((q) => !takenIds.has(q.id) || row.question_id === q.id);
              return (
                <div key={row.uid} className="analytics-slice-row">
                  <span className="analytics-slice-dim-label">Условие {ri + 1}</span>
                  <select
                    className="field analytics-slice-select"
                    disabled={legacySliceApi}
                    value={row.question_id ?? ''}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      setSliceRows((rows) =>
                        rows.map((r) =>
                          r.uid === row.uid ? { ...r, question_id: Number.isFinite(v as number) ? (v as number) : null, value: '' } : r,
                        ),
                      );
                    }}
                  >
                    <option value="">— выберите вопрос —</option>
                    {qOptions.map((q) => {
                      const idx = sortedQuestions.findIndex((x) => x.id === q.id);
                      return (
                        <option key={q.id} value={q.id}>
                          #{idx >= 0 ? idx + 1 : '?'} · {questionTypeLabelRu(q.type)} · {(q.text || 'Без текста').slice(0, 56)}
                          {(q.text || '').length > 56 ? '…' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    className="field analytics-slice-select"
                    value={row.value}
                    onChange={(e) =>
                      setSliceRows((rows) => rows.map((r) => (r.uid === row.uid ? { ...r, value: e.target.value } : r)))
                    }
                    disabled={row.question_id == null || legacySliceApi}
                  >
                    <option value="">Все значения</option>
                    {(facets[String(row.question_id ?? '')] || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt.length > 90 ? `${opt.slice(0, 89)}…` : opt}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn analytics-slice-row-remove"
                    disabled={sliceRows.length <= 1 || legacySliceApi}
                    title="Удалить условие"
                    onClick={() => removeSliceRow(row.uid)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="analytics-slice-actions">
            <button
              type="button"
              className="btn"
              disabled={sliceRows.length >= MAX_SLICE_ROWS || legacySliceApi}
              onClick={addSliceRow}
            >
              Добавить условие
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={applying || loading || legacySliceApi}
              onClick={() => void applyFilters()}
            >
              {applying ? 'Считаем…' : 'Применить срез'}
            </button>
            <button type="button" className="btn" disabled={applying || legacySliceApi} onClick={resetSliceVals}>
              Сбросить значения
            </button>
          </div>
          {appliedFilters.length > 0 && (
            <p className="muted analytics-slice-active">
              Активный срез:{' '}
              {appliedFilters.map((f) => {
                const q = questions.find((x) => x.id === f.question_id);
                const qt = (q?.text || '').trim();
                const short = qt.length > 36 ? `${qt.slice(0, 35)}…` : qt || `Вопрос ${f.question_id}`;
                return (
                  <span key={`${f.question_id}-${f.value}`} className="analytics-slice-chip">
                    «{short}» = {f.value.length > 40 ? `${f.value.slice(0, 39)}…` : f.value}
                  </span>
                );
              })}
            </p>
          )}
        </motion.section>

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
              onOpenTextAnswers={({ question_id }) => setTextModal({ open: true, question_id, q: undefined })}
              onOpenTextInsight={(question_id) => setTextInsightModal({ open: true, question_id })}
            />
          ))}
        </motion.div>

        {data && (data.text_word_cloud?.words.length || hasTextResponses) && (
          <div className="results-text-analytics-block">
            {data.text_word_cloud && data.text_word_cloud.words.length > 0 && (
              <CommentsWordCloud
                words={data.text_word_cloud.words}
                onSelectWord={(w) => setTextModal({ open: true, q: w, question_id: undefined })}
              />
            )}
            <p className="muted analytics-slice-note">
              Облако слов и карточки вопросов — по текущей выборке. В отдельном окне списка текстов поиск выполняется по
              всем ответам опроса (как в разделе «Все результаты»).
            </p>
            {textQuestionOptions.length > 0 && hasTextResponses && (
              <motion.div
                className="card results-text-all-btn-wrap glass-surface"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="results-text-all-btn-lead muted">Свободные ответы в выборке</p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setTextModal({ open: true, q: undefined, question_id: undefined })}
                >
                  Открыть список комментариев
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
            aria-label="Динамика заполнения по выборке"
          >
            <h2 className="results-fill-analytics-title">Динамика в выборке</h2>
            <p className="muted results-fill-analytics-lead">
              {legacySliceApi
                ? 'Показаны все ответы опроса. После обновления API здесь можно будет строить графики по срезу.'
                : 'Графики строятся только по ответам, попавшим в текущий срез (после «Применить срез»).'}
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
                <span className="results-stat-tile-label">Ответов в выборке</span>
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
              <ResultsChartsGrid charts={data.charts} onDrillDown={drillToQuestion} compact />
            )}
            {data.total_responses === 0 && (
              <p className="muted results-fill-analytics-empty">
                В этой выборке нет ответов — ослабьте фильтры или проверьте сопоставление вопросов.
              </p>
            )}
          </motion.section>
        )}

        <InsightsPanel
          surveyId={surveyId}
          onDrillDown={drillToQuestion}
          filters={appliedFilters}
          autoRun
        />

        {!legacySliceApi ? (
          <AnalyticsAnalystChat surveyId={surveyId} filters={appliedFilters} />
        ) : (
          <section className="card analytics-analyst-chat glass-surface analytics-analyst-chat--disabled" aria-label="Чат недоступен">
            <h2 className="analytics-analyst-chat-title">Чат с аналитиком</h2>
            <p className="muted">
              Чат с аналитиком появится после обновления Cloud Function (маршрут{' '}
              <code className="inline-code">POST /api/surveys/:id/analytics-chat</code>).
            </p>
          </section>
        )}

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
              : 'Текстовые ответы (в выборке на графиках; полный список — в «Все результаты»)'
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

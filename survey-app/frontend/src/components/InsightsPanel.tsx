import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { requestAiInsights, requestDirectorAiInsights } from '../api/client';
import AnimatedNumber from './AnimatedNumber';
import { staggerContainer, staggerItem } from '../motion/resultsMotion';
import type { AiInsightsPayload, AnalyticsFilter, InsightBlock, InsightTone } from '../types';

type Props = {
  surveyId: number;
  /** Если задан — запрос идёт на публичный эндпоинт директора (без X-Api-Key). */
  directorToken?: string;
  onDrillDown?: (questionId: number) => void;
  filters?: AnalyticsFilter[];
  autoRun?: boolean;
};

const NO_SLICE_FILTERS: AnalyticsFilter[] = [];

function toneClass(tone: InsightTone): string {
  switch (tone) {
    case 'positive':
      return 'ai-insights-tone-positive';
    case 'negative':
      return 'ai-insights-tone-negative';
    case 'attention':
      return 'ai-insights-tone-attention';
    default:
      return 'ai-insights-tone-neutral';
  }
}

function KpiValue({ value }: { value: string }) {
  const t = value.trim();
  const intOnly = /^(\d+)$/.exec(t);
  if (intOnly) {
    return (
      <span className="ai-insights-kpi-value">
        <AnimatedNumber value={parseInt(intOnly[1], 10)} duration={1.1} />
      </span>
    );
  }
  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (pct) {
    const n = parseFloat(pct[1].replace(',', '.'));
    if (Number.isFinite(n)) {
      return (
        <span className="ai-insights-kpi-value">
          <AnimatedNumber value={Math.round(n * 10) / 10} duration={1.1} />
          %
        </span>
      );
    }
  }
  return <span className="ai-insights-kpi-value">{value}</span>;
}

function InsightCard({ block }: { block: InsightBlock }) {
  return (
    <motion.div
      className={`ai-insights-block ${toneClass(block.tone)}`}
      variants={staggerItem}
      whileHover={{ scale: 1.015, x: 4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
    >
      <h4 className="ai-insights-block-title">{block.title}</h4>
      <p className="ai-insights-block-body">{block.body}</p>
    </motion.div>
  );
}

function formatNarrative(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function InsightsPanel({ surveyId, directorToken, filters, autoRun = true }: Props) {
  const [loading, setLoading] = useState(autoRun);
  const [payload, setPayload] = useState<AiInsightsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const effectiveFilters = filters ?? NO_SLICE_FILTERS;
  const filterKey = JSON.stringify(effectiveFilters);

  useEffect(() => {
    setPayload(null);
    setErr(null);
    setLoading(autoRun);
  }, [surveyId, filterKey, directorToken, autoRun]);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = directorToken
        ? await requestDirectorAiInsights(directorToken)
        : await requestAiInsights(surveyId, effectiveFilters);
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [surveyId, effectiveFilters, directorToken]);

  useEffect(() => {
    if (!autoRun) return;
    void run();
  }, [surveyId, filterKey, directorToken, autoRun, run]);

  const d = payload?.dashboard;

  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        className="card ai-insights-shell"
        aria-labelledby="ai-insights-heading"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="ai-insights-header">
          <div>
            <p className="ai-insights-kicker">Пульс · показатели</p>
            <h2 id="ai-insights-heading" className="ai-insights-title">
              Умная аналитика
            </h2>
            <p className="muted ai-insights-sub">
              <strong>Как это устроено.</strong> Сервер считает показатели по ответам (включая импорт из Excel). Связный
              текст строится по заголовкам вопросов и распределению ответов (шкалы, варианты, средние) даже без
              свободных текстов; при настроенной нейросети записка усиливается моделью. Ключ не попадает в браузер. По
              текстовым вопросам на странице результатов — отдельные сводки.
            </p>
          </div>
          <div className="ai-insights-header-actions">
            <AnimatePresence mode="wait">
              {loading && (
                <motion.div
                  key="spin"
                  className="ai-insights-spinner"
                  aria-hidden
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1, rotate: 360 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{
                    opacity: { duration: 0.2 },
                    scale: { duration: 0.2 },
                    rotate: { repeat: Infinity, duration: 0.85, ease: 'linear' },
                  }}
                />
              )}
              {payload && !loading && payload.narrative?.trim() && (
                <motion.span
                  key="src"
                  className={`ai-insights-source ai-insights-source--${payload.source === 'llm_hybrid' ? 'llm_hybrid' : 'heuristic'}`}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  {payload.source === 'llm_hybrid' ? 'Текст нейросети' : 'Автотекст по вопросам'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {err && (
          <motion.p className="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {err}
          </motion.p>
        )}

        <AnimatePresence mode="wait">
          {d && (
            <motion.div
              key="dash"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <motion.div
                className="ai-insights-kpi-row"
                variants={staggerContainer}
                initial="hidden"
                animate="show"
              >
                {d.kpis.map((k) => (
                  <motion.div
                    key={k.id}
                    className="ai-insights-kpi"
                    variants={staggerItem}
                    whileHover={{ y: -4, transition: { type: 'spring', stiffness: 400, damping: 18 } }}
                  >
                    <span className="ai-insights-kpi-label">{k.label}</span>
                    <KpiValue value={k.value} />
                    {k.hint && <span className="ai-insights-kpi-hint">{k.hint}</span>}
                  </motion.div>
                ))}
              </motion.div>

              <h3 className="ai-insights-section-title ai-insights-section-title--spaced">Дашборд</h3>
              <motion.div
                className="ai-insights-narrative"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
              >
                <h3 className="ai-insights-section-title">ИИ-аналитика по опросу</h3>
                {payload.narrative?.trim() ? (
                  <div className="ai-insights-narrative-inner">
                    {formatNarrative(payload.narrative).map((para, i) => (
                      <motion.p
                        key={i}
                        className="ai-insights-narrative-p"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.08 + i * 0.06 }}
                      >
                        {para}
                      </motion.p>
                    ))}
                  </div>
                ) : (
                  <p className="muted ai-insights-narrative-p">
                    Нет текста сводки. Ниже — карточки выводов по цифрам. Чтобы добавить формулировку нейросети, настройте
                    LLM на Cloud Function (см. BACKEND_AND_API.md).
                  </p>
                )}
              </motion.div>

              <div className="ai-insights-split">
                <div className="ai-insights-col">
                  <h3 className="ai-insights-section-title">Ключевые выводы</h3>
                  <motion.div className="ai-insights-stack" variants={staggerContainer} initial="hidden" animate="show">
                    {d.highlights.length === 0 ? (
                      <p className="muted">Нет выводов.</p>
                    ) : (
                      d.highlights.map((b, i) => <InsightCard key={i} block={b} />)
                    )}
                  </motion.div>
                </div>
                <div className="ai-insights-col">
                  <h3 className="ai-insights-section-title">Сигналы и риски</h3>
                  <motion.div className="ai-insights-stack" variants={staggerContainer} initial="hidden" animate="show">
                    {d.alerts.length === 0 ? (
                      <p className="muted">Замечаний нет.</p>
                    ) : (
                      d.alerts.map((b, i) => <InsightCard key={i} block={b} />)
                    )}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!payload && !loading && !err && !autoRun && (
          <motion.p
            className="muted ai-insights-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Включите автозагрузку или обновите страницу, чтобы получить сводку.
          </motion.p>
        )}
      </motion.section>
    </MotionConfig>
  );
}

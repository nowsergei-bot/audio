import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { requestAiInsights } from '../api/client';
import AnimatedNumber from './AnimatedNumber';
import { barEase, springCard, staggerContainer, staggerItem } from '../motion/resultsMotion';
import { questionTypeLabelRu } from '../lib/labels';
import type { AiInsightsPayload, InsightBlock, InsightTone } from '../types';

type Props = { surveyId: number };

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

export default function InsightsPanel({ surveyId }: Props) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<AiInsightsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPayload(null);
    setErr(null);
    setLoading(false);
  }, [surveyId]);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const data = await requestAiInsights(surveyId);
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

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
              Умная аналитика и автосводка
            </h2>
            <p className="muted ai-insights-sub">
              <strong>Как это устроено.</strong> Сначала сервер сам считает показатели по вашим ответам: сколько анкет,
              охват вопросов, короткие выводы по каждому полю и мини-диаграммы — всё на русском, без внешних сервисов.
              Если в настройках функции задан ключ к нейросети (переменная окружения на стороне Яндекс Облака), к этой
              сводке добавляется <em>дополнительная текстовая записка</em>, сгенерированная моделью по тем же цифрам.
              Ключ никогда не попадает в браузер и не хранится во фронтенде.               Ответы, в том числе импортированные из
              Excel, попадают в те же расчёты; для записки модель получает сжатые фрагменты длинных текстов и выносит
              темы и формулировки без полного пересказа каждой ячейки. По каждому текстовому вопросу отдельно можно
              открыть <strong>«Сводка и вывод по ответам»</strong> на странице результатов — там своя компиляция и блок
              нейросети по всем ответам только на этот вопрос.
            </p>
          </div>
          <div className="ai-insights-header-actions">
            <motion.button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => void run()}
              whileHover={!loading ? { scale: 1.05 } : undefined}
              whileTap={!loading ? { scale: 0.96 } : undefined}
            >
              {loading ? 'Считаем…' : 'Сформировать аналитику'}
            </motion.button>
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
              {payload && !loading && (
                <motion.span
                  key="src"
                  className={`ai-insights-source ai-insights-source--${payload.source}`}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  {payload.source === 'llm_hybrid' ? 'Сводка + текст нейросети' : 'Только автосводка'}
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

              {payload.narrative && (
                <motion.div
                  className="ai-insights-narrative"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <h3 className="ai-insights-section-title">Текстовая записка</h3>
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
                </motion.div>
              )}

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

              <h3 className="ai-insights-section-title ai-insights-section-title--spaced">По вопросам опроса</h3>
              <motion.div
                className="ai-insights-q-grid"
                variants={staggerContainer}
                initial="hidden"
                animate="show"
              >
                {d.questions.map((q) => (
                  <motion.article key={q.question_id} className="ai-insights-q-card" variants={staggerItem}>
                    <motion.div initial="rest" whileHover="hover" whileTap="tap" variants={springCard}>
                      <div className="ai-insights-q-top">
                        <span className="ai-insights-q-badge">#{q.question_id}</span>
                        <span className="ai-insights-q-type">{questionTypeLabelRu(q.type)}</span>
                        <span className="ai-insights-q-n">
                          ответов: <AnimatedNumber value={q.response_count} duration={0.8} />
                        </span>
                      </div>
                      <h4 className="ai-insights-q-title">{q.title}</h4>
                      <p className="ai-insights-q-detail">{q.detail}</p>
                      {q.bars.length > 0 && (
                        <div className="ai-insights-q-bars" aria-hidden>
                          {q.bars.map((b, i) => (
                            <div key={i} className="ai-insights-mini-row">
                              <div className="ai-insights-mini-label">
                                <span>{b.label}</span>
                                <motion.span
                                  className="ai-insights-mini-pct"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: 0.15 + i * 0.05 }}
                                >
                                  {b.pct}%
                                </motion.span>
                              </div>
                              <div className="ai-insights-mini-track">
                                <motion.div
                                  className="ai-insights-mini-fill"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.min(100, b.pct)}%` }}
                                  transition={{ duration: 0.85, delay: i * 0.07, ease: barEase }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  </motion.article>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!payload && !loading && !err && (
          <motion.p
            className="muted ai-insights-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Нажмите «Сформировать аналитику», чтобы построить сводку по текущим ответам.
          </motion.p>
        )}
      </motion.section>
    </MotionConfig>
  );
}

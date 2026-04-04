import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { requestAiInsights, requestDirectorAiInsights } from '../api/client';
import AnimatedNumber from './AnimatedNumber';
import { springCard, staggerContainer, staggerItem } from '../motion/resultsMotion';
import { questionTypeLabelRu } from '../lib/labels';
import type { AiInsightsPayload, AnalyticsFilter, InsightBlock, InsightTone } from '../types';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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

function trimOneLine(s: string, n: number) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

export default function InsightsPanel({
  surveyId,
  directorToken,
  onDrillDown,
  filters,
  autoRun = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<AiInsightsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const effectiveFilters = filters ?? NO_SLICE_FILTERS;
  const filterKey = JSON.stringify(effectiveFilters);

  useEffect(() => {
    setPayload(null);
    setErr(null);
    setLoading(false);
  }, [surveyId, filterKey, directorToken]);

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
  const orderById = new Map<number, number>();
  for (const q of (payload?.survey?.questions || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    orderById.set(q.id, orderById.size + 1);
  }
  const showQ = (id: number) => orderById.get(id) ?? id;
  const showQTitle = (qid: number, title: string) => `#${showQ(qid)} · ${trimOneLine(title, 34)}`;

  const topByResponses =
    d?.questions
      ?.slice()
      .sort((a, b) => (b.response_count || 0) - (a.response_count || 0))
      .slice(0, 10)
      .map((q) => ({
        name: showQTitle(q.question_id, q.title),
        value: q.response_count || 0,
        question_id: q.question_id,
      })) || [];

  const scaleAverages =
    d?.questions
      ?.filter((q) => (q.type === 'scale' || q.type === 'rating') && typeof q.avg === 'number')
      .slice()
      .sort((a, b) => (b.avg || 0) - (a.avg || 0))
      .slice(0, 10)
      .map((q) => ({
        name: showQTitle(q.question_id, q.title),
        avg: q.avg ?? 0,
        min: q.min ?? null,
        max: q.max ?? null,
        question_id: q.question_id,
      })) || [];

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

              <h3 className="ai-insights-section-title ai-insights-section-title--spaced">Дашборд</h3>
              {payload.narrative && (
                <motion.div
                  className="ai-insights-narrative"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                >
                  <h3 className="ai-insights-section-title">ИИ-аналитика по опросу</h3>
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
              <div className="ai-insights-charts">
                <div className="ai-insights-chart-card">
                  <h4 className="ai-insights-chart-title">Ответов по вопросам (топ)</h4>
                  <div className="ai-insights-chart-wrap">
                    {topByResponses.length === 0 ? (
                      <p className="muted">Пока нет данных.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                        <BarChart
                          data={topByResponses}
                          layout="vertical"
                          margin={{ top: 6, right: 16, left: 4, bottom: 0 }}
                        >
                          <CartesianGrid stroke="rgba(17,24,39,0.08)" strokeDasharray="3 3" />
                          <XAxis type="number" tick={{ fill: 'rgba(17,24,39,0.55)', fontSize: 11 }} width={36} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: 'rgba(17,24,39,0.65)', fontSize: 11 }}
                            width={170}
                          />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(255,255,255,0.98)',
                              border: '1px solid rgba(17,24,39,0.12)',
                              borderRadius: 12,
                              boxShadow: '0 18px 50px rgba(17,24,39,0.18)',
                              padding: '10px 14px',
                            }}
                            labelStyle={{ color: '#111827', fontWeight: 800 }}
                            itemStyle={{ color: '#111827' }}
                            formatter={(v: number) => [`${v} ответов`, '']}
                          />
                          <Bar
                            dataKey="value"
                            name="Ответов"
                            fill="rgba(227,6,19,0.72)"
                            radius={[8, 8, 8, 8]}
                            onClick={(d) => {
                              const qid = (d as { question_id?: number }).question_id;
                              if (qid != null) onDrillDown?.(qid);
                            }}
                            style={{ cursor: onDrillDown ? 'pointer' : undefined }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="ai-insights-chart-card">
                  <h4 className="ai-insights-chart-title">Средние оценки (шкалы/рейтинг)</h4>
                  <div className="ai-insights-chart-wrap">
                    {scaleAverages.length === 0 ? (
                      <p className="muted">Нет шкал/рейтингов с данными.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                        <BarChart
                          data={scaleAverages}
                          layout="vertical"
                          margin={{ top: 6, right: 16, left: 4, bottom: 0 }}
                        >
                          <CartesianGrid stroke="rgba(17,24,39,0.08)" strokeDasharray="3 3" />
                          <XAxis type="number" tick={{ fill: 'rgba(17,24,39,0.55)', fontSize: 11 }} width={36} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: 'rgba(17,24,39,0.65)', fontSize: 11 }}
                            width={170}
                          />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(255,255,255,0.98)',
                              border: '1px solid rgba(17,24,39,0.12)',
                              borderRadius: 12,
                              boxShadow: '0 18px 50px rgba(17,24,39,0.18)',
                              padding: '10px 14px',
                            }}
                            labelStyle={{ color: '#111827', fontWeight: 800 }}
                            itemStyle={{ color: '#111827' }}
                            formatter={(v: number, _name: string, ctx) => {
                              const row = (ctx as { payload?: { min?: number | null; max?: number | null } }).payload;
                              const range =
                                row && row.min != null && row.max != null ? ` (диапазон ${row.min}…${row.max})` : '';
                              return [`${Number(v).toFixed(2)}${range}`, 'Среднее'];
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                          <Bar
                            dataKey="avg"
                            name="Среднее"
                            fill="rgba(17,94,89,0.70)"
                            radius={[8, 8, 8, 8]}
                            onClick={(d) => {
                              const qid = (d as { question_id?: number }).question_id;
                              if (qid != null) onDrillDown?.(qid);
                            }}
                            style={{ cursor: onDrillDown ? 'pointer' : undefined }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>

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
                        <span className="ai-insights-q-badge">#{showQ(q.question_id)}</span>
                        <span className="ai-insights-q-type">{questionTypeLabelRu(q.type)}</span>
                        <span className="ai-insights-q-n">
                          ответов: <AnimatedNumber value={q.response_count} duration={0.8} />
                        </span>
                      </div>
                      <h4 className="ai-insights-q-title">{q.title}</h4>
                      <p className="ai-insights-q-detail">{q.detail}</p>
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

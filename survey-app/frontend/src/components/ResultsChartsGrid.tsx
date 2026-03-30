import { motion } from 'framer-motion';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ResultsChartsBlock } from '../types';

const C1 = '#3498db';
const C2 = '#2ecc71';
const C3 = '#f39c12';
const SERIES_COLORS = [C1, C2, C3];
const AXIS = 'rgba(17,24,39,0.55)';
const GRID = 'rgba(17,24,39,0.08)';

const CHART_TOOLTIP = {
  contentStyle: {
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(17,24,39,0.12)',
    borderRadius: 12,
    boxShadow: '0 18px 50px rgba(17,24,39,0.18)',
    padding: '10px 14px',
  },
  labelStyle: { color: '#111827', fontWeight: 800 as const, marginBottom: 4 },
  itemStyle: { color: '#111827' },
  animationDuration: 180,
  animationEasing: 'ease-out' as const,
};

/** Полоса под курсором на столбчатых графиках — тёмная, без белой заливки по умолчанию Recharts */
const BAR_CURSOR = { fill: 'rgba(17,24,39,0.06)' };
const LINE_CURSOR = { stroke: 'rgba(17,24,39,0.18)', strokeWidth: 1 };

function mergeLineRows(
  daily: ResultsChartsBlock['daily'],
  series: ResultsChartsBlock['top_questions_timeseries']
): Record<string, string | number>[] {
  return daily.map((row) => {
    const out: Record<string, string | number> = {
      dateLabel: row.date.slice(8, 10) + '.' + row.date.slice(5, 7),
    };
    for (const s of series) {
      const pt = s.points.find((p) => p.date === row.date);
      out[`s_${s.question_id}`] = pt?.count ?? 0;
    }
    return out;
  });
}

function dowBarRows(dow_stacked: ResultsChartsBlock['dow_stacked']) {
  return dow_stacked.map((d) => {
    const row: Record<string, string | number> = { name: d.label };
    for (const st of d.stacks) {
      row[`s_${st.question_id}`] = st.count;
    }
    return row;
  });
}

type Props = {
  charts: ResultsChartsBlock;
  onDrillDown: (questionId: number) => void;
  /** Более плотная сетка и ниже графики. */
  compact?: boolean;
};

export default function ResultsChartsGrid({ charts, onDrillDown, compact }: Props) {
  const lineRows = useMemo(
    () => mergeLineRows(charts.daily, charts.top_questions_timeseries),
    [charts.daily, charts.top_questions_timeseries]
  );
  const barRows = useMemo(() => dowBarRows(charts.dow_stacked), [charts.dow_stacked]);
  const topSeries = charts.top_questions_timeseries;

  const hasLine = topSeries.length > 0;
  const hasBar = charts.dow_stacked.length > 0 && topSeries.length > 0;

  return (
    <motion.section
      className={`results-dashboard${compact ? ' results-dashboard--compact' : ''}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Сводные графики"
    >
      <div className="results-dashboard-inner">
        <div className="results-dashboard-grid">
          <div className="results-dash-card">
            <h3 className="results-dash-card-title">По дням недели (стек)</h3>
            <div className="results-dash-chart-wrap results-dash-chart-tall">
              {!hasBar ? (
                <p className="results-dash-empty muted">Недостаточно данных за период.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={compact ? 150 : 220}>
                  <BarChart data={barRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 12 }} />
                    <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={36} />
                    <Tooltip
                      {...CHART_TOOLTIP}
                      cursor={BAR_CURSOR}
                      formatter={(value: number, name: string) => [`${value} ответов`, name]}
                      labelFormatter={(label) => `День недели: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#e2e8f0' }} />
                    {topSeries.map((s, i) => (
                      <Bar
                        key={s.question_id}
                        dataKey={`s_${s.question_id}`}
                        name={s.short_label}
                        stackId="a"
                        fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                        animationDuration={820}
                        animationEasing="ease-out"
                        activeBar={{
                          stroke: 'rgba(255,255,255,0.65)',
                          strokeWidth: 2,
                          style: { filter: 'brightness(1.12)' },
                        }}
                        onClick={() => onDrillDown(s.question_id)}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="results-dash-card">
            <h3 className="results-dash-card-title">Активность по дням (топ вопросов)</h3>
            <div className="results-dash-chart-wrap results-dash-chart-tall">
              {!hasLine ? (
                <p className="results-dash-empty muted">Нужны ответы по нескольким вопросам.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={compact ? 150 : 220}>
                  <LineChart data={lineRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis dataKey="dateLabel" tick={{ fill: AXIS, fontSize: 11 }} />
                    <YAxis tick={{ fill: AXIS, fontSize: 11 }} width={36} />
                    <Tooltip
                      {...CHART_TOOLTIP}
                      cursor={LINE_CURSOR}
                      formatter={(value: number, name: string) => [`${value} отметок`, name]}
                      labelFormatter={(label) => `Дата: ${label}`}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: '#e2e8f0' }}
                      formatter={(value) => <span style={{ color: '#e2e8f0' }}>{value}</span>}
                    />
                    {topSeries.map((s, i) => (
                      <Line
                        key={s.question_id}
                        type="monotone"
                        dataKey={`s_${s.question_id}`}
                        name={s.short_label}
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        strokeWidth={2.25}
                        dot={false}
                        activeDot={{
                          r: 7,
                          strokeWidth: 2,
                          stroke: '#fff',
                          fill: SERIES_COLORS[i % SERIES_COLORS.length],
                          onClick: () => onDrillDown(s.question_id),
                          style: { cursor: 'pointer' },
                        }}
                        animationDuration={920}
                        animationEasing="ease-out"
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

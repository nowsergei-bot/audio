import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ResultQuestion } from '../types';

const BAR_COLORS = [
  '#e30613',
  '#f43f5e',
  '#fb7185',
  '#fda4af',
  '#fca5a5',
  '#f87171',
  '#ef4444',
  '#dc2626',
];

const tooltipStyle = {
  background: 'rgba(255,255,255,0.98)',
  border: '1px solid rgba(17,24,39,0.12)',
  borderRadius: 10,
  color: '#111827',
  boxShadow: '0 12px 40px rgba(17,24,39,0.18)',
};

export default function ResultChart({ q }: { q: ResultQuestion }) {
  if (!q.distribution || q.distribution.length === 0) {
    return <p className="muted">Нет данных для диаграммы</p>;
  }
  const data = q.distribution.map((d) => ({
    name: String(d.label),
    count: d.count,
  }));
  const total = data.reduce((s, row) => s + row.count, 0) || 1;
  const dataWithPct = data.map((r) => ({
    ...r,
    pct: Math.round((r.count / total) * 100),
  }));

  // "Случайный" (но стабильный) выбор ориентации по id вопроса.
  const hash = ((q.question_id || 0) * 2654435761) >>> 0;
  const preferHorizontal = data.length > 6 || data.some((r) => r.name.length > 16);
  const horizontal = preferHorizontal ? true : (hash % 2 === 0);

  const height = horizontal ? 260 : 240;

  return (
    <motion.div
      className="chart-wrap results-recharts"
      style={{ width: '100%', height }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <ResponsiveContainer>
        {horizontal ? (
          <BarChart
            data={dataWithPct}
            layout="vertical"
            margin={{ top: 8, right: 18, left: 6, bottom: 6 }}
            barCategoryGap={8}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.14)" strokeOpacity={1} horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 11, fill: 'rgba(17,24,39,0.60)' }}
              stroke="rgba(17,24,39,0.22)"
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={{ fontSize: 11, fill: 'rgba(17,24,39,0.70)' }}
              stroke="rgba(17,24,39,0.0)"
              tickFormatter={(s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: '#111827', fontWeight: 800 }}
              itemStyle={{ color: '#111827' }}
              cursor={{ fill: 'rgba(17,24,39,0.06)' }}
              labelFormatter={(label) => `Вариант: ${label}`}
              formatter={(value: number) => [
                `${value} шт. (${((value / total) * 100).toFixed(1)}%)`,
                'Ответы',
              ]}
            />
            <Bar
              dataKey="count"
              radius={[10, 10, 10, 10]}
              maxBarSize={28}
              isAnimationActive
              animationDuration={1100}
              animationEasing="ease-out"
              animationBegin={40}
              activeBar={{
                stroke: 'rgba(17,24,39,0.25)',
                strokeWidth: 2,
                style: { filter: 'brightness(1.08)' },
              }}
            >
              <LabelList
                dataKey="count"
                position="right"
                fill="rgba(17,24,39,0.78)"
                fontSize={11}
                formatter={(value: any, _name: any, props: any) => {
                  const p = props?.payload?.pct;
                  return p != null ? `${value} (${p}%)` : String(value);
                }}
              />
              {dataWithPct.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={dataWithPct} margin={{ top: 10, right: 10, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,24,39,0.14)" strokeOpacity={1} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: 'rgba(17,24,39,0.60)' }}
              stroke="rgba(17,24,39,0.22)"
              interval={0}
              angle={0}
              textAnchor="middle"
              height={44}
              tickFormatter={(s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s)}
            />
            <YAxis
              allowDecimals={false}
              width={36}
              tick={{ fill: 'rgba(17,24,39,0.60)', fontSize: 11 }}
              stroke="rgba(17,24,39,0.22)"
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: '#111827', fontWeight: 800 }}
              itemStyle={{ color: '#111827' }}
              cursor={{ fill: 'rgba(17,24,39,0.06)' }}
              labelFormatter={(label) => `Вариант: ${label}`}
              formatter={(value: number) => [
                `${value} шт. (${((value / total) * 100).toFixed(1)}%)`,
                'Ответы',
              ]}
            />
            <Bar
              dataKey="count"
              radius={[8, 8, 0, 0]}
              maxBarSize={56}
              isAnimationActive
              animationDuration={1200}
              animationEasing="ease-out"
              animationBegin={40}
              activeBar={{
                stroke: 'rgba(17,24,39,0.25)',
                strokeWidth: 2,
                style: { filter: 'brightness(1.10)' },
              }}
            >
              <LabelList
                dataKey="count"
                position="top"
                fill="rgba(17,24,39,0.78)"
                fontSize={11}
                formatter={(value: any, _name: any, props: any) => {
                  const p = props?.payload?.pct;
                  return p != null ? `${value} (${p}%)` : String(value);
                }}
              />
              {dataWithPct.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}

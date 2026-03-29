import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  background: '#141b26',
  border: '1px solid #334155',
  borderRadius: 10,
  color: '#f8fafc',
  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
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

  return (
    <motion.div
      className="chart-wrap results-recharts"
      style={{ width: '100%', height: 300 }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" strokeOpacity={0.35} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            stroke="#475569"
            interval={0}
            angle={-28}
            textAnchor="end"
            height={56}
          />
          <YAxis allowDecimals={false} width={44} tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: '#e2e8f0', fontWeight: 700 }}
            itemStyle={{ color: '#f8fafc' }}
            cursor={{ fill: 'rgba(15, 20, 28, 0.45)' }}
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
              stroke: 'rgba(255,255,255,0.75)',
              strokeWidth: 2,
              style: { filter: 'brightness(1.14)' },
            }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PhenomenalReportDraft } from './reportDraftTypes';
import type { TeacherLessonChecklistRow } from './parseTeacherChecklistApril';
import {
  aggregateCompetencyFromDraft,
  aggregateCompetencyFromTeacherRows,
  competencyChartHasData,
  type PhenomenalCompetencyAggregate,
} from './competencyScores';

type Props =
  | { mode: 'draft'; draft: PhenomenalReportDraft }
  | { mode: 'teacherRows'; rows: TeacherLessonChecklistRow[] };

function buildChartRows(agg: PhenomenalCompetencyAggregate[]) {
  return agg
    .filter((a) => a.lessonCount > 0)
    .map((a) => ({
      name: a.shortLabel,
      pct: a.maxLevel > 0 ? Math.min(1, a.mean / a.maxLevel) : 0,
      raw: `${a.mean.toFixed(2)} / ${a.maxLevel}`,
      n: a.lessonCount,
    }));
}

const pctTick = (v: number) => `${Math.round(v * 100)}%`;

export default function PhenomenalCompetencyCharts(props: Props) {
  const agg = useMemo(() => {
    if (props.mode === 'draft') return aggregateCompetencyFromDraft(props.draft);
    return aggregateCompetencyFromTeacherRows(props.rows);
  }, [props]);

  const rows = useMemo(() => buildChartRows(agg), [agg]);
  const hasData = competencyChartHasData(agg);

  if (!hasData) {
    return (
      <div className="phenomenal-competency-charts phenomenal-competency-charts--empty">
        <h3 className="phenomenal-competency-charts-title">Сводка по метрикам</h3>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          Нет числовых данных по шкалам. При импорте из Excel они подтягиваются автоматически.
        </p>
      </div>
    );
  }

  return (
    <div className="phenomenal-competency-charts">
      <h3 className="phenomenal-competency-charts-title">Сводка по метрикам (среднее, доля от макс.)</h3>
      <p className="muted phenomenal-competency-charts-lead">
        Горизонтальные столбцы: ось — процент от максимума по каждой метрике (как в опроснике).
      </p>
      <div className="phenomenal-competency-charts-grid phenomenal-competency-charts-grid--single">
        <div className="phenomenal-competency-chart-panel">
          <div className="phenomenal-competency-chart-wrap phenomenal-competency-chart-wrap--bar">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={rows} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #33415555)" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickCount={5}
                  tick={{ fontSize: 11 }}
                  tickFormatter={pctTick}
                />
                <YAxis type="category" dataKey="name" width={148} tick={{ fontSize: 10 }} interval={0} />
                <Tooltip
                  formatter={(value: number, _l, item) => {
                    const p = item?.payload as { raw?: string; n?: number } | undefined;
                    return [`${pctTick(value)} (${p?.raw ?? ''})`, 'Средняя доля'];
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { n?: number } | undefined;
                    return p?.n != null ? `Уроков с данными: ${p.n}` : '';
                  }}
                />
                <Bar dataKey="pct" name="Доля" fill="var(--chart-bar, #6366f1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

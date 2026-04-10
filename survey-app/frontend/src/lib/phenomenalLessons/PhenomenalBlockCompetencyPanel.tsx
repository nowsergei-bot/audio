import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TeacherLessonChecklistRow } from './parseTeacherChecklistApril';
import type { PhenomenalReportBlockDraft } from './reportDraftTypes';
import {
  chartMetricsFromBlockScores,
  competencyRowsForBlock,
  competencyRowsForTeacherRow,
  methodologyAvgRawOnTen,
  methodologyAvgRawOnTenFromTeacherRow,
} from './competencyScores';

export type PhenomenalBlockCompetencyPanelProps =
  | {
      source: 'block';
      block: PhenomenalReportBlockDraft;
      /** half — узкая колонка; editorSidebar — ещё компактнее по высоте для полосы справа */
      variant?: 'default' | 'half' | 'editorSidebar';
    }
  | {
      source: 'teacherRow';
      row: TeacherLessonChecklistRow;
      variant?: 'default' | 'half' | 'editorSidebar';
    };

type ChartRow = { name: string; pct: number };

const pctTick = (v: number) => `${Math.round(v * 100)}%`;

export default function PhenomenalBlockCompetencyPanel(props: PhenomenalBlockCompetencyPanelProps) {
  const variant = props.variant ?? 'default';
  const chartH = variant === 'editorSidebar' ? 168 : variant === 'half' ? 210 : 240;
  const yAxisW = variant === 'editorSidebar' ? 100 : variant === 'half' ? 112 : 130;
  const rubricRows = useMemo(() => {
    if (props.source === 'block') return competencyRowsForBlock(props.block);
    return competencyRowsForTeacherRow(props.row);
  }, [props]);

  const methodologyTen = useMemo(() => {
    if (props.source === 'block') return methodologyAvgRawOnTen(props.block);
    return methodologyAvgRawOnTenFromTeacherRow(props.row);
  }, [props]);

  const emptyHint =
    props.source === 'block'
      ? 'Нет данных для диаграммы: укажите оценку методики (/10) или заново импортируйте Excel педагогов (уровни рубрики подтягиваются из файла).'
      : 'Нет данных: в строке Excel нет балла методики и уровней рубрики.';

  const chartRows: ChartRow[] = useMemo(() => {
    const metrics = chartMetricsFromBlockScores(rubricRows, methodologyTen);
    return metrics.map((m) => ({
      name: m.label,
      pct: m.pct,
    }));
  }, [rubricRows, methodologyTen]);

  const hasChart = chartRows.length > 0;

  const narrow = variant === 'half' || variant === 'editorSidebar';
  return (
    <div
      className={`phenomenal-block-competency phenomenal-block-competency--bar-only${narrow ? ' phenomenal-block-competency--half' : ''}${variant === 'editorSidebar' ? ' phenomenal-block-competency--editor-sidebar' : ''}`}
    >
      <h4 className="phenomenal-block-competency-title">Сводка по метрикам (доля от макс. в опроснике)</h4>
      {!hasChart ? (
        <p className="muted phenomenal-block-competency-empty">{emptyHint}</p>
      ) : (
        <div
          className="phenomenal-competency-chart-wrap phenomenal-block-competency-bar"
          style={{ width: '100%', height: chartH }}
        >
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart
              layout="vertical"
              data={chartRows}
              margin={{ top: 6, right: 8, left: 2, bottom: 6 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #33415555)" />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickCount={5}
                tick={{ fontSize: variant === 'editorSidebar' ? 8 : variant === 'half' ? 9 : 10 }}
                tickFormatter={pctTick}
              />
              <YAxis type="category" dataKey="name" width={yAxisW} tick={{ fontSize: 8 }} interval={0} />
              <Tooltip formatter={(v: number) => [pctTick(v), 'Относительный уровень']} />
              <Bar dataKey="pct" name="Доля" fill="var(--chart-bar, #6366f1)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

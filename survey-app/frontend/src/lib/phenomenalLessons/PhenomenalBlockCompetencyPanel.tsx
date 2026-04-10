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
      /** half — узкая колонка; editorSidebar — компактно справа в редакторе; public — полная высота под все метрики (страница руководителя) */
      variant?: 'default' | 'half' | 'editorSidebar' | 'public';
    }
  | {
      source: 'teacherRow';
      row: TeacherLessonChecklistRow;
      variant?: 'default' | 'half' | 'editorSidebar' | 'public';
    };

type ChartRow = { name: string; pct: number };

const pctTick = (v: number) => `${Math.round(v * 100)}%`;

export default function PhenomenalBlockCompetencyPanel(props: PhenomenalBlockCompetencyPanelProps) {
  const variant = props.variant ?? 'default';

  const { rubricRows, methodologyTen, metricCount } = useMemo(() => {
    const rubric =
      props.source === 'block' ? competencyRowsForBlock(props.block) : competencyRowsForTeacherRow(props.row);
    const meth =
      props.source === 'block' ? methodologyAvgRawOnTen(props.block) : methodologyAvgRawOnTenFromTeacherRow(props.row);
    const metrics = chartMetricsFromBlockScores(rubric, meth);
    return { rubricRows: rubric, methodologyTen: meth, metricCount: metrics.length };
  }, [props]);

  const publicChartH =
    metricCount > 0 ? Math.min(560, Math.max(220, metricCount * 34 + 108)) : 220;
  const chartH =
    variant === 'public'
      ? publicChartH
      : variant === 'editorSidebar'
        ? 168
        : variant === 'half'
          ? 210
          : 240;
  const yAxisW =
    variant === 'public' ? 140 : variant === 'editorSidebar' ? 100 : variant === 'half' ? 112 : 130;

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
  const tickAxis =
    variant === 'editorSidebar' ? 8 : variant === 'half' ? 9 : variant === 'public' ? 10 : 10;
  const tickX =
    variant === 'editorSidebar' ? 8 : variant === 'half' ? 9 : variant === 'public' ? 11 : 10;
  return (
    <div
      className={`phenomenal-block-competency phenomenal-block-competency--bar-only${narrow ? ' phenomenal-block-competency--half' : ''}${variant === 'editorSidebar' ? ' phenomenal-block-competency--editor-sidebar' : ''}${variant === 'public' ? ' phenomenal-block-competency--public' : ''}`}
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
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, rgba(197, 48, 48, 0.2))" />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickCount={5}
                tick={{ fontSize: tickX }}
                tickFormatter={pctTick}
              />
              <YAxis type="category" dataKey="name" width={yAxisW} tick={{ fontSize: tickAxis }} interval={0} />
              <Tooltip formatter={(v: number) => [pctTick(v), 'Относительный уровень']} />
              <Bar
                dataKey="pct"
                name="Доля"
                fill="var(--phenomenal-competency-bar, var(--chart-bar, #c53030))"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

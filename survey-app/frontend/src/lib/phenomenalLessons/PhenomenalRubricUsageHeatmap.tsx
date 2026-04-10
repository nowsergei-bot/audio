import { useMemo } from 'react';
import { PHENOMENAL_RUBRIC_DIMENSIONS } from './phenomenalRubricDimensions';
import type { PhenomenalReportBlockDraft } from './reportDraftTypes';
import type { TeacherLessonChecklistRow } from './parseTeacherChecklistApril';
import { PHENOMENAL_METRIC_MAX, scaleLevelsForMetric, type PhenomenalCompetencyKey } from './competencyScores';
import { parseUsedScaleLevelsFromRubricText } from './rubricUsageLevels';

/** Общие заголовки столбцов: 0…4 (для рефлексии используются только 0 и 1). */
const HEATMAP_COL_LEVELS = [0, 1, 2, 3, 4] as const;

type Props =
  | { source: 'block'; block: PhenomenalReportBlockDraft }
  | { source: 'teacherRow'; row: TeacherLessonChecklistRow };

function usedSetForDimension(props: Props, key: PhenomenalCompetencyKey): Set<number> {
  const raw = props.source === 'block' ? props.block[key] : props.row[key];
  return parseUsedScaleLevelsFromRubricText(raw, PHENOMENAL_METRIC_MAX[key]);
}

export default function PhenomenalRubricUsageHeatmap(props: Props) {
  const rows = useMemo(
    () =>
      PHENOMENAL_RUBRIC_DIMENSIONS.map((d) => ({
        key: d.key as PhenomenalCompetencyKey,
        title: d.titleRu,
        used: usedSetForDimension(props, d.key as PhenomenalCompetencyKey),
        levels: scaleLevelsForMetric(d.key as PhenomenalCompetencyKey),
      })),
    [props],
  );

  const anyUsed = rows.some((r) => r.used.size > 0);

  return (
    <div className="phenomenal-rubric-usage">
      <h5 className="phenomenal-rubric-usage-title">Какие уровни шкалы отражены в ответе</h5>
      <p className="muted phenomenal-rubric-usage-lead">
        Шкала как в опроснике: для шести блоков — уровни <strong>0–4</strong>, для рефлексии — <strong>0–1</strong>.
        Строки «4 - …», «0 - …» в тексте рубрики.{' '}
        <span className="phenomenal-rubric-usage-legend">
          <span className="phenomenal-rubric-usage-swatch phenomenal-rubric-usage-swatch--on" /> в тексте есть
        </span>
        {' · '}
        <span className="phenomenal-rubric-usage-legend">
          <span className="phenomenal-rubric-usage-swatch phenomenal-rubric-usage-swatch--off" /> нет в тексте
        </span>
        {' · '}
        <span className="muted">«—» — уровень не используется в этой компетенции</span>
      </p>
      {!anyUsed ? (
        <p className="muted phenomenal-rubric-usage-empty">
          В текстах рубрики нет строк, начинающихся с номера уровня и тире — проверьте импорт из Excel или формулировки
          как в Google Forms.
        </p>
      ) : (
        <div className="phenomenal-rubric-usage-table-wrap">
          <table className="phenomenal-rubric-usage-table">
            <thead>
              <tr>
                <th className="phenomenal-rubric-usage-th-dim">Компетенция</th>
                {HEATMAP_COL_LEVELS.map((lv) => (
                  <th key={lv} className="phenomenal-rubric-usage-th-lv">
                    {lv}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="phenomenal-rubric-usage-td-dim">{r.title}</td>
                  {HEATMAP_COL_LEVELS.map((lv) => {
                    const applies = r.levels.includes(lv);
                    if (!applies) {
                      return (
                        <td
                          key={lv}
                          className="phenomenal-rubric-usage-cell phenomenal-rubric-usage-cell--na"
                          title="Для этой компетенции такого уровня нет в опроснике"
                        >
                          —
                        </td>
                      );
                    }
                    const on = r.used.has(lv);
                    return (
                      <td
                        key={lv}
                        className={`phenomenal-rubric-usage-cell ${on ? 'phenomenal-rubric-usage-cell--on' : 'phenomenal-rubric-usage-cell--off'}`}
                        title={on ? `Уровень ${lv} есть в ответе` : `Уровень ${lv} не найден в начале строк`}
                      >
                        {on ? '●' : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

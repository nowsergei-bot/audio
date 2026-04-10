import type { PhenomenalCompetencyKey } from './competencyScores';
import { PHENOMENAL_METRIC_MAX } from './competencyScores';
import { PHENOMENAL_RUBRIC_DIMENSIONS } from './phenomenalRubricDimensions';
import type { PhenomenalReportBlockDraft } from './reportDraftTypes';

/**
 * Какие уровни 0…max явно упомянуты в начале строки ответа (как в Google Forms).
 */
export function parseUsedScaleLevelsFromRubricText(raw: string | undefined, maxLevel: number): Set<number> {
  const used = new Set<number>();
  if (raw == null || !String(raw).trim()) return used;
  const lines = String(raw).split(/\r?\n/);
  for (const line of lines) {
    let m = line.match(/^\s*(\d{1,2})\s*[-–—.)]\s*/);
    if (!m) m = line.match(/^\s*(\d{1,2})\.\s+/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= maxLevel) used.add(n);
  }
  return used;
}

export type RubricUsageByDimension = Record<PhenomenalCompetencyKey, Set<number>>;

export function usedRubricLevelsByDimension(block: PhenomenalReportBlockDraft): RubricUsageByDimension {
  const out = {} as RubricUsageByDimension;
  for (const d of PHENOMENAL_RUBRIC_DIMENSIONS) {
    const max = PHENOMENAL_METRIC_MAX[d.key as PhenomenalCompetencyKey];
    out[d.key] = parseUsedScaleLevelsFromRubricText(block[d.key], max);
  }
  return out;
}

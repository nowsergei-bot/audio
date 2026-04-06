/**
 * В нарративе ИИ-аналитики при наличии текстовых ответов обязателен блок
 * «Сигналы, риски и точки роста» — подстраховка, если модель его опустила.
 */

function snapshotHasTextResponses(snapshot) {
  const qs = snapshot?.questions || [];
  return qs.some((q) => {
    if (q.type !== 'text') return false;
    const rc = Number(q.response_count) || 0;
    const st = Number(q.samples_total) || 0;
    const sl = Array.isArray(q.samples) ? q.samples.length : 0;
    return rc > 0 || st > 0 || sl > 0;
  });
}

function narrativeHasRisksGrowthBlock(text) {
  const t = String(text || '');
  if (/сигналы?\s*,?\s*риски?\s+и\s+точки?\s+роста/i.test(t)) return true;
  if (/риски?\s+и\s+точки?\s+роста/i.test(t)) return true;
  return false;
}

const RISKS_GROWTH_FALLBACK =
  'Сигналы, риски и точки роста. Свободные ответы — основной источник нюансов: в них часто звучат конкретные проблемы, усталость и расхождение ожиданий с реальностью; повторяющиеся формулировки стоит трактовать как приоритетные риски. ' +
  'Параллельно ищите благодарности, конструктивные предложения и признаки вовлечённости — это точки роста. Сверьте облако тем и полные тексты к вопросам и зафиксируйте для команды минимум один риск и одну инициативу развития.';

/**
 * @param {string} narrative
 * @param {object} snapshot
 * @returns {string}
 */
function ensureNarrativeRisksAndGrowth(narrative, snapshot) {
  if (!snapshotHasTextResponses(snapshot)) return narrative;
  if (narrativeHasRisksGrowthBlock(narrative)) return narrative;
  const base = String(narrative || '').trim();
  return base ? `${base}\n\n${RISKS_GROWTH_FALLBACK}` : RISKS_GROWTH_FALLBACK;
}

module.exports = {
  snapshotHasTextResponses,
  narrativeHasRisksGrowthBlock,
  ensureNarrativeRisksAndGrowth,
  RISKS_GROWTH_FALLBACK,
};

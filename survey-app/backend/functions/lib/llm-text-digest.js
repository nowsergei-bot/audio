const { truncate } = require('./insight-dashboard');

/**
 * Сжатые фрагменты текстовых ответов для нейросети (темы, цитаты — без полной выгрузки).
 */
function buildTextCorpusForLlm(questions, opts = {}) {
  const maxPerSample = opts.maxPerSample ?? 420;
  const maxSamplesPerQ = opts.maxSamplesPerQ ?? 32;
  const maxTotalChars = opts.maxTotalChars ?? 16000;

  const blocks = [];
  let total = 0;

  for (const q of questions) {
    const corpus = q.type === 'text' ? q.samples || [] : [];
    if (q.type !== 'text' || !corpus.length) continue;
    const fragments = [];
    for (const s of corpus.slice(0, maxSamplesPerQ)) {
      const t = String(s ?? '').trim();
      if (!t) continue;
      const piece = t.length > maxPerSample ? `${t.slice(0, maxPerSample)}…` : t;
      fragments.push(piece);
      total += piece.length + 2;
      if (total >= maxTotalChars) break;
    }
    if (fragments.length) {
      blocks.push({
        question_id: q.question_id,
        title: truncate(q.text, 140),
        total_text_answers: q.samples_total ?? corpus.length,
        excerpts: fragments,
      });
    }
    if (total >= maxTotalChars) break;
  }

  return blocks;
}

module.exports = { buildTextCorpusForLlm };

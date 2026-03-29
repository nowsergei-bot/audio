/** Стоп-слова (RU + короткие «шумовые») для облака по свободным ответам */
const STOP = new Set(
  `и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по
  только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если
  или быть был него до вас ни уж вам сколько они тут где есть над ней для мы те вы
  какая между себя`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * @param {string} s
 * @returns {string[]}
 */
function tokenizeLine(s) {
  const t = String(s || '').toLowerCase();
  const words = t.match(/[\p{L}\p{N}]+/gu);
  if (!words) return [];
  return words.filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * @param {string[]} texts
 * @param {number} maxWords
 * @returns {{ text: string, count: number }[]}
 */
function buildWordCloudFromTexts(texts, maxWords = 72) {
  const freq = new Map();
  for (const raw of texts) {
    for (const w of tokenizeLine(raw)) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([text, count]) => ({ text, count }));
}

module.exports = { buildWordCloudFromTexts, tokenizeLine };

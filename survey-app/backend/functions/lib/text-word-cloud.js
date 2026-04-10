const { isExcludedPersonNameToken } = require('./word-cloud-person-filter');

/**
 * Стоп-слова (RU + короткие «шумовые») для облака по свободным ответам.
 * Синхронизируйте с frontend/src/lib/wordCloudDisplay.ts (refineWordCloudForDisplay).
 */
function normalizeWordCloudToken(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/ё/g, 'е');
}

const STOP = new Set(
  `и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по
  только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если
  или быть был него до вас ни уж вам сколько они тут где есть над ней для мы те вы
  какая между себя это тот та те этот эта эти том той тем тому той тоже опять вновь
  весь всю всего всем всеми чем чему чём под при про над без раз уж будто вроде
  разве либо хоть кто кого кому чей чья чьё чьи
  которые которой которого которым которую который которая которое которых которыми
  много многое многие многим многими мало несколько немного
  своего своей своих своим своими свою свой своя своё свои своём
  поэтому однако значит также
  конечно наверное возможно видимо
  именно
  всей всём
  такой такая такое такие таких таким такими такую
  здесь туда сюда оттуда отсюда
  снова
  очень крайне вполне довольно чуть
  этому этими этих
  собой собою
  хочется хотелось
  чтобы чтоб
  фио фамилия имя отчество
  нас наших нам нами вас вами
  огромное огромная огромный огромные огромной огромную огромным огромными
  спасибо благодарю благодарность благодарности благодарен благодарна благодарны
  друг друга другу другом друзей
  большое`
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWordCloudToken),
);

/**
 * @param {string} s
 * @returns {string[]}
 */
function tokenizeLine(s) {
  const t = String(s || '').toLowerCase();
  const words = t.match(/[\p{L}\p{N}]+/gu);
  if (!words) return [];
  return words
    .map((w) => normalizeWordCloudToken(w))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !isExcludedPersonNameToken(w));
}

/**
 * @param {string[]} texts
 * @param {number} maxWords
 * @returns {{ text: string, count: number }[]}
 */
function buildWordCloudFromTexts(texts, maxWords = 22) {
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

module.exports = { buildWordCloudFromTexts, tokenizeLine, normalizeWordCloudToken };

/**
 * Псевдонимизация перед отправкой в LLM: в промпт уходит только текст с токенами.
 * Таблица token → исходное значение хранится у вас (state_json / БД) и в запрос к модели не включается.
 */

const crypto = require('crypto');

const TYPE_PREFIX = {
  teacher: 'УЧ',
  phone: 'ТЛФ',
  address: 'АДР',
  class: 'КЛ',
  child: 'РЕБ',
  other: 'ПД',
};

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomSuffix() {
  return crypto.randomBytes(4).toString('hex').slice(0, 7).toUpperCase();
}

/**
 * @param {string} plainText
 * @param {Array<{ type?: string, value: string }>} entities
 * @returns {{ redactedText: string, map: Record<string, string> }}
 */
function buildRedactedPack(plainText, entities) {
  const map = {};
  let text = String(plainText ?? '');
  const list = (entities || [])
    .filter((e) => e && typeof e.value === 'string' && e.value.trim())
    .map((e) => ({ type: e.type || 'other', value: e.value.trim() }))
    .sort((a, b) => b.value.length - a.value.length);

  for (const ent of list) {
    const pref = TYPE_PREFIX[ent.type] || TYPE_PREFIX.other;
    let tok;
    let guard = 0;
    do {
      tok = `${pref}_${randomSuffix()}`;
      guard += 1;
    } while (map[tok] && guard < 50);
    if (map[tok]) continue;
    map[tok] = ent.value;
    const re = new RegExp(escapeRegExp(ent.value), 'g');
    text = text.replace(re, tok);
  }
  return { redactedText: text, map };
}

/**
 * Подстановка исходных значений в ответ модели (и в письма внутри контура).
 * @param {string} text
 * @param {Record<string, string>} map
 */
function detokenize(text, map) {
  if (!map || typeof map !== 'object') return String(text ?? '');
  let out = String(text ?? '');
  const tokens = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const t of tokens) {
    const val = map[t];
    if (val == null) continue;
    out = out.split(t).join(String(val));
  }
  return out;
}

module.exports = { buildRedactedPack, detokenize, TYPE_PREFIX };

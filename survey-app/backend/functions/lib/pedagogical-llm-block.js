const { chatCompletion } = require('./llm-chat');
const { detokenize, buildRedactedPack } = require('./pii-tokenize');
const { extractAutoPiiEntities } = require('./pii-auto-extract');

const SYSTEM_PEDAGOGICAL_REDACTED = `Ты — методист и аналитик данных образования.

Входные данные **псевдонимизированы**: токены вида УЧ_XXXXX, КЛ_XXXXX, РЕБ_XXXXX, ТЛФ_XXXXX, АДР_XXXXX, ПД_XXXXX — устойчивые замены персональных данных и контактов. **Не пытайся** восстановить реальные ФИО, телефоны и адреса. Опирайся только на токены и контекст.

**В промпт к тебе не передаётся** таблица соответствия токенов — её нет в запросе намеренно.

Правила ответа:
- Только **русский язык**.
- Сохраняй в ответе **те же токены**, где нужно сослаться на человека, класс или контакт; **не выдумывай** имена и номера.
- Структурируй текст для директора/завуча: выводы, риски, приоритеты — по содержанию входа.
- Не упоминай «модель», «API», «токенизацию», «LLM».

Ответь **одним связным текстом** (без JSON и без markdown-ограждений).`;

function mergeEntities(autoList, manualList) {
  const byVal = new Map();
  for (const e of autoList) {
    if (e && typeof e.value === 'string' && e.value.trim()) {
      byVal.set(e.value.trim(), e.type || 'other');
    }
  }
  for (const e of manualList) {
    if (e && typeof e.value === 'string' && e.value.trim()) {
      byVal.set(e.value.trim(), e.type || 'other');
    }
  }
  return [...byVal.entries()].map(([value, type]) => ({ type, value }));
}

/**
 * @param {string} blockPlain
 * @param {Array<{ type?: string, value: string }>} manualExtra
 * @param {number} maxTokens
 * @returns {Promise<{ ok: boolean, detail?: string, kind?: string, replyRedacted?: string, replyPlain?: string, map?: Record<string,string>, redactedText?: string, entities?: Array, autoEnt?: Array, provider?: string }>}
 */
async function runPedagogicalBlockLlm(blockPlain, manualExtra, maxTokens) {
  const plain = String(blockPlain ?? '').trim();
  if (!plain) {
    return { ok: false, detail: 'Пустой блок педагога', kind: 'empty_block' };
  }
  const autoEnt = extractAutoPiiEntities(plain);
  const entities = mergeEntities(autoEnt, manualExtra || []);
  const { redactedText, map } = buildRedactedPack(plain, entities);
  const mt = Math.min(Math.max(Number(maxTokens) || 3072, 256), 8000);

  const messages = [
    { role: 'system', content: SYSTEM_PEDAGOGICAL_REDACTED },
    {
      role: 'user',
      content: `Материал для анализа **одного** педагога (псевдонимы — сохраняй в ответе):\n\n${redactedText}`,
    },
  ];

  const llm = await chatCompletion(messages, { maxTokens: mt, temperature: 0.28 });
  if (!llm.ok) {
    return { ok: false, detail: llm.detail || 'Ошибка вызова модели', kind: llm.kind };
  }
  const replyRedacted = String(llm.text || '').trim();
  if (!replyRedacted) {
    return { ok: false, detail: 'Модель вернула пустой ответ', kind: 'llm_empty' };
  }
  const replyPlain = Object.keys(map).length ? detokenize(replyRedacted, map) : replyRedacted;
  return {
    ok: true,
    replyRedacted,
    replyPlain,
    map,
    redactedText,
    entities,
    autoEnt,
    provider: String(llm.provider || ''),
  };
}

function teacherLabelFromBlock(block, index) {
  const first = String(block).split('\n')[0] || '';
  const m = first.match(/^Педагог:\s*(.+)$/i);
  if (m) return m[1].trim().slice(0, 200);
  return `Педагог ${index + 1}`;
}

/**
 * Объединяет карты токенов; при коллизии ключа оставляет первое значение.
 * @param {Record<string,string>} a
 * @param {Record<string,string>} b
 */
function mergePiiMaps(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  if (!b || typeof b !== 'object') return out;
  for (const [k, v] of Object.entries(b)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function oneWorker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => oneWorker()));
  return results;
}

module.exports = {
  runPedagogicalBlockLlm,
  teacherLabelFromBlock,
  mergeEntities,
  mergePiiMaps,
  runPool,
  SYSTEM_PEDAGOGICAL_REDACTED,
};

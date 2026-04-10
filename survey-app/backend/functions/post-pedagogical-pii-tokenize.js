const { json, parseBody } = require('./lib/http');
const { buildRedactedPack } = require('./lib/pii-tokenize');
const { extractAutoPiiEntities } = require('./lib/pii-auto-extract');
const { requirePedagogicalAccess } = require('./pedagogical-analytics-sessions');

function entitiesLastWins(list) {
  const byVal = new Map();
  for (const e of list) {
    if (!e || typeof e.value !== 'string' || !e.value.trim()) continue;
    const v = e.value.trim();
    byVal.set(v, e.type || 'other');
  }
  return [...byVal.entries()].map(([value, type]) => ({ type, value }));
}

/**
 * POST body:
 *  - { plain, auto: true } — сущности извлекаются автоматически; опционально entities — доп. строки вручную.
 *  - { plain, entities: [...] } — только ручной список (редкий режим).
 * Ответ: { redactedText, map, entityCount, auto? } — map не отправляйте в LLM.
 */
async function handlePostPedagogicalPiiTokenize(_pool, user, viaAdminKey, sessionUser, event) {
  const denied = requirePedagogicalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const body = parseBody(event) || {};
  const plain = String(body.plain ?? '');
  const auto = body.auto === true;
  let entities = [];
  if (auto) {
    entities = extractAutoPiiEntities(plain);
    if (Array.isArray(body.entities)) {
      for (const e of body.entities) {
        if (e && typeof e.value === 'string' && e.value.trim()) {
          entities.push({ type: e.type || 'other', value: e.value.trim() });
        }
      }
    }
    entities = entitiesLastWins(entities);
  } else {
    entities = Array.isArray(body.entities) ? body.entities : [];
  }
  const { redactedText, map } = buildRedactedPack(plain, entities);
  return json(200, { redactedText, map, entityCount: entities.length, auto: auto || undefined });
}

module.exports = { handlePostPedagogicalPiiTokenize };

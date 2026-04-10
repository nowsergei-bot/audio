const { json, parseBody } = require('./lib/http');
const { chatCompletion } = require('./lib/llm-chat');
const { detokenize, buildRedactedPack } = require('./lib/pii-tokenize');
const { extractAutoPiiEntities } = require('./lib/pii-auto-extract');
const {
  mergePedagogicalState,
  requirePedagogicalAccess,
  resolvePedagogicalOwner,
} = require('./pedagogical-analytics-sessions');

const MAX_PLAIN_CHARS = 100_000;

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
 * POST …/pedagogical-analytics-sessions/:id/llm
 * Псевдонимизация **автоматическая** по исходному тексту; в провайдер уходит только redacted; piiMap не передаётся.
 * Body (опционально): sourcePlain, extraEntities [{type,value}], maxTokens
 */
async function handlePostPedagogicalAnalyticsLlm(pool, user, viaAdminKey, sessionUser, sessionId, event) {
  const denied = requirePedagogicalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolvePedagogicalOwner(user, viaAdminKey, sessionUser);

  const r =
    scope.apiKey === true
      ? await pool.query(`SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id IS NULL`, [
          sessionId,
        ])
      : await pool.query(
          `SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id = $2`,
          [sessionId, scope.userId],
        );
  if (!r.rows.length) return json(404, { error: 'Not found' });

  const row = r.rows[0];
  const state = mergePedagogicalState(row.state_json);
  const body = parseBody(event) || {};
  const manualExtra = Array.isArray(body.extraEntities) ? body.extraEntities : [];

  const blocksFromBody = Array.isArray(body.sourceBlocks)
    ? body.sourceBlocks.map((x) => String(x ?? '').trim()).filter(Boolean)
    : null;
  const blocksFromState =
    Array.isArray(state.sourceBlocks) && state.sourceBlocks.length
      ? state.sourceBlocks.map((x) => String(x ?? '').trim()).filter(Boolean)
      : null;
  const effectiveBlocks =
    blocksFromBody && blocksFromBody.length
      ? blocksFromBody
      : blocksFromState && blocksFromState.length
        ? blocksFromState
        : null;

  let plain;
  /** Сырые авто-сущности до merge с manualExtra (для метрики; при режиме блоков — сумма по педагогам). */
  let autoEnt;
  if (effectiveBlocks && effectiveBlocks.length) {
    plain = effectiveBlocks.join('\n\n');
    autoEnt = [];
    for (const block of effectiveBlocks) {
      autoEnt.push(...extractAutoPiiEntities(block));
    }
  } else {
    const plainFromBody = String(body.sourcePlain ?? '').trim();
    plain = plainFromBody || String(state.sourcePlain || '').trim();
    autoEnt = extractAutoPiiEntities(plain);
  }

  if (!plain) {
    return json(400, {
      error: 'empty_source',
      message:
        'Нет исходного текста: загрузите Excel, вставьте факты в поле «Исходные факты» и сохраните, либо передайте sourcePlain / sourceBlocks в теле запроса.',
    });
  }
  if (plain.length > MAX_PLAIN_CHARS) {
    return json(413, {
      error: 'payload_too_large',
      message: `Текст слишком длинный (>${MAX_PLAIN_CHARS} символов). Сократите или разбейте на части.`,
    });
  }

  const entities = mergeEntities(autoEnt, manualExtra);
  const { redactedText, map } = buildRedactedPack(plain, entities);
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 4096, 512), 8000);

  const messages = [
    { role: 'system', content: SYSTEM_PEDAGOGICAL_REDACTED },
    {
      role: 'user',
      content: `Материал для анализа (псевдонимы — сохраняй в ответе):\n\n${redactedText}`,
    },
  ];

  const llm = await chatCompletion(messages, { maxTokens, temperature: 0.28 });
  if (!llm.ok) {
    return json(502, {
      error: 'llm_failed',
      message: llm.detail || 'Ошибка вызова модели',
      kind: llm.kind,
    });
  }

  const replyRedacted = String(llm.text || '').trim();
  if (!replyRedacted) {
    return json(502, { error: 'llm_empty', message: 'Модель вернула пустой ответ.' });
  }

  const replyPlain = Object.keys(map).length ? detokenize(replyRedacted, map) : replyRedacted;

  const draftEntities = entities.slice(0, 120).map((e) => ({
    type: e.type || 'other',
    value: e.value,
  }));

  const next = {
    ...state,
    sourcePlain: plain,
    sourceBlocks: effectiveBlocks && effectiveBlocks.length ? effectiveBlocks : null,
    redactedSource: redactedText,
    piiMap: map,
    piiEntitiesDraft: draftEntities,
    piiAuto: {
      at: new Date().toISOString(),
      entityCount: entities.length,
      autoDetectedCount: autoEnt.length,
    },
    step: 'review',
    job: {
      ...state.job,
      status: 'done',
      done: Math.max(1, Number(state.job?.total) || 1),
      total: Math.max(1, Number(state.job?.total) || 1),
      error: null,
    },
    llmLast: {
      at: new Date().toISOString(),
      provider: String(llm.provider || ''),
      replyRedacted,
      replyPlain,
    },
  };
  const state_json = JSON.stringify(next);
  let updatedAt = new Date().toISOString();
  if (scope.apiKey === true) {
    const u = await pool.query(
      `UPDATE pedagogical_analytics_sessions SET state_json = $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id IS NULL RETURNING updated_at`,
      [state_json, sessionId],
    );
    if (u.rows[0]?.updated_at) updatedAt = u.rows[0].updated_at;
  } else {
    const u = await pool.query(
      `UPDATE pedagogical_analytics_sessions SET state_json = $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING updated_at`,
      [state_json, sessionId, scope.userId],
    );
    if (u.rows[0]?.updated_at) updatedAt = u.rows[0].updated_at;
  }

  return json(200, {
    ok: true,
    replyRedacted,
    replyPlain,
    provider: llm.provider,
    redactedSource: redactedText,
    pii_entity_count: entities.length,
    pii_auto_detected: autoEnt.length,
    session: { id: row.id, title: row.title, updated_at: updatedAt, state: next },
  });
}

module.exports = { handlePostPedagogicalAnalyticsLlm, MAX_PLAIN_CHARS };

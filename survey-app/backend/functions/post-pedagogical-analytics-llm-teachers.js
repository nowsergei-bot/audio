const { json, parseBody } = require('./lib/http');
const {
  runPedagogicalBlockLlm,
  teacherLabelFromBlock,
  mergePiiMaps,
  runPool,
} = require('./lib/pedagogical-llm-block');
const {
  mergePedagogicalState,
  requirePedagogicalAccess,
  resolvePedagogicalOwner,
} = require('./pedagogical-analytics-sessions');

const MAX_BLOCK_CHARS = 50_000;
/** Пакетный параллельный режим: не раздувать слишком (таймаут функции). */
const MAX_TEACHERS_BATCH = 28;
const DEFAULT_PARALLEL = 3;

function loadSessionQuery(pool, scope, sessionId) {
  if (scope.apiKey === true) {
    return pool.query(`SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id IS NULL`, [
      sessionId,
    ]);
  }
  return pool.query(`SELECT id, title, state_json FROM pedagogical_analytics_sessions WHERE id = $1 AND user_id = $2`, [
    sessionId,
    scope.userId,
  ]);
}

function getBlocks(body, state) {
  const fromBody = Array.isArray(body.sourceBlocks)
    ? body.sourceBlocks.map((x) => String(x ?? '').trim()).filter(Boolean)
    : null;
  const fromState =
    Array.isArray(state.sourceBlocks) && state.sourceBlocks.length
      ? state.sourceBlocks.map((x) => String(x ?? '').trim()).filter(Boolean)
      : null;
  if (fromBody && fromBody.length) return fromBody;
  if (fromState && fromState.length) return fromState;
  return null;
}

function initPendingSegments(blocks) {
  return blocks.map((b, i) => ({
    id: `seg-${i}`,
    teacher: teacherLabelFromBlock(b, i),
    genStatus: 'pending',
    sourceSnippet: String(b).slice(0, 280),
  }));
}

function normalizeSelectedIndices(raw, max) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    const i = Number(v);
    if (!Number.isFinite(i) || i < 0 || i >= max) continue;
    const n = Math.floor(i);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.length ? out : null;
}

function buildLlmLastAgg(segments, provider) {
  const done = segments.filter((s) => s && s.genStatus === 'done' && s.narrative);
  const replyPlain = done.map((s) => `## ${s.teacher}\n\n${s.narrative}`).join('\n\n');
  const replyRedacted = done.map((s) => `## ${s.teacher}\n\n${s.narrativeRedacted || ''}`).join('\n\n');
  return {
    at: new Date().toISOString(),
    provider: String(provider || ''),
    replyRedacted,
    replyPlain,
  };
}

async function persistState(pool, scope, sessionId, next) {
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
  return updatedAt;
}

/**
 * POST …/pedagogical-analytics-sessions/:id/llm-teacher
 * Один педагог по индексу в sourceBlocks. Тело: { index: number, restart?: boolean, sourceBlocks?, extraEntities?, maxTokens? }
 */
async function handlePostPedagogicalLlmTeacher(pool, user, viaAdminKey, sessionUser, sessionId, event) {
  const denied = requirePedagogicalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolvePedagogicalOwner(user, viaAdminKey, sessionUser);
  const r = await loadSessionQuery(pool, scope, sessionId);
  if (!r.rows.length) return json(404, { error: 'Not found' });

  const row = r.rows[0];
  const state = mergePedagogicalState(row.state_json);
  const body = parseBody(event) || {};
  const manualExtra = Array.isArray(body.extraEntities) ? body.extraEntities : [];
  const blocks = getBlocks(body, state);
  if (!blocks || !blocks.length) {
    return json(400, {
      error: 'no_blocks',
      message: 'Нужны блоки по педагогам: загрузите Excel на шаге «Факты» или передайте sourceBlocks.',
    });
  }
  const index = Number(body.index);
  if (!Number.isFinite(index) || index < 0 || index >= blocks.length) {
    return json(400, { error: 'bad_index', message: 'Укажите index от 0 до числа педагогов − 1.' });
  }

  for (const b of blocks) {
    if (String(b).length > MAX_BLOCK_CHARS) {
      return json(413, { error: 'block_too_large', message: `Блок педагога длиннее ${MAX_BLOCK_CHARS} символов.` });
    }
  }

  const block = blocks[index];
  const restart = body.restart === true;
  let segments = Array.isArray(state.segments) ? [...state.segments] : [];
  if (restart || !segments.length || segments.length !== blocks.length) {
    segments = initPendingSegments(blocks);
  }

  const maxTokens = body.maxTokens;
  const llm = await runPedagogicalBlockLlm(block, manualExtra, maxTokens);
  let piiMap = mergePiiMaps(state.piiMap, {});

  if (!llm.ok) {
    segments[index] = {
      ...segments[index],
      id: `seg-${index}`,
      teacher: teacherLabelFromBlock(block, index),
      genStatus: 'failed',
      genError: llm.detail || 'Ошибка ИИ',
      narrative: undefined,
      narrativeRedacted: undefined,
      sourceSnippet: String(block).slice(0, 280),
    };
    const done = segments.filter((s) => s && s.genStatus === 'done').length;
    const anyFailed = segments.some((s) => s && s.genStatus === 'failed');
    const settled =
      segments.length === blocks.length &&
      segments.every((s) => s && (s.genStatus === 'done' || s.genStatus === 'failed'));
    const next = {
      ...state,
      sourceBlocks: blocks,
      sourcePlain: blocks.join('\n\n'),
      segments,
      piiMap,
      step: 'review',
      job: {
        ...state.job,
        status: !settled ? 'running' : anyFailed ? 'failed' : 'done',
        done,
        total: blocks.length,
        error: llm.detail || 'Ошибка ИИ',
      },
      llmLast: buildLlmLastAgg(segments, llm.provider),
    };
    const updatedAt = await persistState(pool, scope, sessionId, next);
    return json(502, {
      error: 'llm_failed',
      message: llm.detail || 'Ошибка вызова модели',
      kind: llm.kind,
      session: { id: row.id, title: row.title, updated_at: updatedAt, state: next },
    });
  }

  piiMap = mergePiiMaps(state.piiMap, llm.map || {});
  segments[index] = {
    ...segments[index],
    id: `seg-${index}`,
    teacher: teacherLabelFromBlock(block, index),
    genStatus: 'done',
    narrative: llm.replyPlain,
    narrativeRedacted: llm.replyRedacted,
    sourceSnippet: String(block).slice(0, 280),
    genError: undefined,
  };

  const done = segments.filter((s) => s && s.genStatus === 'done').length;
  const anyFailed = segments.some((s) => s && s.genStatus === 'failed');
  const settled =
    segments.length === blocks.length &&
    segments.every((s) => s && (s.genStatus === 'done' || s.genStatus === 'failed'));
  const next = {
    ...state,
    sourceBlocks: blocks,
    sourcePlain: blocks.join('\n\n'),
    segments,
    piiMap,
    redactedSource: state.redactedSource,
    piiAuto: {
      at: new Date().toISOString(),
      entityCount: (llm.entities || []).length,
      autoDetectedCount: (llm.autoEnt || []).length,
    },
    step: 'review',
    job: {
      ...state.job,
      status: !settled ? 'running' : anyFailed ? 'failed' : 'done',
      done,
      total: blocks.length,
      error:
        settled && anyFailed
          ? segments.find((s) => s && s.genStatus === 'failed')?.genError || 'Часть педагогов с ошибкой'
          : null,
    },
    llmLast: buildLlmLastAgg(segments, llm.provider),
  };

  const updatedAt = await persistState(pool, scope, sessionId, next);
  return json(200, {
    ok: true,
    index,
    session: { id: row.id, title: row.title, updated_at: updatedAt, state: next },
  });
}

/**
 * POST …/pedagogical-analytics-sessions/:id/llm-teachers-batch
 * Параллельная обработка педагогов (пул).
 * Тело: { parallel?: number, sourceBlocks?, extraEntities?, maxTokens?, selectedIndices?: number[] }.
 * Если selectedIndices переданы, пересчитываются только указанные педагоги.
 */
async function handlePostPedagogicalLlmTeachersBatch(pool, user, viaAdminKey, sessionUser, sessionId, event) {
  const denied = requirePedagogicalAccess(user, viaAdminKey, sessionUser);
  if (denied) return denied;
  const scope = resolvePedagogicalOwner(user, viaAdminKey, sessionUser);
  const r = await loadSessionQuery(pool, scope, sessionId);
  if (!r.rows.length) return json(404, { error: 'Not found' });

  const row = r.rows[0];
  const state = mergePedagogicalState(row.state_json);
  const body = parseBody(event) || {};
  const manualExtra = Array.isArray(body.extraEntities) ? body.extraEntities : [];
  const blocks = getBlocks(body, state);
  if (!blocks || !blocks.length) {
    return json(400, {
      error: 'no_blocks',
      message: 'Нужны блоки по педагогам: загрузите Excel или передайте sourceBlocks.',
    });
  }
  if (blocks.length > MAX_TEACHERS_BATCH) {
    return json(400, {
      error: 'too_many_teachers',
      message: `Не более ${MAX_TEACHERS_BATCH} педагогов за один пакетный запрос (таймаут функции). Разбейте таблицу или используйте пошаговый режим.`,
    });
  }

  for (const b of blocks) {
    if (String(b).length > MAX_BLOCK_CHARS) {
      return json(413, { error: 'block_too_large', message: `Блок педагога длиннее ${MAX_BLOCK_CHARS} символов.` });
    }
  }

  const parallel = Math.min(
    5,
    Math.max(1, Math.floor(Number(body.parallel) || DEFAULT_PARALLEL)),
  );
  const maxTokens = body.maxTokens;
  const selectedIndices = normalizeSelectedIndices(body.selectedIndices, blocks.length);
  const targetIndices = selectedIndices || blocks.map((_, i) => i);
  if (!targetIndices.length) {
    return json(400, { error: 'empty_selection', message: 'Не выбраны педагоги для запуска.' });
  }
  if (targetIndices.length > MAX_TEACHERS_BATCH) {
    return json(400, {
      error: 'too_many_selected',
      message: `Не более ${MAX_TEACHERS_BATCH} педагогов за один пакетный запуск.`,
    });
  }

  const segments =
    Array.isArray(state.segments) && state.segments.length === blocks.length
      ? [...state.segments]
      : initPendingSegments(blocks);
  for (const i of targetIndices) {
    segments[i] = {
      ...(segments[i] || {}),
      id: `seg-${i}`,
      teacher: teacherLabelFromBlock(blocks[i], i),
      genStatus: 'pending',
      genError: undefined,
      sourceSnippet: String(blocks[i]).slice(0, 280),
    };
  }
  let piiMap = mergePiiMaps(state.piiMap, {});
  let lastProvider = '';

  const targetBlocks = targetIndices.map((i) => ({ i, block: blocks[i] }));
  const results = await runPool(targetBlocks, parallel, async (it) => {
    const i = Number(it.i);
    const block = String(it.block || '');
    const llm = await runPedagogicalBlockLlm(block, manualExtra, maxTokens);
    return { i, block, llm };
  });

  let anyFail = false;
  let lastErr = null;
  for (const { i, block, llm } of results) {
    if (llm.ok) {
      lastProvider = llm.provider || lastProvider;
      piiMap = mergePiiMaps(piiMap, llm.map || {});
      segments[i] = {
        id: `seg-${i}`,
        teacher: teacherLabelFromBlock(block, i),
        genStatus: 'done',
        narrative: llm.replyPlain,
        narrativeRedacted: llm.replyRedacted,
        sourceSnippet: String(block).slice(0, 280),
      };
    } else {
      anyFail = true;
      lastErr = llm.detail;
      segments[i] = {
        id: `seg-${i}`,
        teacher: teacherLabelFromBlock(block, i),
        genStatus: 'failed',
        genError: llm.detail || 'Ошибка ИИ',
        sourceSnippet: String(block).slice(0, 280),
      };
    }
  }

  const done = segments.filter((s) => s && s.genStatus === 'done').length;
  const next = {
    ...state,
    sourceBlocks: blocks,
    sourcePlain: blocks.join('\n\n'),
    segments,
    piiMap,
    step: 'review',
    job: {
      ...state.job,
      status: anyFail ? 'failed' : 'done',
      done: targetIndices.filter((i) => segments[i] && segments[i].genStatus === 'done').length,
      total: targetIndices.length,
      error: anyFail ? lastErr : null,
    },
    llmLast: buildLlmLastAgg(segments, lastProvider),
    piiAuto: {
      at: new Date().toISOString(),
      entityCount: done,
      autoDetectedCount: done,
    },
  };

  const updatedAt = await persistState(pool, scope, sessionId, next);
  return json(200, {
    ok: !anyFail,
    message: anyFail ? lastErr || 'Часть педагогов не обработана' : undefined,
    session: { id: row.id, title: row.title, updated_at: updatedAt, state: next },
  });
}

module.exports = {
  handlePostPedagogicalLlmTeacher,
  handlePostPedagogicalLlmTeachersBatch,
  MAX_TEACHERS_BATCH,
};

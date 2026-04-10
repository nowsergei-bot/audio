const { json, parseBody } = require('./lib/http');
const { chatCompletion } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

const CLUSTER_SYSTEM = `Ты аналитик отчёта по урокам. Во входе JSON: массив lessons — строки-«блоки» отчёта с полями:
- i — индекс блока (0, 1, 2, …), не меняй числа;
- code — шифр урока / класс (может быть с опечаткой, без пробела, другой регистр);
- led — ФИО ведущих педагогов;
- subj — предметы;
- obs — педагог-наблюдатель;
- notes — короткий фрагмент выводов педагога (до 200 символов).

Разные блоки могут описывать ОДИН И ТОТ ЖЕ урок, если шифр чуть отличается (опечатка, «СР-3» vs «СР 3», лишний пробел), но ведущие и контекст совпадают.

Задача: разбить все индексы i на группы — каждая группа = один реальный урок. Каждый i встречается ровно один раз.

Правила:
- Объединяй только если уверен, что это дубликат одного события (один урок, разные строки отчёта).
- Не объединяй разные уроки с разными ведущими и явно разным смыслом, даже если шифр похож.
- Консервативно: при сомнении оставь блоки раздельно.

Верни один JSON-объект (без markdown): {"groups":[[0],[1,3],[2]]} — groups массив массивов целых индексов i.`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableLlmFailure(res) {
  if (!res || res.ok) return false;
  const d = String(res.detail || res.kind || '');
  return (
    res.kind === 'network' ||
    /Пустой ответ|empty response|429|403|forbidden|rate limit|too many|лимит|timeout|ETIMEDOUT|ECONNRESET|free-models/i.test(
      d,
    )
  );
}

async function runClusterLlm(lessons, model) {
  const messages = [
    { role: 'system', content: CLUSTER_SYSTEM },
    {
      role: 'user',
      content: `Сгруппируй дубликаты уроков. Вход:\n${JSON.stringify({ lessons })}`,
    },
  ];

  let lastFail = { detail: 'LLM недоступна', provider: null };
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(450 + attempt * 500);
    }
    const res = await chatCompletion(messages, {
      model,
      maxTokens: 6000,
      temperature: attempt === 0 ? 0.1 : 0.2,
      jsonObject: true,
    });

    if (!res.ok || typeof res.text !== 'string') {
      lastFail = {
        detail: res.detail || res.kind || 'LLM недоступна',
        provider: res.provider || null,
      };
      if (attempt < maxAttempts - 1 && isRetryableLlmFailure(res)) {
        continue;
      }
      return { ok: false, ...lastFail };
    }

    const obj = tryParseLlmJsonObject(res.text);
    if (!obj || !Array.isArray(obj.groups)) {
      lastFail = { detail: 'Модель вернула неразборчивый JSON', provider: res.provider || null };
      if (attempt < maxAttempts - 1) {
        continue;
      }
      return { ok: false, ...lastFail };
    }
    return { ok: true, groups: obj.groups, provider: res.provider || null };
  }

  return { ok: false, ...lastFail };
}

function validateGroups(groups, n) {
  if (!Array.isArray(groups) || groups.length === 0) return false;
  const seen = new Set();
  for (const g of groups) {
    if (!Array.isArray(g) || g.length === 0) return false;
    for (const x of g) {
      const i = Number(x);
      if (!Number.isInteger(i) || i < 0 || i >= n) return false;
      if (seen.has(i)) return false;
      seen.add(i);
    }
  }
  return seen.size === n;
}

const CHUNK_SIZE = 72;

function lessonsPayload(blocksSlice) {
  return blocksSlice.map((b, bi) => ({
    i: bi,
    code: truncate(b.lessonCode ?? b.lesson_code ?? '', 64),
    led: truncate(b.conductingTeachers ?? b.conducting_teachers ?? '', 100),
    subj: truncate(b.subjects ?? '', 80),
    obs: truncate(b.observerName ?? b.observer_name ?? '', 80),
    notes: truncate(b.teacherNotes ?? b.teacher_notes ?? b.generalThoughts ?? '', 200),
  }));
}

/**
 * Длинные отчёты: несколько вызовов LLM по CHUNK_SIZE блоков (индексы глобальные в ответе).
 * Дубликаты на стыке двух порций могут не слиться — см. warning в ответе.
 */
async function clusterAllBlocks(blocks, model) {
  const n = blocks.length;
  if (n <= CHUNK_SIZE) {
    const res = await runClusterLlm(lessonsPayload(blocks), model);
    if (!res.ok) {
      return {
        ok: false,
        detail: res.detail,
        provider: res.provider || null,
      };
    }
    if (!validateGroups(res.groups, n)) {
      return {
        ok: false,
        detail:
          'Модель вернула некорректное разбиение на группы (повтор или пропуск индексов). Попробуйте ещё раз или объедините блоки вручную.',
        provider: res.provider || null,
      };
    }
    return {
      ok: true,
      groups: res.groups,
      provider: res.provider || null,
      chunked: false,
      warning: null,
    };
  }

  const allGroups = [];
  let lastProvider = null;
  for (let base = 0; base < n; base += CHUNK_SIZE) {
    const slice = blocks.slice(base, base + CHUNK_SIZE);
    const res = await runClusterLlm(lessonsPayload(slice), model);
    lastProvider = res.provider || lastProvider;
    if (!res.ok) {
      const from = base + 1;
      const to = Math.min(base + CHUNK_SIZE, n);
      return {
        ok: false,
        detail: `${res.detail} (порция блоков ${from}–${to} из ${n}; при повторе обычно проходит со 2–3 раза)`,
        provider: lastProvider,
      };
    }
    if (!validateGroups(res.groups, slice.length)) {
      return {
        ok: false,
        detail:
          'Модель вернула некорректное разбиение на группы (повтор или пропуск индексов). Попробуйте ещё раз или объедините блоки вручную.',
        provider: lastProvider,
      };
    }
    for (const g of res.groups) {
      allGroups.push(g.map((localIdx) => localIdx + base));
    }
  }

  return {
    ok: true,
    groups: allGroups,
    provider: lastProvider,
    chunked: true,
    warning:
      'Черновик большой: ИИ обрабатывал блоки порциями по 72. Дубликаты на границе порций могли не объединиться — при необходимости нажмите кнопку ещё раз после правок или сведите блоки вручную.',
  };
}

/**
 * POST { blocks: [{ lessonCode, conductingTeachers, subjects, observerName, teacherNotes? }, ...] }
 * → { groups: [[0,1],[2]], llm_provider, warning? }
 */
async function handlePostPhenomenalLessonsClusterReportBlocks(_pool, event) {
  const body = parseBody(event) || {};
  const blocks = body.blocks;
  if (!Array.isArray(blocks) || blocks.length < 2) {
    return json(400, { error: 'Нужен массив blocks из минимум 2 элементов' });
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const out = await clusterAllBlocks(blocks, model);
  if (!out.ok) {
    return json(502, {
      error: 'llm_failed',
      message: out.detail || 'Ошибка нейросети',
      llm_provider: out.provider || null,
    });
  }

  const payload = {
    groups: out.groups,
    llm_provider: out.provider || null,
  };
  if (out.warning) {
    payload.warning = out.warning;
  }
  if (out.chunked) {
    payload.chunked = true;
  }
  return json(200, payload);
}

module.exports = { handlePostPhenomenalLessonsClusterReportBlocks };

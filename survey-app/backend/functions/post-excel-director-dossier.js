const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

const MAX_PACKETS = 8;
const MAX_FACTS_LEN = 5500;

async function fetchDossierFromLlm(packets, sharedCodebook) {
  const codebook = truncate(String(sharedCodebook || '').trim(), 4500);
  const compact = packets.map((p) => ({
    segmentId: String(p.segmentId ?? '').slice(0, 80),
    teacher: truncate(p.teacher, 200),
    subject: p.subject != null && String(p.subject).trim() ? truncate(p.subject, 240) : null,
    factsSummary: truncate(p.factsSummary, MAX_FACTS_LEN),
  }));

  const system = `Ты готовишь развёрнутые аналитические записки для директора школы по данным из Excel (структура файла каждый раз может быть другой: уроки, опросы, анкеты).
В запросе — массив сегментов. В каждом сегменте factsSummary — **единственный источник фактов, цифр и выдержек**. Поля teacher и subject — кому адресован текст.
${
  codebook
    ? `Если в блоке [СПРАВОЧНИК ШИФР→ФИО] перечислены пары «код — полное имя», используй их: в тексте записки можно указывать ФИО рядом с кодом или вместо кода, если это уместно для директора. Не придумывай ФИО, которых нет в справочнике.\n`
    : ''
}

Для **каждого** сегмента напиши на русском **содержательный меморандум**, не дословный перенос буллетов из factsSummary:
- вступление: контекст сегмента, объём выборки, что именно оценивается;
- разбор цифр и шкалы: сопоставление пунктов между собой, акценты сильных и слабых зон **в рамках этих же цифр**;
- смысл текстовых выдержек для управленческой практики;
- выводы и ориентиры для руководителя.

Объём: ориентир **не меньше 320 слов на сегмент**, если в factsSummary достаточно материала; если данных мало — короче, но всё равно связный аналитический текст, а не список строк.

Жёсткие правила:
- Не добавляй факты, цифры и цитаты вне factsSummary данного сегмента.
- Не смешивай сегменты.
- Без markdown и без таблиц в тексте.

Ответь ОДНИМ JSON-объектом вида {"items":[{"segmentId":"…","narrative":"…"}, …]}.
Каждый segmentId из входного списка — **ровно один раз**.`;

  const userBlock =
    (codebook ? `[СПРАВОЧНИК ШИФР→ФИО — общий для всех сегментов]\n${codebook}\n\n` : '') +
    `[СЕГМЕНТЫ — JSON]\n${JSON.stringify(compact, null, 0)}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userBlock },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 8000,
        temperature: 0.38,
        jsonObject: true,
      },
    );
    if (!res.ok) {
      if (res.kind === 'no_key') return { kind: 'no_key' };
      const detail =
        res.kind === 'both_failed'
          ? res.detail
          : isOpenAiUnsupportedRegion(res.status, res.detail)
            ? formatGeoBlockHint(res.status, res.detail)
            : res.detail;
      return { kind: 'openai_error', detail };
    }
    const parsed = tryParseLlmJsonObject(res.text);
    if (!parsed || !Array.isArray(parsed.items)) {
      return { kind: 'openai_error', detail: 'В JSON нет массива items' };
    }
    const expected = new Set(compact.map((c) => c.segmentId));
    const out = [];
    for (const row of parsed.items) {
      const segmentId = typeof row.segmentId === 'string' ? row.segmentId.trim() : '';
      const narrative = typeof row.narrative === 'string' ? row.narrative.trim() : '';
      if (!segmentId || !expected.has(segmentId)) continue;
      if (narrative.length < 200) continue;
      out.push({ segmentId, narrative: narrative.slice(0, 20000) });
    }
    if (out.length === 0) {
      return { kind: 'openai_error', detail: 'Пустой или несовпадающий массив items' };
    }
    return { kind: 'ok', items: out };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelDirectorDossier(_pool, event) {
  const body = parseBody(event) || {};
  const packetsIn = Array.isArray(body.packets) ? body.packets : [];
  if (packetsIn.length === 0) {
    return json(400, { error: 'Нужен непустой массив packets.' });
  }
  if (packetsIn.length > MAX_PACKETS) {
    return json(400, { error: `Не более ${MAX_PACKETS} сегментов за один запрос.` });
  }

  const packets = packetsIn.map((p, i) => ({
    segmentId: String(p.segmentId ?? `seg_${i}`).slice(0, 80),
    teacher: String(p.teacher ?? '').trim() || '—',
    subject: p.subject != null && String(p.subject).trim() ? String(p.subject).trim() : null,
    factsSummary: String(p.factsSummary ?? '').trim(),
  }));

  for (const p of packets) {
    if (!p.factsSummary) {
      return json(400, { error: 'У каждого пакета должно быть непустое factsSummary.' });
    }
  }

  const sharedCodebook = body.sharedCodebook != null ? String(body.sharedCodebook) : '';
  const llm = await fetchDossierFromLlm(packets, sharedCodebook);
  if (llm.kind === 'ok') {
    return json(200, { source: 'llm', items: llm.items });
  }

  return json(200, {
    source: 'fallback',
    items: null,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM: задайте DEEPSEEK_API_KEY + LLM_PROVIDER=deepseek, или OPENAI_API_KEY, или YANDEX_* для YandexGPT (см. BACKEND_AND_API.md).'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelDirectorDossier };

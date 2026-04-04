const { json, parseBody } = require('./lib/http');
const { chatCompletion, isOpenAiUnsupportedRegion, formatGeoBlockHint } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function wordCountRu(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildSystemStandard() {
  return `Ты — ведущий эксперт по анализу данных наблюдений за уроками и методической работы школы. Ниже — **расширенная выгрузка фактов** из Excel (любая структура файла: уроки, опросы, ведомости). Твой текст читает **директор или завуч** — нужен уровень глубины и полноты, как в профессиональном комплексном аналитическом отчёте (аналог развёрнутого отчёта нейросети по большой таблице наблюдений).

Задача: написать **единый связный документ на русском**. Глубина по ситуации: при большой базе — развёрнуто и по разделам ниже; при малой выборке — короче, но по делу. Это **не** копипаст входного текста подряд и не перечисление строк Excel — а смысловая переработка: интерпретация, сопоставления, приоритеты, выводы для управления. При малой выборке честно укажи ограниченность данных, но сохрани экспертный тон.

**Обязательная структура** (разделы обозначь в тексте явными заголовками строками, без символа #):
Первая строка — заголовок всего отчёта, например: «Комплексный анализ наблюдений по текущей выборке данных».

Далее по смыслу включи разделы (пропускай только то, чего нет во входных фактах):
1) Общая характеристика выборки: объём, период, логика данных (наблюдения, критерии).
2) Числовые критерии: что показывают средние и разброс; какие пункты выделяются; взаимное сопоставление критериев **только по тем цифрам, что даны**.
3) Если во входе есть распределение по текстовой шкале / уровню мастерства — отдельный раздел с интерпретацией долей и последствий для школы.
4) Срезы по полям (класс, предмет, параллель, формат и т.д., если они есть в выгрузке): где сосредоточены наблюдения, на что обратить внимание руководству.
5) Если во входе или в блоке «средние по наставникам» есть шифры/коды педагогов — **сравнительный аналитический разбор**: кто стабильно выше или ниже среднего по пунктам, типичные профили, зоны внимания. Тон нейтральный, деловой, без оценочных ярлыков личности.
6) Смысл текстовых выводов, резюме и рекомендаций из выборки (по выдержкам): повторяющиеся темы, риски, сильные практики.
7) Итог: выводы для директора, приоритеты работы администрации и методслужбы, что мониторить дальше.

Достоверность:
- Любая цифра, шифр, класс, предмет, цитата — **только из входного текста**. Новых фактов не добавлять.
- Если во входе есть блок «СПРАВОЧНИК: соответствие кода/шифра и ФИО» — используй его, чтобы называть педагогов по имени там, где это уместно; **не придумывай** ФИО, которых нет в справочнике или в самих данных.
- Можно обобщать, группировать, объяснять смысл и давать осторожные управленческие рекомендации **на основе уже данных фактов**.

Ответь ОДНИМ JSON-объектом: {"narrative":"..."} — в narrative только готовый текст отчёта. Без markdown вокруг JSON.`;
}

function buildSystemDeep() {
  return `Ты — ведущий методический и управленческий аналитик школы. Тебе передали **полную машинную выгрузку** по **уже отфильтрованной** выборке из Excel: пользователь задал параметры среза через фильтры дашборда (см. блок «ПАРАМЕТРЫ СРЕЗА», если он есть). Твоя задача — дать **полный разбор** (уровень сильной модели вроде DeepSeek): связно, структурировано, с перекрёстными сопоставлениями и приоритизацией для директора/завуча.

Объём **не фиксирован**: при большой базе разворачивай все уместные разделы; при малой — короче, без воды. Не копируй сырой JSON и не перечисляй строки таблицы подряд — перерабатывай смысл. При малой выборке явно опиши ограничения обобщения.

**Обязательная структура** (заголовки разделов — отдельными строками, без #):
1) **Параметры анализа** — что именно попало в срез (фильтры, объём: уникальные уроки vs строки развёртки, если это дано во входе). Одним абзацем зафиксируй «рамку», в которой читать весь отчёт.
2) **Картина по числовым критериям** — профиль сильных/слабых пунктов, разброс, взаимные несоответствия между критериями **только по цифрам из выгрузки**.
3) **Шкала / уровень** (если есть в данных) — доли, что они значат для практики и для управления качеством.
4) **Срезы** (класс, предмет, формат, прочие фильтры из выгрузки) — где сосредоточена масса наблюдений, аномалии, «узкие места» выборки.
5) **Наставники / коды** (если есть средние по наставникам или шифры) — сравнительный разбор без ярлыков личности; профили и зоны внимания.
6) **Текстовые выводы и рекомендации из таблицы** — темы, риски, устойчивые формулировки из выдержек.
7) **Перекрёстный синтез** — 5–10 тезисов, где ты **сводишь вместе** цифры, срезы и тексты (только из фактов).
8) **Риски интерпретации** — что может искажать картину при данном срезе (например, перекос по предметам/классам), **без выдуманных цифр**.
9) **Итог для руководства** — приоритеты, что усилить, что мониторить при следующем цикле.

Достоверность: любые цифры и цитаты — **только из входного текста**; справочник шифр→ФИО использовать как в стандартном режиме; не придумывать факты.

Ответь ОДНИМ JSON-объектом: {"narrative":"..."}. Без markdown вокруг JSON.`;
}

async function fetchNarrativeFromLlm(context) {
  const modeRaw = String(context.analysisMode || 'standard').toLowerCase();
  const isDeep = modeRaw === 'deep' || modeRaw === 'full';

  const summary = truncate(context.numericSummary || '', isDeep ? 24000 : 22000);
  const extra = truncate(context.extraContext || '', isDeep ? 16000 : 14000);
  const labels = truncate(JSON.stringify(context.facetLabels || {}), 8000);
  const filterSummary = truncate(String(context.filterSummary || '').trim(), 4500);
  const userFocus = truncate(String(context.userFocus || '').trim(), 2800);
  const meta = context.meta && typeof context.meta === 'object' ? context.meta : {};
  const nRows = Number(meta.filteredRowCount);
  const nUnique = Number(meta.uniqueLessonCount);
  const smallSample = Number.isFinite(nRows) && nRows > 0 && nRows < 22;

  const system = isDeep ? buildSystemDeep() : buildSystemStandard();

  const volLine = [
    Number.isFinite(nRows) ? `Строк аналитики в срезе (после фильтров): ${nRows}` : null,
    Number.isFinite(nUnique) ? `Уникальных уроков (строк Excel) в срезе: ${nUnique}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  const userBlock = `[СЛУЖЕБНО — объём выборки]
${volLine || 'Объём среза см. в сводке ниже.'} ${smallSample ? 'Выборка небольшая: формулировки осторожные.' : ''}
${isDeep ? 'Режим: полный глубокий разбор текущего среза (параметры заданы фильтрами дашборда).' : ''}

${filterSummary ? `[ПАРАМЕТРЫ СРЕЗА — заданы пользователем фильтрами таблицы]\n${filterSummary}\n` : ''}
${userFocus ? `[ДОПОЛНИТЕЛЬНЫЙ ФОКУС ОТ ПОЛЬЗОВАТЕЛЯ]\n${userFocus}\n` : ''}
[МАШИННАЯ СВОДКА — единственный источник фактов]
${summary}
${extra ? `\n[ДОПОЛНИТЕЛЬНО — средние по наставникам и пунктам]\n${extra}` : ''}
${labels && labels !== '{}' ? `\n[Подписи фильтров для контекста]\n${labels}` : ''}`;

  try {
    const res = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userBlock },
      ],
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: 8192,
        temperature: isDeep ? 0.46 : 0.42,
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
    if (!parsed) {
      return { kind: 'openai_error', detail: 'Ответ не JSON' };
    }
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';
    if (!narrative) {
      return { kind: 'openai_error', detail: 'В JSON нет поля narrative или оно пустое' };
    }
    const wc = wordCountRu(narrative);
    const maxLen = isDeep ? 52000 : 36000;
    return { kind: 'ok', narrative: narrative.slice(0, maxLen), wordCount: wc, mode: isDeep ? 'deep' : 'standard' };
  } catch (e) {
    return { kind: 'openai_error', detail: String(e?.message || e) };
  }
}

async function handlePostExcelNarrativeSummary(_pool, event) {
  const body = parseBody(event) || {};
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const numericSummary = String(context.numericSummary ?? '').trim();
  if (!numericSummary) {
    return json(400, { error: 'Нужен context.numericSummary (непустая строка).' });
  }

  const llm = await fetchNarrativeFromLlm(context);
  if (llm.kind === 'ok') {
    return json(200, {
      source: 'llm',
      narrative: llm.narrative,
      wordCount: llm.wordCount,
      analysisMode: llm.mode,
    });
  }

  return json(200, {
    source: 'fallback',
    narrative: null,
    hint:
      llm.kind === 'no_key'
        ? 'Нет ключей LLM: задайте DEEPSEEK_API_KEY + LLM_PROVIDER=deepseek, или OPENAI_API_KEY, или YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY (см. BACKEND_AND_API.md).'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelNarrativeSummary };

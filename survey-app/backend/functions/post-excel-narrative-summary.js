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
  return `Ты — методический и управленческий аналитик. Ниже — **факты** из опроса или таблицы наблюдений (Excel). Текст читает **директор или завуч**: живой русский язык, без канцелярита про «систему» и без пересказа служебных пометок из выгрузки.

**Стиль и запреты (обязательно):**
- Пиши **только по-русски**, без английских вставок (никаких «unanimous», «dashboard» и т.п.).
- **Не** упоминай: строки Excel, схлопывание дубликатов, развёртку ячеек, «аналитические строки», «idx», «импорт», «дашборд», «машинная сводка», API, модель.
- **Не** называй пункты «вопрос 3», «вопрос 14» — используй **короткие формулировки из названий столбцов** (как в фактах), без нумерации анкеты.
- Числа в тексте: **округляй разумно** (обычно до одного знака после запятой или целые проценты). **Не** копируй длинные дроби вроде 4,58955223880597 — если такое есть во входе, скажи «единичные странные значения» или «около 4,6».
- Если во входе **нет** достоверного календарного периода или явно сказано, что даты недостоверны — **не выдумывай даты**; опиши выборку без календаря («в текущей выборке ответов родителей…»).
- Служебные заголовки вроде «ПАРАМЕТРЫ СРЕЗА» не цитируй; переформулируй: «в выборке учтены ответы по темам…», «отбор по полям анкеты…».

Задача: **единый связный документ** — интерпретация и выводы для управления, не копипаст фактов списком. При малой выборке — короче, с оговоркой об ограниченности.

**Структура** (заголовки разделов — отдельными строками, без #):
Первая строка — заголовок отчёта (нейтральный, по делу).

Далее по смыслу (пропускай отсутствующее):
1) Что за выборка и объём (человечески: сколько ответов/анкет, без технологий подсчёта).
2) Баллы и шкалы: о чём говорят средние и разброс; что сильнее/слабее **только по данным**.
3) Текстовая шкала (если есть): доли, смысл для практики.
4) Разрезы по темам анкеты (класс, предмет и т.д. — **если они явно есть** в фактах); если в данных нет класса/предмета — так и скажи коротко, без фантазий.
5) Педагоги по кодам/шифрам (если есть): сравнение нейтральное, без ярлыков личности.
6) Смысл открытых ответов и рекомендаций из таблицы: темы, риски, сильные стороны.
7) Итог: 3–6 приоритетов для администрации и методслужбы; что отслеживать дальше — **без** перечисления «мониторить вопросы 3, 7, 9»; формулируй по смыслу критерия.

Достоверность: цифры и цитаты — только из входа; ФИО педагогов — только из справочника шифр→ФИО или из данных, не выдумывать.

Ответь ОДНИМ JSON-объектом: {"narrative":"..."} — в narrative только готовый текст отчёта. Без markdown вокруг JSON.`;
}

function buildSystemDeep() {
  return `Ты — методический и управленческий аналитик. Тебе даны **факты по отобранной выборке** из таблицы (опрос, наблюдения). Пользователь мог сузить выборку по полям анкеты — если в начале есть описание отбора, кратко объясни читателю **обычным языком**, без слов «дашборд», «фильтры интерфейса», «строки Excel».

Те же **стиль и запреты**, что в стандартном режиме: только русский; не тиражировать технический жаргон выгрузки; не нумеровать «вопрос N» — использовать названия критериев из фактов; не копировать длинные дроби; не указывать календарный период, если во входе нет правдоподобных дат или явно сказано об ошибке дат.

Задача — **полный разбор** для директора/завуча: связно, с перекрёстными сопоставлениями и приоритетами. Не перечисляй факты подряд — осмысляй. При малой выборке — короче, с ограничениями обобщения.

**Структура** (заголовки — отдельными строками, без #):
1) Рамка: что за ответы в выборке и объём (по-человечески).
2) Числовые критерии: сильные и слабые места, разброс — только по данным.
3) Текстовая шкала (если есть).
4) Разрезы по полям анкеты (если есть в фактах); иначе — одна честная фраза, без выдуманных измерений.
5) Педагоги по шифрам (если есть) — нейтрально.
6) Открытые ответы и смысл рекомендаций из таблицы.
7) Синтез: 5–10 тезисов, где сходятся цифры, темы и тексты (только факты).
8) Риски интерпретации (перекосы выборки — без новых цифр).
9) Итог: приоритеты и что отслеживать — **формулировки по смыслу критериев**, не «мониторить вопросы 3, 7, 9».

Достоверность: цифры и цитаты только из входа; ФИО — только из справочника или данных.

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
  const nPoints = Number(meta.filteredRowCount);
  const nImport = Number(meta.uniqueImportRows ?? meta.uniqueLessonCount);
  const nSemantic = Number(meta.semanticLessonCount);
  const smallSample =
    (Number.isFinite(nImport) && nImport > 0 && nImport < 22) ||
    (!Number.isFinite(nImport) && Number.isFinite(nPoints) && nPoints > 0 && nPoints < 22);

  const system = isDeep ? buildSystemDeep() : buildSystemStandard();

  const volLine = [
    Number.isFinite(nImport) ? `Уникальных записей в таблице после отбора: ${nImport}` : null,
    Number.isFinite(nPoints) ? `Аналитических строк после развёртки мультизначений: ${nPoints}` : null,
    Number.isFinite(nSemantic) ? `Событий по смыслу (дата и срезы без наставника/опроса): ${nSemantic}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  const userBlock = `[Служебно — объём; не цитируй дословно в отчёте, переформулируй для директора]
${volLine || 'Объём см. в блоке фактов ниже.'} ${smallSample ? 'Выборка небольшая — формулировки осторожные.' : ''}
${isDeep ? 'Запрошен развёрнутый разбор текущей выборки.' : ''}

${filterSummary ? `[Как сузили выборку — переформулируй для читателя, без жаргона]\n${filterSummary}\n` : ''}
${userFocus ? `[Фокус пользователя]\n${userFocus}\n` : ''}
[Факты — единственный источник цифр и цитат]
${summary}
${extra ? `\n[Дополнительно: средние по педагогам и пунктам]\n${extra}` : ''}
${labels && labels !== '{}' ? `\n[Подписи полей]\n${labels}` : ''}`;

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
        ? 'Нет ключей LLM на функции: OPENAI_API_KEY + для OpenRouter OPENAI_BASE_URL=https://openrouter.ai/api/v1 (и LLM_PROVIDER=openai), либо DEEPSEEK_API_KEY, либо YANDEX_CLOUD_FOLDER_ID + YANDEX_API_KEY. После правок — новая версия функции. См. BACKEND_AND_API.md.'
        : truncate(llm.detail, 1200),
  });
}

module.exports = { handlePostExcelNarrativeSummary };

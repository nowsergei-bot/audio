const { json, parseBody } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchTextAnswersPage } = require('./lib/fetch-text-answers');
const { truncate } = require('./lib/insight-dashboard');

const MAX_ANSWERS = 400;
const PAGE = 120;

/** Собираем все непустые тексты по одному вопросу (пагинация как в text-answers). */
async function collectTextsForQuestion(pool, surveyId, questionId) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await fetchTextAnswersPage(pool, surveyId, {
      question_id: questionId,
      limit: PAGE,
      offset,
      q: undefined,
    });
    if (page.error) return { texts: [], error: page.error };
    for (const row of page.rows) {
      const t = String(row.text || '').trim();
      if (t) out.push(t);
      if (out.length >= MAX_ANSWERS) return { texts: out };
    }
    if (page.rows.length < PAGE || offset + page.rows.length >= (page.total ?? 0)) break;
    offset += PAGE;
  }
  return { texts: out };
}

const STOP_RU = new Set([
  'и',
  'в',
  'во',
  'не',
  'на',
  'с',
  'со',
  'по',
  'для',
  'как',
  'что',
  'а',
  'о',
  'об',
  'от',
  'из',
  'к',
  'ко',
  'у',
  'же',
  'ли',
  'бы',
  'это',
  'то',
  'так',
  'или',
  'за',
  'но',
  'до',
  'при',
  'над',
  'под',
  'есть',
  'было',
  'будет',
  'без',
  'мы',
  'вы',
  'они',
  'он',
  'она',
  'их',
  'им',
  'все',
  'всё',
]);

function buildHeuristicCompilation(questionTitle, texts) {
  if (!texts.length) {
    return {
      summary:
        'Нет непустых текстовых ответов для обобщения (проверьте формат данных или откройте полный список ответов).',
      top_terms: [],
    };
  }
  const n = texts.length;
  const freq = new Map();
  for (const t of texts) {
    const parts = t.toLowerCase().split(/[^\p{L}\p{N}+-]+/u);
    for (const w of parts) {
      if (w.length < 3 || STOP_RU.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const topTerms = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([w, c]) => ({ word: w, count: c }));

  const longest = [...texts].sort((a, b) => b.length - a.length).slice(0, 3);
  const termLine =
    topTerms.length > 0 ? topTerms.map((x) => `«${x.word}» (${x.count})`).join(', ') : '—';

  const summary = [
    `По вопросу «${truncate(questionTitle, 140)}» учтено ${n} развёрнутых ответ(ов).`,
    `Повторяющиеся смысловые маркеры (слова): ${termLine}.`,
    longest.length
      ? `Примеры наиболее развёрнутых формулировок:\n${longest.map((s, i) => `${i + 1}. ${truncate(s, 320)}`).join('\n')}`
      : '',
    'Это автоматическая сводка по частотам и длине текста; выводы с формулировкой причин и рекомендаций — в блоке нейросети (если ключ задан на функции).',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { summary, top_terms: topTerms };
}

async function fetchLlmCompilation(questionTitle, texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxItems = 60;
  const maxLen = 480;
  const numbered = texts.slice(0, maxItems).map((t, i) => {
    const body = t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
    return `${i + 1}. ${body}`;
  });

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Ты аналитик опросов. Пиши только по-русски. На входе — ответы респондентов на один открытый вопрос.\n' +
          'Сделай:\n' +
          '1) «Компиляция»: 3–6 предложений — обобщи основные темы, повторяющиеся мотивы, типичные просьбы или оценки.\n' +
          '2) «Логический вывод»: 2–4 предложения — что из этого следует для организатора (приоритеты, риски, что уточнить дальше).\n' +
          'Не пересказывай каждый ответ по отдельности. Не выдумывай факты, которых нет в выборке. ' +
          'Без вступлений про ИИ и нейросеть.',
      },
      {
        role: 'user',
        content:
          `Вопрос опроса:\n${truncate(questionTitle, 500)}\n\n` +
          `Ответы (${Math.min(texts.length, maxItems)} из ${texts.length}, нумерация для ориентира):\n${numbered.join('\n\n')}`,
      },
    ],
    max_tokens: 1200,
    temperature: 0.35,
  };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function handlePostTextQuestionInsights(pool, surveyId, event) {
  const body = parseBody(event) || {};
  const qid = Number(body.question_id);
  if (!Number.isFinite(qid)) {
    return json(400, { error: 'question_id (number) required' });
  }

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return json(404, { error: 'Not found' });

  const q = survey.questions.find((x) => Number(x.id) === qid);
  if (!q) return json(404, { error: 'Question not found' });
  if (q.type !== 'text') {
    return json(400, { error: 'Question is not a text (free response) type' });
  }

  const { texts, error } = await collectTextsForQuestion(pool, surveyId, qid);
  if (error === 'BAD_QUESTION') return json(400, { error: 'Invalid text question' });

  const heur = buildHeuristicCompilation(q.text || '', texts);
  let narrative = null;
  let source = 'heuristic';
  if (process.env.OPENAI_API_KEY && texts.length > 0) {
    narrative = await fetchLlmCompilation(q.text || '', texts);
    if (narrative) source = 'llm_hybrid';
  }

  return json(200, {
    source,
    question_id: qid,
    question_text: q.text,
    answers_used: texts.length,
    heuristic_summary: heur.summary,
    top_terms: heur.top_terms,
    narrative,
  });
}

module.exports = { handlePostTextQuestionInsights };

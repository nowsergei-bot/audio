const { json } = require('./lib/http');
const { loadSurveyWithQuestions } = require('./get-survey');
const { fetchChartAggregates } = require('./lib/results-charts');
const { buildWordCloudFromTexts } = require('./lib/text-word-cloud');
const { parseJsonbText } = require('./lib/fetch-text-answers');

function pickTextHighlight(strings) {
  const byKey = new Map();
  for (const s of strings) {
    const t = String(s ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!byKey.has(k) || t.length > byKey.get(k).length) byKey.set(k, t);
  }
  return [...byKey.values()].sort((a, b) => b.length - a.length).slice(0, 8);
}

function normalizeOtherLabel(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^другое\s*:/i.test(s) ? 'Другое' : s;
}

function aggregateForQuestion(question, rows) {
  const { id, type, text } = question;
  const qid = Number(id);
  const base = { question_id: qid, type, text, response_count: rows.length };

  if (type === 'radio') {
    const counts = {};
    for (const r of rows) {
      const v = normalizeOtherLabel(r.value != null ? String(r.value) : '');
      counts[v] = (counts[v] || 0) + 1;
    }
    return {
      ...base,
      distribution: Object.entries(counts).map(([label, count]) => ({ label, count })),
    };
  }

  if (type === 'date') {
    const counts = {};
    for (const r of rows) {
      const v = String(r.value ?? '').trim().slice(0, 10);
      if (!v) continue;
      counts[v] = (counts[v] || 0) + 1;
    }
    return {
      ...base,
      distribution: Object.entries(counts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    };
  }

  if (type === 'checkbox') {
    const counts = {};
    for (const r of rows) {
      const arr = Array.isArray(r.value) ? r.value : [];
      for (const x of arr) {
        const v = normalizeOtherLabel(String(x));
        counts[v] = (counts[v] || 0) + 1;
      }
    }
    return {
      ...base,
      distribution: Object.entries(counts).map(([label, count]) => ({ label, count })),
    };
  }

  if (type === 'scale' || type === 'rating') {
    const nums = rows.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
    const sum = nums.reduce((a, b) => a + b, 0);
    const hist = {};
    for (const n of nums) {
      const k = String(n);
      hist[k] = (hist[k] || 0) + 1;
    }
    return {
      ...base,
      average: nums.length ? sum / nums.length : null,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      distribution: Object.entries(hist)
        .map(([label, count]) => ({ label: Number(label), count }))
        .sort((a, b) => a.label - b.label),
    };
  }

  if (type === 'text') {
    const strings = rows
      .map((r) => parseJsonbText(r.value).trim())
      .filter(Boolean);
    return {
      ...base,
      samples: strings,
      samples_highlight: pickTextHighlight(strings),
      samples_total: strings.length,
    };
  }

  return base;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} surveyId
 * @param {{ forPublicApi?: boolean; responseIds?: Set<number> | null }} [opts]
 * responseIds: null/undefined — все ответы; пустой Set — нет строк; непустой Set — только эти response id
 */
async function fetchResultsSnapshot(pool, surveyId, opts = {}) {
  const forPublicApi = opts.forPublicApi !== false;
  const responseIds = opts.responseIds;

  const survey = await loadSurveyWithQuestions(pool, surveyId);
  if (!survey) return null;

  let totalResponses = 0;
  /** @type {Array<{ question_id: number; value: unknown }>} */
  let answerRows = [];

  if (responseIds && responseIds.size === 0) {
    totalResponses = 0;
    answerRows = [];
  } else {
    const params = [surveyId];
    let extra = '';
    if (responseIds && responseIds.size > 0) {
      params.push([...responseIds]);
      extra = 'AND r.id = ANY($2::int[])';
    }
    const respCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM responses r WHERE r.survey_id = $1 ${extra}`,
      params
    );
    totalResponses = respCount.rows[0].c;

    const answers = await pool.query(
      `SELECT av.question_id, av.value
       FROM answer_values av
       INNER JOIN responses r ON r.id = av.response_id
       WHERE r.survey_id = $1 ${extra}`,
      params
    );
    answerRows = answers.rows;
  }

  const byQ = new Map();
  for (const q of survey.questions) {
    byQ.set(Number(q.id), []);
  }
  for (const row of answerRows) {
    const qid = Number(row.question_id);
    const list = byQ.get(qid);
    if (list) {
      let val = row.value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          /* keep string */
        }
      }
      list.push({ value: val });
    }
  }

  const perQuestion = survey.questions.map((q) =>
    aggregateForQuestion(q, byQ.get(Number(q.id)) || []),
  );

  const textCorpus = [];
  for (const q of perQuestion) {
    if (q.type === 'text' && Array.isArray(q.samples)) {
      textCorpus.push(...q.samples);
    }
  }
  const wcWords = buildWordCloudFromTexts(textCorpus);
  const text_word_cloud = wcWords.length ? { words: wcWords } : undefined;

  const charts = await fetchChartAggregates(pool, surveyId, perQuestion, responseIds || null);

  const questionsOut = forPublicApi
    ? perQuestion.map((p) => {
        if (p.type !== 'text') return p;
        const { samples, ...rest } = p;
        return { ...rest, samples: [] };
      })
    : perQuestion;

  return {
    survey: {
      id: survey.id,
      title: survey.title,
      status: survey.status,
      access_link: survey.access_link,
    },
    total_responses: totalResponses,
    questions: questionsOut,
    charts,
    text_word_cloud,
  };
}

async function handleGetResults(pool, surveyId) {
  const snap = await fetchResultsSnapshot(pool, surveyId, { forPublicApi: false });
  if (!snap) return json(404, { error: 'Not found' });

  const wb = await pool.query(
    `SELECT id, filename, sheets, ai_commentary, created_at::text
     FROM survey_workbooks WHERE survey_id = $1 ORDER BY id DESC`,
    [surveyId]
  );

  return json(200, {
    ...snap,
    workbooks: wb.rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      sheets: row.sheets,
      ai_commentary: row.ai_commentary,
      created_at: row.created_at,
    })),
  });
}

module.exports = { handleGetResults, fetchResultsSnapshot };

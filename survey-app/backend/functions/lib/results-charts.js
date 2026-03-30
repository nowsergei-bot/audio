/**
 * Агрегаты для дашборда графиков на странице результатов.
 */

function fillDailySeries(rows, daysBack = 30) {
  const map = new Map();
  for (const r of rows) {
    const k = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    map.set(k, Number(r.c) || 0);
  }
  const out = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, total: map.get(key) || 0 });
  }
  return out;
}

const DOW_LABELS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

async function fetchChartAggregates(pool, surveyId, questionMeta, responseIds = null) {
  if (responseIds && responseIds.size === 0) {
    const dailySeries = fillDailySeries([], 30);
    return {
      daily: dailySeries,
      top_questions_timeseries: [],
      dow_stacked: [],
    };
  }

  let filterSql = '';
  const baseParams = [surveyId];
  if (responseIds && responseIds.size > 0) {
    baseParams.push([...responseIds]);
    filterSql = 'AND r.id = ANY($2::int[])';
  }

  const dailyFixed = await pool.query(
    `SELECT (r.submitted_at AT TIME ZONE 'UTC')::date AS d, COUNT(*)::int AS c
     FROM responses r
     WHERE r.survey_id = $1
       ${filterSql}
       AND r.submitted_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '30 days')
     GROUP BY 1
     ORDER BY 1`,
    baseParams
  );

  const dailySeries = fillDailySeries(dailyFixed.rows);

  const topIds = questionMeta
    .slice()
    .sort((a, b) => (b.response_count || 0) - (a.response_count || 0))
    .slice(0, 3)
    .map((q) => q.question_id);

  let top_questions_timeseries = [];
  let dow_stacked = [];

  if (topIds.length > 0) {
    const tsParams = [surveyId, topIds];
    let ridClause = '';
    if (responseIds && responseIds.size > 0) {
      tsParams.push([...responseIds]);
      ridClause = 'AND r.id = ANY($3::int[])';
    }
    const ts = await pool.query(
      `SELECT (r.submitted_at AT TIME ZONE 'UTC')::date AS d,
              av.question_id::int AS qid,
              COUNT(*)::int AS c
       FROM responses r
       INNER JOIN answer_values av ON av.response_id = r.id
       WHERE r.survey_id = $1
         ${ridClause}
         AND r.submitted_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '30 days')
         AND av.question_id = ANY($2::int[])
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      tsParams
    );

    const byQ = new Map();
    for (const id of topIds) {
      byQ.set(id, new Map());
    }
    for (const row of ts.rows) {
      const key = row.d instanceof Date ? row.d.toISOString().slice(0, 10) : String(row.d).slice(0, 10);
      const m = byQ.get(row.qid);
      if (m) m.set(key, Number(row.c) || 0);
    }

    const qText = new Map(questionMeta.map((q) => [q.question_id, q.text || `Вопрос ${q.question_id}`]));
    top_questions_timeseries = topIds.map((qid) => {
      const m = byQ.get(qid) || new Map();
      const points = dailySeries.map(({ date }) => ({ date, count: m.get(date) || 0 }));
      const t = qText.get(qid) || '';
      return {
        question_id: qid,
        short_label: t.length > 28 ? `${t.slice(0, 27)}…` : t || `Q${qid}`,
        points,
      };
    });

    const dowParams = [surveyId, topIds];
    let dowRid = '';
    if (responseIds && responseIds.size > 0) {
      dowParams.push([...responseIds]);
      dowRid = 'AND r.id = ANY($3::int[])';
    }
    const dow = await pool.query(
      `SELECT EXTRACT(ISODOW FROM r.submitted_at AT TIME ZONE 'UTC')::int AS dow,
              av.question_id::int AS qid,
              COUNT(*)::int AS c
       FROM responses r
       INNER JOIN answer_values av ON av.response_id = r.id
       WHERE r.survey_id = $1
         ${dowRid}
         AND r.submitted_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - INTERVAL '90 days')
         AND av.question_id = ANY($2::int[])
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      dowParams
    );

    const byDow = new Map();
    for (let i = 1; i <= 7; i++) {
      byDow.set(i, []);
    }
    for (const row of dow.rows) {
      const di = Number(row.dow);
      if (di >= 1 && di <= 7) {
        byDow.get(di).push({
          question_id: row.qid,
          count: Number(row.c) || 0,
        });
      }
    }
    dow_stacked = [];
    for (let d = 1; d <= 7; d++) {
      const stacks = topIds.map((qid) => {
        const found = byDow.get(d).find((s) => s.question_id === qid);
        const tx = qText.get(qid) || '';
        return {
          question_id: qid,
          label: tx.length > 14 ? `${tx.slice(0, 13)}…` : tx || `Q${qid}`,
          count: found ? found.count : 0,
        };
      });
      dow_stacked.push({ dow: d, label: DOW_LABELS[d], stacks });
    }
  }

  return {
    daily: dailySeries,
    top_questions_timeseries,
    dow_stacked,
  };
}

module.exports = { fetchChartAggregates, fillDailySeries };

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function asNumber(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asCategory(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => String(x).trim()).filter(Boolean).sort();
    return parts.length ? parts.join(' | ') : null;
  }
  const s = String(v).trim();
  return s ? s : null;
}

function pearsonAbs(xs, ys) {
  const n = xs.length;
  if (n < 6) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  if (!den) return 0;
  return Math.min(1, Math.abs(num / den));
}

function cramersV(catsA, catsB) {
  const n = catsA.length;
  if (n < 12) return 0;
  const rows = new Map();
  const cols = new Map();
  const table = new Map(); // key `${ra}\t${cb}` -> count

  for (let i = 0; i < n; i++) {
    const a = catsA[i];
    const b = catsB[i];
    if (!rows.has(a)) rows.set(a, rows.size);
    if (!cols.has(b)) cols.set(b, cols.size);
    const key = `${a}\t${b}`;
    table.set(key, (table.get(key) || 0) + 1);
  }

  const r = rows.size;
  const c = cols.size;
  if (r < 2 || c < 2) return 0;

  const rowSum = Array(r).fill(0);
  const colSum = Array(c).fill(0);
  for (const [key, count] of table.entries()) {
    const [a, b] = key.split('\t');
    const ri = rows.get(a);
    const ci = cols.get(b);
    rowSum[ri] += count;
    colSum[ci] += count;
  }

  let chi2 = 0;
  for (const [key, observed] of table.entries()) {
    const [a, b] = key.split('\t');
    const ri = rows.get(a);
    const ci = cols.get(b);
    const expected = (rowSum[ri] * colSum[ci]) / n;
    if (expected > 0) {
      const diff = observed - expected;
      chi2 += (diff * diff) / expected;
    }
  }
  const denom = n * Math.min(r - 1, c - 1);
  if (!denom) return 0;
  return Math.min(1, Math.sqrt(chi2 / denom));
}

function etaSquared(cat, nums) {
  const n = nums.length;
  if (n < 12) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += nums[i];
  const mean = sum / n;

  let sst = 0;
  for (let i = 0; i < n; i++) {
    const d = nums[i] - mean;
    sst += d * d;
  }
  if (!sst) return 0;

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = cat[i];
    if (!groups.has(k)) groups.set(k, { sum: 0, n: 0 });
    const g = groups.get(k);
    g.sum += nums[i];
    g.n += 1;
  }
  if (groups.size < 2) return 0;

  let ssb = 0;
  for (const g of groups.values()) {
    const gm = g.sum / g.n;
    const d = gm - mean;
    ssb += g.n * d * d;
  }
  return Math.min(1, Math.max(0, ssb / sst));
}

function explain(method, score) {
  const pct = Math.round(score * 100);
  if (method === 'pearson_abs') return `Связь по числовым оценкам (|r|≈${pct}%).`;
  if (method === 'eta2') return `Срез по группам: различия средних между вариантами (η²≈${pct}%).`;
  if (method === 'cramers_v') return `Связь между вариантами выбора (V≈${pct}%).`;
  return `Оценка связи ≈${pct}%.`;
}

async function buildInsightRelations(pool, surveyId, questions, opts = {}) {
  const responseIdsFilter = opts.responseIds;

  const allowed = new Map();
  for (const q of questions || []) {
    const t = String(q.type);
    if (t === 'radio' || t === 'scale' || t === 'rating' || t === 'checkbox') {
      allowed.set(Number(q.id), { id: Number(q.id), type: t, text: q.text || '' });
    }
  }
  const qids = [...allowed.keys()];
  if (qids.length < 2) return [];

  const limitResponses = 2000;
  let respIds;
  if (responseIdsFilter && responseIdsFilter.size > 0) {
    const arr = [...responseIdsFilter].filter((n) => Number.isFinite(n));
    respIds = arr.slice(0, limitResponses);
  } else if (responseIdsFilter && responseIdsFilter.size === 0) {
    return [];
  } else {
    const resp = await pool.query(
      `SELECT id
       FROM responses
       WHERE survey_id = $1
       ORDER BY submitted_at DESC
       LIMIT $2`,
      [surveyId, limitResponses]
    );
    respIds = resp.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  }
  if (!respIds.length) return [];

  const ans = await pool.query(
    `SELECT av.response_id, av.question_id, av.value
     FROM answer_values av
     WHERE av.response_id = ANY($1::int[]) AND av.question_id = ANY($2::int[])`,
    [respIds, qids]
  );

  const byResp = new Map();
  for (const row of ans.rows) {
    const rid = Number(row.response_id);
    const qid = Number(row.question_id);
    if (!Number.isFinite(rid) || !Number.isFinite(qid)) continue;
    if (!byResp.has(rid)) byResp.set(rid, new Map());
    byResp.get(rid).set(qid, row.value);
  }

  const pairs = [];
  const ids = qids.sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push([ids[i], ids[j]]);
    }
  }

  const results = [];
  for (const [a, b] of pairs) {
    const qa = allowed.get(a);
    const qb = allowed.get(b);
    if (!qa || !qb) continue;

    const xsNum = [];
    const ysNum = [];
    const xsCat = [];
    const ysCat = [];
    const mixedCat = [];
    const mixedNum = [];

    for (const m of byResp.values()) {
      if (!m.has(a) || !m.has(b)) continue;
      const va = m.get(a);
      const vb = m.get(b);

      const aNum = qa.type === 'scale' || qa.type === 'rating' ? asNumber(va) : null;
      const bNum = qb.type === 'scale' || qb.type === 'rating' ? asNumber(vb) : null;
      const aCat = qa.type === 'radio' || qa.type === 'checkbox' ? asCategory(va) : null;
      const bCat = qb.type === 'radio' || qb.type === 'checkbox' ? asCategory(vb) : null;

      if (aNum != null && bNum != null) {
        xsNum.push(aNum);
        ysNum.push(bNum);
      } else if (aCat != null && bCat != null) {
        xsCat.push(aCat);
        ysCat.push(bCat);
      } else if (aCat != null && bNum != null) {
        mixedCat.push(aCat);
        mixedNum.push(bNum);
      } else if (bCat != null && aNum != null) {
        mixedCat.push(bCat);
        mixedNum.push(aNum);
      }
    }

    let method = '';
    let score = 0;
    let n = 0;
    if (xsNum.length >= 12) {
      method = 'pearson_abs';
      score = pearsonAbs(xsNum, ysNum);
      n = xsNum.length;
    } else if (xsCat.length >= 16) {
      method = 'cramers_v';
      score = cramersV(xsCat, ysCat);
      n = xsCat.length;
    } else if (mixedNum.length >= 16) {
      method = 'eta2';
      score = etaSquared(mixedCat, mixedNum);
      n = mixedNum.length;
    } else {
      continue;
    }

    if (!isFiniteNumber(score) || score <= 0.12) continue;
    results.push({
      a,
      b,
      n,
      method,
      score: Math.round(score * 1000) / 1000,
      why: explain(method, score),
      a_type: qa.type,
      b_type: qb.type,
      a_text: qa.text,
      b_text: qb.text,
    });
  }

  results.sort((x, y) => (y.score - x.score) || (y.n - x.n));
  return results.slice(0, 12);
}

module.exports = { buildInsightRelations };


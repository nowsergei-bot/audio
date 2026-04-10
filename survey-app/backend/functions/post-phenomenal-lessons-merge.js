const { json, parseBody } = require('./lib/http');
const { fetchExportRowsData } = require('./get-export-rows');
const { chatCompletion } = require('./lib/llm-chat');
const { tryParseLlmJsonObject } = require('./lib/parse-llm-json');
const { heuristicPairsForParentIndices } = require('./lib/phenomenal-lessons-heuristic-merge');

function truncate(s, n) {
  const t = String(s ?? '')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function normalizeTeacherFromBody(row, i) {
  if (!row || typeof row !== 'object') return null;
  const scoreRaw = row.methodologicalScore ?? row.methodological_score;
  let methodologicalScore = null;
  if (scoreRaw != null && scoreRaw !== '') {
    const n = Number(String(scoreRaw).replace(',', '.'));
    if (Number.isFinite(n)) methodologicalScore = n;
  }
  return {
    submittedAt: row.submittedAt ?? row.submitted_at ?? null,
    observerName: String(row.observerName ?? row.observer_name ?? '').trim(),
    subjects: String(row.subjects ?? '').trim(),
    lessonCode: String(row.lessonCode ?? row.lesson_code ?? '').trim(),
    conductingTeachers: String(row.conductingTeachers ?? row.conducting_teachers ?? '').trim(),
    rubricOrganizational: String(row.rubricOrganizational ?? row.rubric_organizational ?? '').trim(),
    rubricGoalSetting: String(row.rubricGoalSetting ?? row.rubric_goal_setting ?? '').trim(),
    rubricTechnologies: String(row.rubricTechnologies ?? row.rubric_technologies ?? '').trim(),
    rubricInformation: String(row.rubricInformation ?? row.rubric_information ?? '').trim(),
    rubricGeneralContent: String(row.rubricGeneralContent ?? row.rubric_general_content ?? '').trim(),
    rubricCultural: String(row.rubricCultural ?? row.rubric_cultural ?? '').trim(),
    rubricReflection: String(row.rubricReflection ?? row.rubric_reflection ?? '').trim(),
    generalThoughts: String(row.generalThoughts ?? row.general_thoughts ?? '').trim(),
    methodologicalScore,
    _ti: i,
  };
}

/** Только поля для сопоставления урока — уменьшает JSON и время ответа модели. */
function compactTeacherForMergeMatch(t, ti) {
  return {
    ti,
    at: t.submittedAt ? truncate(String(t.submittedAt), 22) : '',
    code: truncate(t.lessonCode, 56),
    led: truncate(t.conductingTeachers, 100),
    score: t.methodologicalScore,
  };
}

function parentAnswersLabeledFromDb(row, questions) {
  const out = {};
  for (const q of questions) {
    const v = row.answers[q.id];
    if (v !== undefined && v !== null && v !== '') {
      out[truncate(q.text, 200)] = v;
    }
  }
  return out;
}

function dbRowsToUnified(questions, rows) {
  return rows.map((r) => ({
    created_at: r.created_at || '',
    respondent_id: r.respondent_id || '',
    answers_labeled: parentAnswersLabeledFromDb(r, questions),
  }));
}

/** Из тела запроса: answers_labeled или cells[{q,v}]. */
function normalizeParentRowsFromBody(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!row || typeof row !== 'object') continue;
    const answers_labeled = {};
    const al = row.answers_labeled ?? row.answersLabeled;
    if (al && typeof al === 'object' && !Array.isArray(al)) {
      for (const [k, v] of Object.entries(al)) {
        if (v != null && String(v).trim() !== '') answers_labeled[String(k)] = String(v).trim();
      }
    } else if (Array.isArray(row.cells)) {
      for (const c of row.cells) {
        if (c && c.q != null && c.v != null && String(c.v).trim() !== '') {
          answers_labeled[String(c.q).trim()] = String(c.v).trim();
        }
      }
    }
    if (Object.keys(answers_labeled).length === 0) continue;
    const rid = String(row.respondent_id ?? row.respondentId ?? '').trim();
    out.push({
      created_at: String(row.created_at ?? row.created ?? '').trim(),
      respondent_id: rid || `excel-${i}`,
      answers_labeled,
    });
  }
  return out;
}

function buildParentsCompactUnified(unifiedRows, maxAnswerLen) {
  return unifiedRows.map((row, pi) => ({
    pi,
    created: truncate(row.created_at, 28) || '—',
    cells: Object.entries(row.answers_labeled)
      .map(([q, v]) => ({
        q: truncate(q, 110),
        v: truncate(String(v), maxAnswerLen),
      }))
      .filter((x) => x.v),
  }));
}

function normalizeLessonCodeForGroup(code) {
  return String(code ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function lessonGroupKeyForTi(teacherRows, ti) {
  const t = teacherRows[ti];
  if (!t) return `__row_${ti}`;
  const raw = String(t.lessonCode ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return `__row_${ti}`;
  return normalizeLessonCodeForGroup(raw);
}

function buildCanonicalLessonMaps(teacherRows) {
  const keyToTis = new Map();
  for (let i = 0; i < teacherRows.length; i++) {
    const key = lessonGroupKeyForTi(teacherRows, i);
    if (!keyToTis.has(key)) keyToTis.set(key, []);
    keyToTis.get(key).push(i);
  }
  const tiToCanonical = new Map();
  const canonicalToMembers = new Map();
  for (const [, tis] of keyToTis) {
    const canon = Math.min(...tis);
    canonicalToMembers.set(canon, tis);
    for (const ti of tis) tiToCanonical.set(ti, canon);
  }
  return { tiToCanonical, canonicalToMembers };
}

function preferFullPersonLabel(raw) {
  const s = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const parts = s.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

function uniqueNormJoin(parts, sep) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const s = String(p ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.join(sep);
}

function expandPersonListField(value) {
  const chunks = String(value ?? '')
    .split(/[,;/]+/)
    .map((c) => preferFullPersonLabel(c))
    .filter(Boolean);
  return uniqueNormJoin(chunks, ', ');
}

function aggregateTeachersForIndices(teacherRows, indices) {
  const sorted = [...indices].sort((a, b) => a - b);
  const list = sorted.map((i) => teacherRows[i]).filter(Boolean);
  if (!list.length) return null;
  const first = list[0];
  const scores = list.map((t) => t.methodologicalScore).filter((x) => x != null && Number.isFinite(x));
  let methodologicalScore = null;
  if (scores.length === 1) [methodologicalScore] = scores;
  else if (scores.length > 1) {
    methodologicalScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  }

  return {
    lessonCode: first.lessonCode,
    conductingTeachers: uniqueNormJoin(
      list.map((t) => expandPersonListField(t.conductingTeachers)),
      ' · ',
    ),
    subjects: uniqueNormJoin(list.map((t) => t.subjects), ' · '),
    submittedAt: list.map((t) => t.submittedAt).find((x) => x != null && String(x).trim() !== '') || null,
    observerName: uniqueNormJoin(list.map((t) => preferFullPersonLabel(t.observerName)), ' · '),
    generalThoughts: uniqueNormJoin(list.map((t) => t.generalThoughts), '\n\n'),
    methodologicalScore,
    methodologicalScores: scores,
    rubricOrganizational: uniqueNormJoin(list.map((t) => t.rubricOrganizational), '\n'),
    rubricGoalSetting: uniqueNormJoin(list.map((t) => t.rubricGoalSetting), '\n'),
    rubricTechnologies: uniqueNormJoin(list.map((t) => t.rubricTechnologies), '\n'),
    rubricInformation: uniqueNormJoin(list.map((t) => t.rubricInformation), '\n'),
    rubricGeneralContent: uniqueNormJoin(list.map((t) => t.rubricGeneralContent), '\n'),
    rubricCultural: uniqueNormJoin(list.map((t) => t.rubricCultural), '\n'),
    rubricReflection: uniqueNormJoin(list.map((t) => t.rubricReflection), '\n'),
  };
}

function teacherPayloadForPair(teacherRows, canonicalToMembers, ti) {
  if (ti == null) return null;
  const members = canonicalToMembers.get(ti) || [ti];
  return aggregateTeachersForIndices(teacherRows, members);
}

const MERGE_SYSTEM = `Ты сопоставляешь ответы родителей (опрос на сайте или строки из Excel) со строками педагогического чек-листа (Excel) про **тот же урок**.

Правила:
- У каждой строки родителя в этом запросе есть индекс pi (глобальный, не меняй числа).
- У каждой строки педагога — индекс ti.
- Одна строка родителя: не больше одной пары с педагогом; если урока нет в списке педагогов — ti: null.
- Несколько родителей (разные pi) могут ссылаться на один ti (один урок).
- Если в списке педагогов несколько строк с **одинаковым шифром урока** — это один урок (разные наблюдатели); для сопоставления подойдёт любой из соответствующих ti.
- Учитывай: дату, класс/группу и «шифр урока», ФИО ведущих (разный порядок, инициалы, опечатки, латиница/кириллица); даты посещения и отметки педагога могут отличаться на 1–2 дня.
- confidence — число от 0 до 1.
- Верни один JSON-объект (без markdown): {"pairs":[{"pi":0,"ti":3,"confidence":0.88,"reason":"кратко по-русски"}, ...]}
- В pairs ровно по одному объекту на **каждый** pi из массива parents входного JSON (все pi из запроса должны присутствовать).`;

async function runMergeLlmChunk(parentsChunk, teachersCompact, model) {
  const payload = { parents: parentsChunk, teachers: teachersCompact };
  const messages = [
    { role: 'system', content: MERGE_SYSTEM },
    {
      role: 'user',
      content: `Сопоставь pi с ti. Вход:\n${JSON.stringify(payload)}`,
    },
  ];
  const res = await chatCompletion(messages, {
    model,
    maxTokens: 9000,
    temperature: 0.12,
    jsonObject: true,
  });
  if (!res.ok || typeof res.text !== 'string') {
    return {
      ok: false,
      detail: res.detail || res.kind || 'LLM недоступна',
      provider: res.provider || null,
    };
  }
  const obj = tryParseLlmJsonObject(res.text);
  if (!obj || !Array.isArray(obj.pairs)) {
    return { ok: false, detail: 'Модель вернула неразборчивый JSON', provider: res.provider || null };
  }
  return { ok: true, pairs: obj.pairs, provider: res.provider || null };
}

/**
 * Сначала LLM; при любой ошибке или битом JSON — эвристика (без 502 для пользователя).
 */
async function runMergeLlmChunkWithFallback(parentsChunk, teachersCompact, teacherRows, parentRows, model) {
  const llmRes = await runMergeLlmChunk(parentsChunk, teachersCompact, model);
  if (llmRes.ok) {
    return { ok: true, pairs: llmRes.pairs, provider: llmRes.provider || null, usedHeuristic: false };
  }
  const indices = parentsChunk.map((p) => p.pi);
  const pairs = heuristicPairsForParentIndices(indices, parentRows, teacherRows);
  return {
    ok: true,
    pairs,
    provider: llmRes.provider || null,
    usedHeuristic: true,
  };
}

function validatePairsAgainstParents(pairs, parentIndices, teacherCount) {
  const set = new Set(parentIndices);
  const seen = new Set();
  const out = [];
  const maxTi = teacherCount > 0 ? teacherCount - 1 : -1;
  for (const p of pairs) {
    const pi = Number(p.pi);
    if (!set.has(pi) || seen.has(pi)) continue;
    seen.add(pi);
    const tiRaw = p.ti;
    const tiNum = tiRaw === null || tiRaw === undefined || tiRaw === '' ? NaN : Number(tiRaw);
    let ti = Number.isFinite(tiNum) ? tiNum : null;
    if (ti != null && (ti < 0 || ti > maxTi)) ti = null;
    const confidence = Math.min(1, Math.max(0, Number(p.confidence)));
    const reason = truncate(p.reason ?? p.note ?? '', 400);
    out.push({
      pi,
      ti,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason,
    });
  }
  for (const pi of parentIndices) {
    if (!seen.has(pi)) {
      out.push({ pi, ti: null, confidence: 0, reason: 'Нет в ответе модели' });
    }
  }
  out.sort((a, b) => a.pi - b.pi);
  return out;
}

/**
 * Если модель вернула JSON, но для части строк ti пустой — пробуем ту же эвристику, что при полном отказе LLM.
 */
function augmentNullPairsWithHeuristic(validated, parentRows, teacherRows) {
  const weak = validated.filter((p) => p.ti == null || !(Number(p.confidence) > 0));
  if (!weak.length) return { pairs: validated, usedAugment: false };
  const indices = weak.map((p) => p.pi);
  const hPairs = heuristicPairsForParentIndices(indices, parentRows, teacherRows);
  const hByPi = new Map(hPairs.map((x) => [x.pi, x]));
  let usedAugment = false;
  const pairs = validated.map((p) => {
    if (p.ti != null && Number(p.confidence) > 0) return p;
    const h = hByPi.get(p.pi);
    if (!h || h.ti == null || !(Number(h.confidence) > 0)) return p;
    usedAugment = true;
    const prev = p.reason ? String(p.reason).slice(0, 180) : '';
    return {
      ...p,
      ti: h.ti,
      confidence: h.confidence,
      reason: prev ? `${h.reason} (вместо: ${prev})` : h.reason,
    };
  });
  return { pairs, usedAugment };
}

/**
 * POST body: {
 *   teacher_rows: [...],
 *   confidence_threshold?: number,
 *   survey_id?: number,
 *   parent_rows?: [{ answers_labeled?: {}, cells?: [{q,v}], created_at?, respondent_id? }],
 *   parent_source_title?: string
 * }
 * Родители: либо parent_rows (Excel), либо survey_id + загрузка из БД.
 */
async function handlePostPhenomenalLessonsMerge(pool, event, canAccessSurvey) {
  const body = parseBody(event) || {};
  const surveyId = Number(body.survey_id);
  const thresholdRaw = body.confidence_threshold;
  const threshold =
    typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw)
      ? Math.min(1, Math.max(0, thresholdRaw))
      : 0.72;

  const rawTeachers = body.teacher_rows;
  if (!Array.isArray(rawTeachers) || rawTeachers.length === 0) {
    return json(400, { error: 'teacher_rows: непустой массив строк чек-листа' });
  }

  const fromExcelParents = normalizeParentRowsFromBody(body.parent_rows);
  const useExcelParents = fromExcelParents.length > 0;

  let surveyMeta;
  let parentUnified;

  if (useExcelParents) {
    parentUnified = fromExcelParents;
    const title = truncate(String(body.parent_source_title || 'Родители (Excel)'), 200);
    surveyMeta = { id: 0, title };
  } else {
    if (!Number.isFinite(surveyId) || surveyId < 1) {
      return json(400, {
        error: 'Укажите survey_id или непустой parent_rows (второй Excel с ответами родителей)',
      });
    }
    const ok = await canAccessSurvey(surveyId);
    if (ok === null) return json(404, { error: 'Not found' });
    if (!ok) return json(403, { error: 'Forbidden' });

    const exportData = await fetchExportRowsData(pool, surveyId);
    if (!exportData) return json(404, { error: 'Опрос не найден' });
    surveyMeta = exportData.survey;
    parentUnified = dbRowsToUnified(exportData.questions, exportData.rows);
  }

  if (!parentUnified.length) {
    return json(400, { error: 'Нет строк ответов родителей (пустой опрос или пустой Excel)' });
  }

  const teachers = rawTeachers.map(normalizeTeacherFromBody).filter(Boolean);
  if (!teachers.length) {
    return json(400, { error: 'Не удалось разобрать teacher_rows' });
  }

  const MAX_PARENTS = 96;
  const MAX_TEACHERS = 240;
  /** Крупнее чанк — меньше раунд-трипов к LLM; параллель ниже. */
  const PARENT_CHUNK = 48;
  const warnings = [];

  let parentRows = parentUnified;
  if (parentRows.length > MAX_PARENTS) {
    warnings.push(`Ответы родителей усечены: первые ${MAX_PARENTS} из ${parentUnified.length}`);
    parentRows = parentRows.slice(0, MAX_PARENTS);
  }
  let teacherRows = teachers;
  if (teacherRows.length > MAX_TEACHERS) {
    warnings.push(`Строки педагогов усечены: первые ${MAX_TEACHERS} из ${teachers.length}`);
    teacherRows = teacherRows.slice(0, MAX_TEACHERS);
  }

  const parentsFull = buildParentsCompactUnified(parentRows, 160);
  const teachersForMatch = teacherRows.map((t, i) => compactTeacherForMergeMatch(t, i));

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const chunks = [];
  for (let start = 0; start < parentsFull.length; start += PARENT_CHUNK) {
    chunks.push(parentsFull.slice(start, start + PARENT_CHUNK));
  }

  const LLM_PARALLEL = 2;
  const chunkResults = [];
  for (let i = 0; i < chunks.length; i += LLM_PARALLEL) {
    const batch = chunks.slice(i, i + LLM_PARALLEL);
    const part = await Promise.all(
      batch.map((slice) =>
        runMergeLlmChunkWithFallback(slice, teachersForMatch, teacherRows, parentRows, model),
      ),
    );
    chunkResults.push(...part);
  }

  let lastProvider = null;
  let anyHeuristic = false;
  const allPairs = [];
  for (let ci = 0; ci < chunkResults.length; ci++) {
    const chunkRes = chunkResults[ci];
    const slice = chunks[ci];
    lastProvider = chunkRes.provider || lastProvider;
    if (chunkRes.usedHeuristic) anyHeuristic = true;
    const indices = slice.map((p) => p.pi);
    const validated = validatePairsAgainstParents(chunkRes.pairs, indices, teacherRows.length);
    const aug = augmentNullPairsWithHeuristic(validated, parentRows, teacherRows);
    if (aug.usedAugment) anyHeuristic = true;
    allPairs.push(...aug.pairs);
  }
  if (anyHeuristic) {
    warnings.push(
      'ИИ не дал ответ или ответ не разобран — строки родителей сопоставлены эвристикой (шифр урока, класс, ФИО ведущего). Проверьте пары ниже и при необходимости подправьте вручную в редакторе отчёта.',
    );
  }
  allPairs.sort((a, b) => a.pi - b.pi);

  const { tiToCanonical, canonicalToMembers } = buildCanonicalLessonMaps(teacherRows);
  for (const p of allPairs) {
    if (p.ti != null && tiToCanonical.has(p.ti)) p.ti = tiToCanonical.get(p.ti);
  }

  const merged = [];
  const uncertain = [];
  const usedTeacher = new Set();

  for (const p of allPairs) {
    const parentRow = parentRows[p.pi];
    const teacherPayload = teacherPayloadForPair(teacherRows, canonicalToMembers, p.ti);
    const entry = {
      parent_row_index: p.pi,
      teacher_row_index: p.ti,
      confidence: p.confidence,
      reason: p.reason,
      parent: parentRow
        ? {
            created_at: parentRow.created_at || '',
            respondent_id: parentRow.respondent_id || '',
            answers_labeled: parentRow.answers_labeled || {},
          }
        : null,
      teacher: teacherPayload,
    };
    if (p.ti != null && p.confidence >= threshold) {
      merged.push(entry);
      const members = canonicalToMembers.get(p.ti) || [p.ti];
      for (const x of members) usedTeacher.add(x);
    } else {
      uncertain.push(entry);
    }
  }

  const unmatchedParents = allPairs
    .filter((x) => x.ti == null || x.confidence < threshold)
    .map((x) => x.pi);

  const unmatchedTeachers = [];
  for (let ti = 0; ti < teacherRows.length; ti++) {
    if (!usedTeacher.has(ti)) unmatchedTeachers.push(ti);
  }

  return json(200, {
    survey: surveyMeta,
    parent_source: useExcelParents ? 'excel' : 'survey',
    confidence_threshold: threshold,
    warnings,
    llm_provider: lastProvider,
    stats: {
      parent_rows: parentRows.length,
      teacher_rows: teacherRows.length,
      merged_high_confidence: merged.length,
      uncertain_or_no_match: uncertain.length,
    },
    merged,
    uncertain,
    unmatched_parent_indices: [...new Set(unmatchedParents)].sort((a, b) => a - b),
    unmatched_teacher_indices: unmatchedTeachers,
  });
}

module.exports = { handlePostPhenomenalLessonsMerge };

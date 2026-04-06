import type { AnalyticRow } from './engine';
import {
  filterKeyForRole,
  isFilterRole,
  PULSE_PARALLEL_AUTO_KEY,
  pulseSurveyColKey,
  shouldExposePulseSurveyFilterCandidate,
} from './engine';
import type { ColumnRole, CustomFilterLabels } from './types';

const NOT_SPECIFIED = '(не указано)';

/** Сравнение без учёта регистра и лишних пробелов */
export function roughNormFilterValue(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Похожие короткие подписи из одной графы (опечатка, обрезка, регистр).
 * Не сливаем слишком короткие и слишком длинные строки (свободный текст).
 */
function fuzzySameCategory(a: string, b: string): boolean {
  if (!a || !b || a === NOT_SPECIFIED || b === NOT_SPECIFIED) return false;
  const ra = roughNormFilterValue(a);
  const rb = roughNormFilterValue(b);
  if (ra === rb) return true;
  const maxL = Math.max(ra.length, rb.length);
  if (maxL < 3) return false;
  if (maxL > 72) return false;
  const [short, long] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  if (short.length >= 5 && long.startsWith(short) && long.length - short.length <= 5) return true;
  const thr = maxL <= 8 ? 2 : maxL <= 22 ? 3 : maxL <= 40 ? 4 : Math.min(5, Math.floor(maxL * 0.12));
  return levenshtein(ra, rb) <= thr;
}

function ufFind(parent: number[], i: number): number {
  if (parent[i] !== i) parent[i] = ufFind(parent, parent[i]);
  return parent[i];
}

function ufUnion(parent: number[], i: number, j: number): void {
  const ri = ufFind(parent, i);
  const rj = ufFind(parent, j);
  if (ri !== rj) parent[ri] = rj;
}

function pickCanonical(originals: string[], freq: Map<string, number>): string {
  let best = originals[0];
  let bestLen = best.length;
  let bestFreq = freq.get(best) ?? 0;
  for (let i = 1; i < originals.length; i++) {
    const o = originals[i];
    const len = o.length;
    const f = freq.get(o) ?? 0;
    if (len > bestLen) {
      best = o;
      bestLen = len;
      bestFreq = f;
    } else if (len === bestLen && f > bestFreq) {
      best = o;
      bestFreq = f;
    } else if (len === bestLen && f === bestFreq && o.localeCompare(best, 'ru') < 0) {
      best = o;
    }
  }
  return best;
}

/** Ключи фильтров, для которых сливаем похожие значения (не код педагога). */
export function filterKeysForValueCollapse(
  roles: ColumnRole[],
  customLabels: CustomFilterLabels,
): string[] {
  const keys: string[] = [];
  for (const r of roles) {
    if (!isFilterRole(r)) continue;
    if (r === 'filter_teacher_code') continue;
    keys.push(filterKeyForRole(r, customLabels));
  }
  if (roles.includes('filter_class') && !roles.includes('filter_parallel')) {
    keys.push(PULSE_PARALLEL_AUTO_KEY);
  }
  roles.forEach((r, i) => {
    if (!shouldExposePulseSurveyFilterCandidate(r)) return;
    keys.push(pulseSurveyColKey(i));
  });
  return [...new Set(keys)];
}

function buildReplacementForKey(rows: AnalyticRow[], key: string): Map<string, string> {
  const freq = new Map<string, number>();
  const uniques: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r.filterValues[key];
    if (v == null || v === NOT_SPECIFIED) continue;
    freq.set(v, (freq.get(v) ?? 0) + 1);
    if (!seen.has(v)) {
      seen.add(v);
      uniques.push(v);
    }
  }
  if (uniques.length <= 1) return new Map();

  const n = uniques.length;
  const parent = uniques.map((_, i) => i);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (fuzzySameCategory(uniques[i], uniques[j])) ufUnion(parent, i, j);
    }
  }

  const clusters = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = ufFind(parent, i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(uniques[i]);
  }

  const out = new Map<string, string>();
  for (const group of clusters.values()) {
    if (group.length === 1) continue;
    const canon = pickCanonical(group, freq);
    for (const raw of group) out.set(raw, canon);
  }
  return out;
}

/**
 * После развёртки мультизначений: сливает почти одинаковые подписи в одном измерении
 * (например «географи» и «География» в предмете) в одно значение фильтра.
 */
export function collapseSimilarFilterDimensionValues(
  rows: AnalyticRow[],
  roles: ColumnRole[],
  customLabels: CustomFilterLabels,
): AnalyticRow[] {
  const keys = filterKeysForValueCollapse(roles, customLabels);
  if (keys.length === 0 || rows.length === 0) return rows;

  const replByKey = new Map<string, Map<string, string>>();
  for (const key of keys) {
    const m = buildReplacementForKey(rows, key);
    if (m.size > 0) replByKey.set(key, m);
  }
  if (replByKey.size === 0) return rows;

  return rows.map((r) => {
    const fv = { ...r.filterValues };
    for (const [key, m] of replByKey) {
      const v = fv[key];
      if (v == null || v === NOT_SPECIFIED) continue;
      const to = m.get(v);
      if (to != null) fv[key] = to;
    }
    return { ...r, filterValues: fv };
  });
}

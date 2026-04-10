import type { PhenomenalReportReviewLine } from './reportDraftTypes';

/** Текст похож на уровень рубрики (1–4), а не на перечень предметов. */
export function looksLikeRubricLevelNotSubjects(raw: string): boolean {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 220) return false;
  if (/^\d+\s*[-–—]\s*(very\s+high|high|medium|low|average)\b/i.test(t)) return true;
  if (/^\d+\s*[-–—]\s*(на\s+очень\s+высоком|очень\s+высок|высоком\s+уровне|средн|низк)/i.test(t)) return true;
  if (/\/\/\s*на\s+очень\s+высоком/i.test(t) && t.length < 160) return true;
  if (/^(very\s+high|high|low|medium)\b/i.test(t)) return true;
  return false;
}

export type StructuredParentReview = {
  respondentName: string;
  overallRating: string;
  comments: string;
  /** Для совместимости и экспорта */
  flatText: string;
};

/**
 * Из answers_labeled ответа родителя выделяем ФИО, общую оценку и остальное — комментарии (абзацы через \n\n).
 */
export function parentAnswersToStructuredReview(answers: Record<string, unknown>): StructuredParentReview {
  const entries = Object.entries(answers)
    .map(([k, v]) => ({ key: String(k ?? '').trim(), val: String(v ?? '').trim() }))
    .filter((e) => e.val);

  let respondentName = '';
  let overallRating = '';
  const commentBlocks: string[] = [];

  for (const { key, val } of entries) {
    const kl = key.toLowerCase();
    if (
      /фио.*посетивш|посетивш.*урок|фио,\s*посетившего/i.test(key) ||
      (/наблюдател/i.test(key) && /фио|посетивш/i.test(key))
    ) {
      if (!respondentName || val.length > respondentName.length) respondentName = val;
      continue;
    }
    if (
      (/общая\s+оценка/i.test(key) && /урок/i.test(key)) ||
      (/оценка\s+урока/i.test(key) && /1\s*до\s*10|из\s*10/i.test(kl)) ||
      (/^итоговая\s+оценка/i.test(key) && /10/i.test(key))
    ) {
      overallRating = val;
      continue;
    }
    if (/^оценка$/i.test(key.trim()) && /^\d{1,2}$/.test(val)) {
      overallRating = val;
      continue;
    }
    commentBlocks.push(`${key}\n${val}`);
  }

  const comments = commentBlocks.join('\n\n').trim();
  const flatParts = [
    respondentName ? `ФИО, посетившего урок: ${respondentName}` : '',
    overallRating ? `Общая оценка урока: ${overallRating}` : '',
    comments,
  ].filter(Boolean);
  const flatText = flatParts.join('\n\n');

  return { respondentName, overallRating, comments, flatText };
}

/** Если в черновике только text (старый формат) — пробуем вытащить три части для отображения. */
export function tryParseStructuredFromFlatReviewText(text: string): Partial<
  Pick<PhenomenalReportReviewLine, 'respondentName' | 'overallRating' | 'comments'>
> | null {
  const t = String(text ?? '').trim();
  if (!t) return null;

  let respondentName = '';
  let overallRating = '';
  const lines = t.split(/\r?\n/);
  const consumed = new Set<number>();
  lines.forEach((line, i) => {
    const m1 = line.match(/^ФИО[,\s]*посетившего[^:：]*[:：]\s*(.+)$/i);
    if (m1) {
      respondentName = m1[1].trim();
      consumed.add(i);
      return;
    }
    const m2 = line.match(/^Общая\s+оценка[^:：]*[:：]\s*(.+)$/i);
    if (m2) {
      overallRating = m2[1].trim();
      consumed.add(i);
      return;
    }
    const m3 = line.match(/оценка\s+урока\s+от\s*1\s*до\s*10[^:：]*[:：]\s*(.+)$/i);
    if (m3) {
      overallRating = m3[1].trim();
      consumed.add(i);
    }
  });

  if (!respondentName && !overallRating) return null;

  const rest = lines.filter((_, i) => !consumed.has(i)).join('\n').trim();
  return {
    respondentName: respondentName || undefined,
    overallRating: overallRating || undefined,
    comments: rest || undefined,
  };
}

export function effectiveReviewParts(r: PhenomenalReportReviewLine): {
  name: string;
  rating: string;
  comments: string;
} {
  const name = (r.respondentName ?? '').trim();
  const rating = (r.overallRating ?? '').trim();
  let comments = (r.comments ?? '').trim();
  if (!name && !rating && !comments && r.text?.trim()) {
    const parsed = tryParseStructuredFromFlatReviewText(r.text);
    if (parsed) {
      return {
        name: (parsed.respondentName ?? '').trim(),
        rating: (parsed.overallRating ?? '').trim(),
        comments: (parsed.comments ?? '').trim(),
      };
    }
    return { name: '', rating: '', comments: r.text.trim() };
  }
  return { name, rating, comments };
}

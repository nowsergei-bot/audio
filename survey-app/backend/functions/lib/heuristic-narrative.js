const { truncate } = require('./insight-dashboard');

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function topOption(q) {
  const dist = q.distribution || [];
  if (!dist.length) return null;
  const sum = dist.reduce((a, d) => a + d.count, 0) || 1;
  const top = [...dist].sort((a, b) => b.count - a.count)[0];
  const pct = Math.round((top.count / sum) * 1000) / 10;
  return { label: String(top.label), count: top.count, pct };
}

function topNOptions(q, n) {
  const dist = q.distribution || [];
  if (!dist.length) return [];
  const sum = dist.reduce((a, d) => a + d.count, 0) || 1;
  return [...dist]
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((d) => ({
      label: String(d.label),
      pct: Math.round((d.count / sum) * 1000) / 10,
    }));
}

/**
 * Связная записка для руководителя без LLM: абзацы, а не набор шаблонных маркеров.
 */
function buildHeuristicNarrative(snapshot) {
  const title = snapshot?.survey?.title || 'Опрос';
  const total = Number(snapshot?.total_responses || 0);
  const qs = snapshot?.questions || [];

  if (!total) {
    return (
      `По опросу «${title}» пока нет ни одной отправленной анкеты, поэтому интерпретировать результаты рано. ` +
        `После появления ответов здесь появится краткая сводка по вопросам и оценкам.`
    );
  }

  const paragraphs = [];

  const answered = qs.filter((q) => (q.response_count || 0) > 0).length;
  const empty = qs.length - answered;
  let intro = `По теме «${title}» получено ${total} ${plural(total, 'заполненная анкета', 'заполненные анкеты', 'заполненных анкет')}`;
  if (empty > 0 && empty <= 3) {
    intro += `; по ${empty} ${plural(empty, 'вопросу', 'вопросам', 'вопросам')} из конструктора ответов пока нет — это не ошибка, а неполный охват на текущий момент`;
  } else if (answered === qs.length) {
    intro += `; респонденты ответили на все вопросы анкеты`;
  }
  intro += '. Ниже — что видно из уже собранных данных.';
  paragraphs.push(intro);

  const scaleParts = [];
  const scales = qs.filter((q) => (q.type === 'scale' || q.type === 'rating') && q.average != null && (q.response_count || 0) > 0);
  for (const q of scales.slice(0, 4)) {
    const avg = Number(q.average);
    const min = Number.isFinite(Number(q.min)) ? Number(q.min) : null;
    const max = Number.isFinite(Number(q.max)) ? Number(q.max) : null;
    const qText = truncate(q.text, 100);
    if (Number.isFinite(avg) && min != null && max != null && max > min) {
      const norm = (avg - min) / (max - min);
      if (norm >= 0.72) {
        scaleParts.push(
          `по формулировке «${qText}» средняя оценка высокая (${avg.toFixed(2)} при шкале ${min}–${max})`,
        );
      } else if (norm <= 0.42) {
        scaleParts.push(
          `по «${qText}» оценки заметно ниже ожидаемого уровня (среднее ${avg.toFixed(2)} при шкале ${min}–${max})`,
        );
      } else {
        scaleParts.push(`по «${qText}» средний балл ${avg.toFixed(2)} (шкала ${min}–${max})`);
      }
    }
  }
  if (scaleParts.length) {
    paragraphs.push(
      `По шкалам и рейтингам: ${scaleParts.join('; ')}. Эти цифры стоит сопоставить с конкретными формулировками вопросов ниже на странице.`,
    );
  }

  const choiceParts = [];
  const choiceQs = qs.filter((q) => (q.type === 'radio' || q.type === 'checkbox') && (q.response_count || 0) > 0);
  for (const q of choiceQs.slice(0, 3)) {
    const top3 = topNOptions(q, 3);
    const t = topOption(q);
    if (!t || !top3.length) continue;
    const qText = truncate(q.text, 90);
    if (t.pct >= 65) {
      choiceParts.push(
        `в блоке «${qText}» явно лидирует вариант «${truncate(t.label, 60)}» (${t.pct}% ответов)`,
      );
    } else if (top3.length >= 2) {
      choiceParts.push(
        `в вопросе «${qText}» мнения разделились: чаще выбирают «${truncate(top3[0].label, 50)}» (${top3[0].pct}%) и «${truncate(top3[1].label, 50)}» (${top3[1].pct}%)`,
      );
    }
  }
  if (choiceParts.length) {
    paragraphs.push(`По вопросам с вариантами ответа: ${choiceParts.join('; ')}.`);
  }

  const textCount = qs.filter((q) => q.type === 'text' && (q.samples_total || 0) > 0).length;
  if (textCount > 0) {
    paragraphs.push(
      `Респонденты оставили развёрнутые комментарии по ${textCount} ${plural(textCount, 'текстовому блоку', 'текстовым блокам', 'текстовым блокам')} — смысловые акценты отражены в облаке тем и в выборочных цитатах на странице.`,
    );
  }

  if (paragraphs.length === 1) {
    paragraphs.push(
      `Детальные распределения по каждому вопросу смотрите в блоках ниже: там видно доли ответов и графики.`,
    );
  }

  paragraphs.push(
    `Рекомендация: опираясь на приоритетные для вас вопросы опроса, отметьте 1–2 направления для обсуждения с командой (например, где оценки ниже ожиданий или мнения разошлись сильнее всего).`,
  );

  return paragraphs.join('\n\n');
}

module.exports = { buildHeuristicNarrative };

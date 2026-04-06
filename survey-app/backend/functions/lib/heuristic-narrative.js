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
  let intro = `Опрос «${title}» собрал достаточный материал для выводов: респонденты прошли анкету и ответили по сути темы.`;
  if (empty > 0 && empty <= 3) {
    intro += ` Часть вопросов пока без ответов — на картину в целом это мало влияет, но при повторном опросе можно проверить формулировки.`;
  } else if (answered === qs.length) {
    intro += ` По всем пунктам анкеты есть ответы — удобно сравнивать блоки между собой.`;
  }
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
        scaleParts.push(`по вопросу «${qText}» оценки в основном высокие`);
      } else if (norm <= 0.42) {
        scaleParts.push(
          `по «${qText}» настроение сдержанное или негативное — это стоит разобрать с командой отдельно`,
        );
      } else {
        scaleParts.push(`по «${qText}» оценки в середине шкалы, без явного перекоса`);
      }
    }
  }
  if (scaleParts.length) {
    paragraphs.push(
      `Шкалы и рейтинги: ${scaleParts.join('; ')}. Точные значения и шкалы смотрите в карточках вопросов выше — здесь только смысловой ориентир.`,
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
        `в блоке «${qText}» большинство склоняется к варианту «${truncate(t.label, 60)}»`,
      );
    } else if (top3.length >= 2) {
      choiceParts.push(
        `в вопросе «${qText}» мнения делятся между «${truncate(top3[0].label, 50)}» и «${truncate(top3[1].label, 50)}»`,
      );
    }
  }
  if (choiceParts.length) {
    paragraphs.push(`Вопросы с готовыми вариантами ответа: ${choiceParts.join('; ')}.`);
  }

  const hasTextResponses = qs.some(
    (q) =>
      q.type === 'text' &&
      ((q.response_count || 0) > 0 || (q.samples_total || 0) > 0 || (Array.isArray(q.samples) && q.samples.length > 0)),
  );
  if (hasTextResponses) {
    paragraphs.push(
      `Сигналы, риски и точки роста. В развёрнутых ответах респонденты обычно называют узкие места, ожидания и эмоции — это главный источник сигналов о рисках: повторяющиеся жалобы, нехватка времени или ресурсов, недовольство процессом. ` +
        `Параллельно ищите конструктивные пожелания, признание удачных решений и готовность участвовать — это точки роста. Просмотрите облако тем и полные формулировки под текстовыми вопросами; на встрече команды зафиксируйте минимум один приоритетный риск и одну инициативу усиления, опираясь на цитаты из анкет.`,
    );
  }

  if (paragraphs.length === 1) {
    paragraphs.push(
      `Детальные распределения по каждому вопросу — в блоках ниже на этой странице.`,
    );
  }

  paragraphs.push(
    `Для команды: зафиксируйте одно-два направления действий — например, где ответы звучат жёстче всего или где ожидания и реальность расходятся сильнее остального; затем назначьте ответственных и срок проверки.`,
  );

  return paragraphs.join('\n\n');
}

module.exports = { buildHeuristicNarrative };

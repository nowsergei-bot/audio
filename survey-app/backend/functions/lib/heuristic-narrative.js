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

function buildHeuristicNarrative(snapshot) {
  const title = snapshot?.survey?.title || 'Опрос';
  const total = Number(snapshot?.total_responses || 0);
  const qs = snapshot?.questions || [];

  if (!total) {
    return (
      `Выводы по опросу «${title}»\n\n` +
      `Пока нет ответов, поэтому статистические выводы сделать нельзя. ` +
      `Опубликуйте опрос и проверьте публичную ссылку — после первых анкет появятся распределения и аналитика.\n`
    );
  }

  const positives = [];
  const negatives = [];

  positives.push(
    `Собрано ${total} ${plural(total, 'анкета', 'анкеты', 'анкет')} — уже можно смотреть на устойчивые тенденции по большинству вопросов.`
  );

  const answered = qs.filter((q) => (q.response_count || 0) > 0).length;
  if (answered < qs.length) {
    negatives.push(
      `Не по всем вопросам есть ответы: ${qs.length - answered} ${plural(qs.length - answered, 'вопрос', 'вопроса', 'вопросов')} пока без данных (возможны пропуски или логика показа).`
    );
  } else {
    positives.push(`Охват полный: ответы есть по всем вопросам конструктора.`);
  }

  // Сильные сигналы в выборах: высокая концентрация лидера
  const strong = qs
    .filter((q) => (q.type === 'radio' || q.type === 'checkbox') && (q.response_count || 0) > 0)
    .map((q) => {
      const t = topOption(q);
      return t ? { q, t } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.t.pct - a.t.pct)
    .slice(0, 2);

  for (const item of strong) {
    const qText = truncate(item.q.text, 82);
    const pct = item.t.pct;
    if (pct >= 70) {
      positives.push(`По вопросу «${qText}» лидер набрал ${pct}% — выраженная доминанта мнений.`);
    } else if (pct <= 35) {
      negatives.push(`По вопросу «${qText}» нет явного лидера (топ ${pct}%) — мнения распределены, стоит смотреть детали по сегментам.`);
    }
  }

  // Низкие оценки по шкалам/рейтингу (если диапазон известен)
  const scales = qs.filter((q) => (q.type === 'scale' || q.type === 'rating') && q.average != null);
  for (const q of scales.slice(0, 3)) {
    const avg = Number(q.average);
    const min = Number.isFinite(Number(q.min)) ? Number(q.min) : null;
    const max = Number.isFinite(Number(q.max)) ? Number(q.max) : null;
    const qText = truncate(q.text, 82);
    if (Number.isFinite(avg) && min != null && max != null && max > min) {
      const norm = (avg - min) / (max - min);
      if (norm <= 0.45) negatives.push(`Низкая оценка по шкале «${qText}»: среднее ${avg.toFixed(2)} из диапазона ${min}…${max}.`);
      else if (norm >= 0.75) positives.push(`Высокая оценка по шкале «${qText}»: среднее ${avg.toFixed(2)} из диапазона ${min}…${max}.`);
    }
  }

  // Текстовые ответы: есть/нет
  const textCount = qs.filter((q) => q.type === 'text' && (q.samples_total || 0) > 0).length;
  if (textCount > 0) positives.push(`Есть развернутые комментарии: текстовых вопросов с ответами — ${textCount}.`);

  const pick = (arr) => arr.filter(Boolean).slice(0, 5);
  const p = pick(positives);
  const n = pick(negatives);

  const lines = [];
  lines.push(`Выводы по опросу «${title}»`);
  lines.push('');
  lines.push('Положительные моменты:');
  lines.push(...(p.length ? p.map((x) => `- ${x}`) : ['- Не выявлено явных положительных сигналов по текущим данным.']));
  lines.push('');
  lines.push('Зоны внимания / отрицательные моменты:');
  lines.push(...(n.length ? n.map((x) => `- ${x}`) : ['- Явных проблемных сигналов не видно — проверьте детализацию по вопросам.']));
  lines.push('');
  lines.push('Итог:');
  lines.push(
    `Сфокусируйтесь на 1–2 ключевых темах из «зон внимания» и подтвердите их через детальные распределения и развернутые ответы.`
  );

  return lines.join('\n');
}

module.exports = { buildHeuristicNarrative };


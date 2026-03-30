/**
 * Детерминированная «аналитика» по снимку результатов (без LLM).
 * Формат заточен под богатый UI на фронте.
 */

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function truncate(s, n) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function topDistribution(q, totalResp) {
  const dist = q.distribution;
  if (!dist || !dist.length) return [];
  const sum = dist.reduce((a, d) => a + d.count, 0) || 1;
  return dist
    .map((d) => ({
      label: String(d.label),
      count: d.count,
      pct: Math.round((d.count / sum) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function buildHeuristicDashboard(snapshot) {
  const n = snapshot.total_responses;
  const qs = snapshot.questions || [];
  const qCount = qs.length;

  const activeQuestions = qs.filter((q) => q.response_count > 0).length;
  const coveragePct = qCount ? Math.round((activeQuestions / qCount) * 1000) / 10 : 0;

  const kpis = [
    {
      id: 'responses',
      label: 'Всего ответов',
      value: String(n),
      hint: 'завершённых анкет',
    },
    {
      id: 'questions',
      label: 'Вопросов',
      value: String(qCount),
      hint: 'в конструкторе опроса',
    },
    {
      id: 'coverage',
      label: 'Охват полей',
      value: `${coveragePct}%`,
      hint: 'вопросов с хотя бы одним ответом',
    },
  ];

  const highlights = [];
  const alerts = [];

  if (n === 0) {
    highlights.push({
      title: 'Данных пока нет',
      body: 'Когда респонденты начнут отправлять форму, здесь появятся распределения, средние и автоматические выводы.',
      tone: 'neutral',
    });
    alerts.push({
      title: 'Статус сбора',
      body: 'Опубликуйте опрос (статус «Опубликован») и проверьте публичную ссылку для респондентов.',
      tone: 'attention',
    });
  } else {
    highlights.push({
      title: 'Объём выборки',
      body: `Зафиксировано ${n} ${n === 1 ? 'ответ' : n < 5 ? 'ответа' : 'ответов'}. Сводка ниже строится по фактическим данным без внешних оценок.`,
      tone: 'positive',
    });

    if (coveragePct < 100) {
      alerts.push({
        title: 'Неполные профили',
        body: `${qCount - activeQuestions} вопросов пока без ответов — возможны пропуски или условная логика на форме.`,
        tone: 'attention',
      });
    }
  }

  const questions = qs.map((q) => {
    const bars = topDistribution(q, n);
    const top = bars[0];
    let detail = '';
    if (q.response_count === 0) {
      detail = 'Ответов по этому вопросу пока нет.';
    } else if (q.type === 'radio' || q.type === 'checkbox') {
      detail = top
        ? `Доминирует вариант «${truncate(top.label, 80)}» — ${top.pct}% ответов по этому вопросу.`
        : 'Распределение посчитано.';
    } else if (q.type === 'scale' || q.type === 'rating') {
      const avg = q.average != null ? q.average.toFixed(2) : '—';
      detail = `Среднее ${avg}, диапазон ${q.min ?? '—'}…${q.max ?? '—'} (${q.response_count} значений).`;
    } else if (q.type === 'text') {
      const n = q.samples_total ?? q.samples?.length ?? 0;
      detail =
        n > 0
          ? `Собрано ${n} текстовых ответов. На странице результатов — лучшие формулировки, облако слов и полный список по кнопке.`
          : 'Текстовых ответов нет.';
    } else {
      detail = `${q.response_count} ответов.`;
    }

    return {
      question_id: q.question_id,
      title: truncate(q.text, 120) || 'Без текста',
      type: q.type,
      response_count: q.response_count,
      detail,
      avg: q.average ?? null,
      min: q.min ?? null,
      max: q.max ?? null,
      bars: bars.slice(0, 4).map((b) => ({ label: truncate(b.label, 40), pct: b.pct })),
    };
  });

  /** «Рейтинг» вопросов по концентрации ответов (аналог теплокарты мысли) */
  const concentration = qs
    .filter((q) => (q.type === 'radio' || q.type === 'checkbox') && q.distribution?.length && q.response_count > 0)
    .map((q) => {
      const bars = topDistribution(q, n);
      const t = bars[0];
      return t ? { q, pct: t.pct } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct)[0];

  if (concentration && n > 0) {
    highlights.push({
      title: 'Самый однородный выбор',
      body: `По вопросу «${truncate(concentration.q.text, 70)}» ${concentration.pct}% ответов совпали с лидирующим вариантом — высокая концентрация мнений.`,
      tone: concentration.pct >= 70 ? 'attention' : 'neutral',
    });
  }

  return { kpis, highlights, alerts, questions, meta: { generated: 'heuristic', response_count: n } };
}

module.exports = { buildHeuristicDashboard, truncate };

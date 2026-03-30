import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import ResultChart from './ResultChart';
import AnimatedNumber from './AnimatedNumber';
import { barEase, springCard, staggerContainer, staggerItem } from '../motion/resultsMotion';
import { QUESTION_TYPE_LABEL_RU } from '../lib/labels';
import type { ResultQuestion } from '../types';

type Props = {
  q: ResultQuestion;
  index: number;
  onOpenTextAnswers?: (ctx: { question_id: number }) => void;
  /** Сводка и вывод по всем текстовым ответам на этот вопрос (отдельное окно). */
  onOpenTextInsight?: (questionId: number) => void;
};

export default function ResultQuestionCard({ q, index, onOpenTextAnswers, onOpenTextInsight }: Props) {
  const typeLabel = QUESTION_TYPE_LABEL_RU[q.type];
  const [chartsOpen, setChartsOpen] = useState(true);
  const hasChart =
    q.response_count > 0 &&
    (q.type === 'radio' || q.type === 'checkbox' || q.type === 'scale' || q.type === 'rating' || q.type === 'date');

  return (
    <motion.article
      id={`question-${q.question_id}`}
      className="card results-q-card"
      variants={staggerItem}
      initial="hidden"
      animate="show"
    >
      <motion.div initial="rest" whileHover="hover" whileTap="tap" variants={springCard}>
        <header className="results-q-header">
          <motion.span
            className="results-q-index"
            aria-hidden
            initial={{ scale: 0.6, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22, delay: index * 0.04 }}
          >
            {index + 1}
          </motion.span>
          <div className="results-q-heading">
            <h2 className="results-q-title">{q.text || 'Без текста'}</h2>
            <div className="results-q-meta">
              <span className="results-type-pill">{typeLabel}</span>
              <span className="results-q-n">
                {q.response_count === 0 ? (
                  'Нет ответов'
                ) : (
                  <>
                    <AnimatedNumber value={q.response_count} /> {pluralAnswers(q.response_count)}
                  </>
                )}
              </span>
            </div>
          </div>
        </header>

        <div className="results-q-body">
          {(q.type === 'radio' || q.type === 'checkbox' || q.type === 'date') && (
            <>
              {q.response_count > 0 ? (
                <>
                  {hasChart && (
                    <div className="results-chart-toggle-row">
                      <button
                        type="button"
                        className="btn results-chart-toggle"
                        onClick={() => setChartsOpen((v) => !v)}
                      >
                        {chartsOpen ? '▼ Скрыть график' : '▶ Показать график'}
                      </button>
                    </div>
                  )}
                  <AnimatePresence initial={false}>
                    {chartsOpen && (
                      <motion.div
                        className="results-chart-block"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: barEase }}
                        style={{ overflow: 'hidden' }}
                      >
                        <ResultChart q={q} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <p className="muted results-empty">На этот вопрос пока никто не ответил.</p>
              )}
            </>
          )}

          {(q.type === 'scale' || q.type === 'rating') && (
            <>
              {q.response_count > 0 ? (
                <>
                  <div className="results-chart-toggle-row">
                    <button
                      type="button"
                      className="btn results-chart-toggle"
                      onClick={() => setChartsOpen((v) => !v)}
                    >
                      {chartsOpen ? '▼ Скрыть график' : '▶ Показать график'}
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {chartsOpen && (
                      <motion.div
                        className="results-chart-block"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: barEase }}
                        style={{ overflow: 'hidden' }}
                      >
                        <ResultChart q={q} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <p className="muted results-empty">На этот вопрос пока никто не ответил.</p>
              )}
            </>
          )}

          {q.type === 'text' && (
            <>
              {(q.samples_total ?? 0) === 0 ? (
                <p className="muted results-empty">
                  {(q.response_count ?? 0) > 0
                    ? 'Текст ответа не удалось показать в сводке (нестандартный формат в базе). Откройте полный список ниже.'
                    : 'Нет текстовых ответов.'}
                </p>
              ) : (
                <>
                  <p className="muted results-text-highlight-kicker">Самые содержательные ответы</p>
                  {(q.samples_highlight || []).length === 0 ? (
                    <p className="muted results-empty">Краткая выборка пуста — откройте полный список комментариев.</p>
                  ) : (
                    <motion.ul
                      className="results-text-list"
                      variants={staggerContainer}
                      initial="hidden"
                      animate="show"
                    >
                      {(q.samples_highlight || []).map((s, i) => (
                        <motion.li
                          key={i}
                          className="results-text-item results-text-item--featured"
                          variants={staggerItem}
                          layout
                        >
                          <span className="results-text-bull" aria-hidden />
                          <blockquote className="results-text-quote">{s || '—'}</blockquote>
                        </motion.li>
                      ))}
                    </motion.ul>
                  )}
                </>
              )}
              {(onOpenTextAnswers || onOpenTextInsight) &&
                ((q.response_count ?? 0) > 0 || (q.samples_total ?? 0) > 0) && (
                <div className="results-text-actions results-text-actions--row">
                  {onOpenTextAnswers && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => onOpenTextAnswers({ question_id: q.question_id })}
                    >
                      Читать все ответы в окне ({q.samples_total ?? q.response_count})
                    </button>
                  )}
                  {onOpenTextInsight && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onOpenTextInsight(q.question_id)}
                    >
                      Сводка и вывод по ответам
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.article>
  );
}

function pluralAnswers(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'ответов';
  if (m10 === 1) return 'ответ';
  if (m10 >= 2 && m10 <= 4) return 'ответа';
  return 'ответов';
}

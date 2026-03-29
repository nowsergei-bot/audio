import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { requestTextQuestionInsights } from '../api/client';
import type { TextQuestionInsightsPayload } from '../types';

type Props = {
  open: boolean;
  onClose: () => void;
  surveyId: number;
  questionId: number | null;
};

export default function TextQuestionInsightModal({ open, onClose, surveyId, questionId }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<TextQuestionInsightsPayload | null>(null);

  useEffect(() => {
    if (!open || questionId == null || !Number.isFinite(surveyId)) {
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    setData(null);
    void requestTextQuestionInsights(surveyId, questionId)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [open, surveyId, questionId]);

  return (
    <AnimatePresence>
      {open && questionId != null && (
        <motion.div
          className="text-q-insight-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal
          aria-labelledby="text-q-insight-title"
        >
          <button type="button" className="text-q-insight-backdrop" aria-label="Закрыть" onClick={onClose} />
          <motion.div
            className="text-q-insight-panel card glass-surface"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <div className="text-q-insight-head">
              <div>
                <h2 id="text-q-insight-title">Сводка по текстовым ответам</h2>
                <p className="muted text-q-insight-sub">
                  Автоматическая компиляция и при наличии ключа — вывод нейросети по всем ответам на этот вопрос.
                </p>
              </div>
              <button type="button" className="btn text-q-insight-close" onClick={onClose}>
                Закрыть
              </button>
            </div>

            <div className="text-q-insight-scroll">
              {loading && <p className="muted">Загрузка и анализ…</p>}
              {err && <p className="err">{err}</p>}
              {data && !loading && (
                <>
                  <p className="text-q-insight-meta muted">
                    Учтено ответов: <strong>{data.answers_used}</strong>
                    {data.source === 'llm_hybrid' ? ' · автосводка + нейросеть' : ' · только автосводка (ключ OPENAI_API_KEY не задан или модель недоступна)'}
                  </p>
                  {data.question_text && (
                    <blockquote className="text-q-insight-quote">&ldquo;{data.question_text}&rdquo;</blockquote>
                  )}
                  <section className="text-q-insight-section">
                    <h3 className="text-q-insight-h3">Компиляция (автоматически)</h3>
                    <pre className="text-q-insight-pre">{data.heuristic_summary}</pre>
                  </section>
                  {data.top_terms.length > 0 && (
                    <section className="text-q-insight-section">
                      <h3 className="text-q-insight-h3">Частые слова</h3>
                      <ul className="text-q-insight-terms">
                        {data.top_terms.map((t) => (
                          <li key={t.word}>
                            <span className="text-q-insight-term">{t.word}</span>
                            <span className="muted">×{t.count}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {data.narrative && (
                    <section className="text-q-insight-section text-q-insight-section--llm">
                      <h3 className="text-q-insight-h3">Логический вывод (нейросеть)</h3>
                      <div className="text-q-insight-narrative">{data.narrative}</div>
                    </section>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import type { TextAnswersPage } from '../types';

export type TextAnswersFetch = (params: {
  question_id?: number;
  q?: string;
  offset: number;
  limit?: number;
}) => Promise<TextAnswersPage>;

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  textFetch: TextAnswersFetch;
  questionOptions?: { id: number; label: string }[];
  initialQuestionId?: number;
  initialQ?: string;
};

export default function TextAnswersExplorerModal({
  open,
  onClose,
  title = 'Текстовые ответы',
  textFetch,
  questionOptions,
  initialQuestionId,
  initialQ,
}: Props) {
  const [questionId, setQuestionId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TextAnswersPage['rows']>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (offset: number, append: boolean, qid?: number, q?: string) => {
      setLoading(true);
      setErr(null);
      try {
        const page = await textFetch({
          question_id: qid,
          q: q && q.trim() ? q.trim() : undefined,
          offset,
          limit: 50,
        });
        setTotal(page.total);
        setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
        if (!append) setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [textFetch]
  );

  useEffect(() => {
    if (!open) return;
    setQuestionId(initialQuestionId ?? '');
    setSearch(initialQ ?? '');
    const qid = initialQuestionId != null ? initialQuestionId : undefined;
    const q = initialQ?.trim() || undefined;
    void fetchPage(0, false, qid, q);
  }, [open, initialQuestionId, initialQ, fetchPage]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qid = questionId === '' ? undefined : questionId;
    void fetchPage(0, false, qid, search);
  }

  const hasMore = rows.length < total;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="text-answers-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal
          aria-labelledby="text-answers-modal-title"
        >
          <button type="button" className="text-answers-modal-backdrop" aria-label="Закрыть" onClick={onClose} />
          <motion.div
            className="text-answers-modal-panel card glass-surface"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <div className="text-answers-modal-head">
              <h2 id="text-answers-modal-title">{title}</h2>
              <button type="button" className="btn text-answers-modal-close" onClick={onClose}>
                Закрыть
              </button>
            </div>
            <form className="text-answers-modal-filters" onSubmit={onSearchSubmit}>
              {questionOptions && questionOptions.length > 0 && (
                <label className="text-answers-modal-field">
                  <span className="text-answers-modal-label">Вопрос</span>
                  <select
                    value={questionId === '' ? '' : String(questionId)}
                    onChange={(e) => setQuestionId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">Все текстовые вопросы</option>
                    {questionOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-answers-modal-field text-answers-modal-field-grow">
                <span className="text-answers-modal-label">Поиск по тексту</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Слово или фраза…"
                />
              </label>
              <button type="submit" className="btn primary" disabled={loading}>
                Найти
              </button>
            </form>
            <p className="muted text-answers-modal-meta">
              Показано {rows.length} из {total}
            </p>
            <div className="text-answers-modal-body">
              {err && <p className="err text-answers-modal-err">{err}</p>}
              <ul className="text-answers-modal-list">
                {rows.map((r, i) => (
                  <li key={`${r.question_id}-${i}-${r.submitted_at}`} className="text-answers-modal-item">
                    <span className="text-answers-modal-item-q">Вопрос #{r.question_id}</span>
                    <p className="text-answers-modal-item-text">{r.text || '—'}</p>
                    {r.submitted_at && <span className="text-answers-modal-item-date muted">{r.submitted_at}</span>}
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="text-answers-modal-more">
                  <button
                    type="button"
                    className="btn"
                    disabled={loading}
                    onClick={() => {
                      const qid = questionId === '' ? undefined : questionId;
                      void fetchPage(rows.length, true, qid, search);
                    }}
                  >
                    {loading ? 'Загрузка…' : 'Загрузить ещё'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

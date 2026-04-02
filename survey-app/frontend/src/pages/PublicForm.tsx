import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicSurvey, submitResponse } from '../api/client';
import PublicCampusSlideshow from '../components/PublicCampusSlideshow';
import PublicDictationField from '../components/PublicDictationField';
import type { AnswerSubmit, Question, Survey } from '../types';

const RESP_PREFIX = 'survey_resp_id_';
const DONE_PREFIX = 'survey_done_';

function getRespondentId(accessLink: string): string {
  const key = RESP_PREFIX + accessLink;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function alreadyDone(accessLink: string): boolean {
  return localStorage.getItem(DONE_PREFIX + accessLink) === '1';
}

function markDone(accessLink: string) {
  localStorage.setItem(DONE_PREFIX + accessLink, '1');
}

function initialAnswers(questions: Question[]): Record<number, string | number | string[]> {
  const acc: Record<number, string | number | string[]> = {};
  for (const q of questions) {
    if (q.type === 'checkbox') acc[q.id] = [];
    else if (q.type === 'scale' || q.type === 'rating') {
      // Не подставляем min (часто 1) — иначе «не трогал слайдер» уходит в статистику как реальный голос.
      acc[q.id] = '';
    } else if (q.type === 'date') {
      acc[q.id] = '';
    } else acc[q.id] = '';
  }
  return acc;
}

function isEmptyAnswer(q: Question, value: string | number | string[], otherText?: string): boolean {
  if (q.type === 'checkbox') {
    const arr = Array.isArray(value) ? value : [];
    if (!arr.length) return true;
    if (arr.includes('Другое')) return !(otherText || '').trim();
    return false;
  }
  if (q.type === 'radio') {
    const s = String(value ?? '').trim();
    if (!s) return true;
    if (s === 'Другое') return !(otherText || '').trim();
    return false;
  }
  if (q.type === 'text' || q.type === 'date') {
    return !String(value ?? '').trim();
  }
  if (q.type === 'scale' || q.type === 'rating') {
    if (value === '' || value === undefined || value === null) return true;
    const n = Number(value);
    return !Number.isFinite(n);
  }
  return false;
}

const cardEnter = {
  hidden: { opacity: 0, y: 22, scale: 0.98 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function PublicForm() {
  const { accessLink = '' } = useParams();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<number, string | number | string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(() => alreadyDone(accessLink));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDone(alreadyDone(accessLink));
  }, [accessLink]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const s = await getPublicSurvey(accessLink);
        if (cancelled) return;
        setSurvey(s);
        setAnswers(initialAnswers(s.questions || []));
        setOtherTexts({});
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessLink]);

  const questions = survey?.questions || [];

  const payload = useMemo((): AnswerSubmit[] => {
    return questions.map((q) => {
      const v = answers[q.id];
      const other = (otherTexts[q.id] || '').trim();
      const hasOtherOpt = Array.isArray(q.options) && q.options.map(String).includes('Другое');

      if ((q.type === 'radio' || q.type === 'checkbox') && hasOtherOpt) {
        if (q.type === 'radio') {
          if (v === 'Другое') {
            return { question_id: q.id, value: other ? `Другое: ${other}` : 'Другое' };
          }
          return { question_id: q.id, value: v as string };
        }
        const arr = Array.isArray(v) ? v.map(String) : [];
        const out = arr.map((x) => (x === 'Другое' ? (other ? `Другое: ${other}` : 'Другое') : x));
        return { question_id: q.id, value: out };
      }

      return { question_id: q.id, value: v as string | number | string[] };
    });
  }, [questions, answers, otherTexts]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const missed = questions.find((q) => q.required !== false && isEmptyAnswer(q, answers[q.id], otherTexts[q.id]));
    if (missed) {
      setErr(`Заполните обязательный вопрос: «${missed.text}»`);
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const rid = getRespondentId(accessLink);
      await submitResponse(accessLink, rid, payload);
      markDone(accessLink);
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  }

  const bg = (
    <div className="public-form-bg" aria-hidden>
      <div className="public-form-gradient-layer" />
      <motion.div
        className="public-form-orb public-form-orb--1"
        animate={{ opacity: [0.25, 0.5, 0.28], scale: [1, 1.08, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="public-form-orb public-form-orb--2"
        animate={{ opacity: [0.2, 0.42, 0.22], scale: [1, 1.12, 1] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />
      <motion.div
        className="public-form-orb public-form-orb--3"
        animate={{ opacity: [0.22, 0.48, 0.24] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />
      <motion.div
        className="public-form-orb public-form-orb--4"
        animate={{ y: [0, -14, 0], opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );

  if (loading) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="page public-form-root">
          {bg}
          <div className="public-form-stack">
            <motion.div
              className="card public-form-glass-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                className="muted"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                Загрузка опроса…
              </motion.div>
              <motion.div
                style={{ marginTop: 12, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
              >
                <motion.div
                  style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg, transparent, rgba(227,6,19,0.85), transparent)' }}
                  animate={{ x: ['-100%', '280%'] }}
                  transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </MotionConfig>
    );
  }

  if (err && !survey) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="page public-form-root">
          {bg}
          <div className="public-form-stack">
            <motion.div
              className="card public-form-glass-card"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <h1 style={{ marginTop: 0 }}>Опрос недоступен</h1>
              <p className="err">{err}</p>
            </motion.div>
          </div>
        </div>
      </MotionConfig>
    );
  }

  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="page public-form-root">
          {bg}
          <div className="public-form-stack">
            <motion.div
              className="card public-form-glass-card"
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            >
              <motion.div
                className="public-done-icon"
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: [0, 8, -4, 0] }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 400, damping: 12 }}
                aria-hidden
              >
                ✓
              </motion.div>
              <h1 style={{ marginTop: '0.35rem' }}>Спасибо!</h1>
              <p className="muted">Ваши ответы сохранены.</p>
            </motion.div>
          </div>
        </div>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="page public-form-root">
        {bg}
        <form className="public-form-stack" onSubmit={(e) => void onSubmit(e)}>
          <motion.div
            className="card public-form-glass-card"
            custom={0}
            variants={cardEnter}
            initial="hidden"
            animate="show"
          >
            <motion.h1
              style={{ marginTop: 0 }}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              {survey?.title || 'Опрос'}
            </motion.h1>
            {survey?.description && <p className="muted">{survey.description}</p>}
            <AnimatePresence>
              {err && (
                <motion.p
                  className="err"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {err}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          <PublicCampusSlideshow active sources={survey?.media?.photos?.map((p) => p.src) || undefined} />

          <AnimatePresence mode="popLayout">
            {questions.map((q, i) => (
              <motion.div
                key={q.id}
                className="card public-form-glass-card"
                custom={i + 1}
                variants={cardEnter}
                initial="hidden"
                animate="show"
                layout
              >
                <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                  <strong className="public-question-title">
                    {q.text}
                    {q.required !== false && <span className="public-required-mark"> *</span>}
                  </strong>
                </label>
                {q.type === 'radio' && (
                  <div className="public-choice-row" role="radiogroup" aria-label={q.text}>
                    {(Array.isArray(q.options) ? q.options : []).map((opt) => {
                      const label = String(opt);
                      const selected = answers[q.id] === label;
                      return (
                        <div key={label} style={{ width: '100%' }}>
                          <motion.button
                            type="button"
                            className={`public-choice-btn${selected ? ' is-selected' : ''}`}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: label }))}
                            aria-checked={selected}
                            role="radio"
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                          >
                            <span className="public-choice-dot" />
                            <span>{label}</span>
                          </motion.button>
                          {label === 'Другое' && selected && (
                            <input
                              className="public-other-input"
                              value={otherTexts[q.id] ?? ''}
                              onChange={(e) => setOtherTexts((m) => ({ ...m, [q.id]: e.target.value }))}
                              placeholder="Уточните…"
                              style={{ marginTop: '0.35rem' }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {q.type === 'checkbox' && (
                  <div className="public-choice-row">
                    {(Array.isArray(q.options) ? q.options : []).map((opt) => {
                      const label = String(opt);
                      const arr = (answers[q.id] as string[]) || [];
                      const checked = arr.includes(label);
                      return (
                        <div key={label} style={{ width: '100%' }}>
                          <motion.button
                            type="button"
                            className={`public-choice-btn${checked ? ' is-selected' : ''}`}
                            onClick={() => {
                              setAnswers((a) => {
                                const cur = new Set((a[q.id] as string[]) || []);
                                if (cur.has(label)) cur.delete(label);
                                else cur.add(label);
                                return { ...a, [q.id]: [...cur] };
                              });
                            }}
                            aria-pressed={checked}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                          >
                            <span className="public-choice-dot" />
                            <span>{label}</span>
                          </motion.button>
                          {label === 'Другое' && checked && (
                            <div style={{ marginTop: '0.35rem' }}>
                              <PublicDictationField
                                multiline={false}
                                inputClassName="public-other-input"
                                value={otherTexts[q.id] ?? ''}
                                onChange={(v) => setOtherTexts((m) => ({ ...m, [q.id]: v }))}
                                placeholder="Уточните…"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {(q.type === 'scale' || q.type === 'rating') && (
                  <>
                    {q.required !== false && !Number.isFinite(Number(answers[q.id])) && (
                      <p className="muted" style={{ margin: '0 0 0.35rem' }}>
                        Выберите значение на шкале.
                      </p>
                    )}
                    {q.required === false && !Number.isFinite(Number(answers[q.id])) && (
                      <p className="muted" style={{ margin: '0 0 0.35rem' }}>
                        Необязательный вопрос — можно пропустить.
                      </p>
                    )}
                    <div className="public-range-wrap">
                      <input
                        className="public-range"
                        type="range"
                        min={(q.options as { min?: number })?.min ?? 1}
                        max={(q.options as { max?: number })?.max ?? (q.type === 'rating' ? 5 : 10)}
                        step={1}
                        value={
                          Number.isFinite(Number(answers[q.id]))
                            ? Number(answers[q.id])
                            : Number((q.options as { min?: number })?.min ?? 1)
                        }
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))}
                      />
                    </div>
                    <motion.p
                      className="public-range-value"
                      key={String(answers[q.id])}
                      initial={{ scale: 0.85, opacity: 0.6 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    >
                      {Number.isFinite(Number(answers[q.id])) ? String(answers[q.id]) : '— не выбрано —'}
                    </motion.p>
                  </>
                )}
                {q.type === 'date' && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <input
                      type="date"
                      className="field"
                      value={String(answers[q.id] ?? '')}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    />
                  </div>
                )}
                {q.type === 'text' && (
                  <PublicDictationField
                    value={String(answers[q.id] ?? '')}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  />
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          <motion.div
            className="public-submit-row"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(0.15 + questions.length * 0.04, 0.5) }}
          >
            <div className="public-submit-actions">
              <motion.button
                type="submit"
                className="btn primary public-btn-submit"
                disabled={submitting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {submitting ? 'Отправка…' : 'Отправить ответы'}
              </motion.button>
            </div>
          </motion.div>
        </form>
      </div>
    </MotionConfig>
  );
}

import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDirectorLessonGroups } from '../api/client';
import { fadeIn } from '../motion/resultsMotion';
import type { DirectorLessonGroupsPayload } from '../types';

export default function SurveyDirectorLessonsPage() {
  const { directorToken: rawToken } = useParams();
  const directorToken = rawToken ? decodeURIComponent(rawToken) : '';
  const [payload, setPayload] = useState<DirectorLessonGroupsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!directorToken) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await getDirectorLessonGroups(directorToken);
      setPayload(p);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить список уроков');
    } finally {
      setLoading(false);
    }
  }, [directorToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!directorToken) {
    return (
      <div className="page director-survey-page director-survey-page--narrow">
        <p className="err">Некорректная ссылка</p>
      </div>
    );
  }

  const basePath = `/director/${encodeURIComponent(directorToken)}`;
  const overviewPath = basePath;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-admin director-survey-page">
        <motion.div className="page director-survey-inner" {...fadeIn}>
          <header className="director-survey-hero">
            <p className="director-survey-kicker">Сводка для руководителя</p>
            <h1 className="director-survey-title">Уроки по ответам родителей</h1>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              <Link to={overviewPath} className="phenomenal-report-back-link">
                ← Общая сводка по всему опросу
              </Link>
            </p>
            {loading && <p className="muted director-survey-loading">Загрузка…</p>}
            {err && <p className="err">{err}</p>}
            {payload?.hint && (
              <p className="muted" style={{ marginTop: '0.75rem', maxWidth: '40rem' }}>
                {payload.hint}
              </p>
            )}
          </header>

          {payload && payload.groups.length > 0 && (
            <ul className="director-lessons-list" style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0' }}>
              {payload.groups.map((g) => (
                <li key={g.lesson_key} style={{ marginBottom: '0.65rem' }}>
                  <Link
                    to={`${basePath}/lessons/${g.lesson_key}`}
                    className="card glass-surface director-lessons-card"
                    style={{
                      display: 'block',
                      padding: '1rem 1.15rem',
                      textDecoration: 'none',
                      color: 'inherit',
                      borderRadius: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{g.teacher}</div>
                    <div className="muted" style={{ fontSize: '0.92rem', marginTop: 4 }}>
                      Класс: {g.class_label} · Шифр: {g.lesson_code}
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem', marginTop: 6 }}>
                      Ответов: {g.response_count}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {payload && payload.groups.length === 0 && !loading && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              {payload.lesson_split.mode === 'entire_survey'
                ? 'Пока нет ответов на этот опрос.'
                : 'Пока нет ответов с заполненным шифром урока (и при необходимости классом и педагогом).'}
            </p>
          )}
        </motion.div>
      </div>
    </MotionConfig>
  );
}

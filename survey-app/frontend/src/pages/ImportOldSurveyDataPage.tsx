import { motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSurvey, importRowsFromXlsxParse, listSurveys } from '../api/client';
import { parseSurveyXlsxBuffer } from '../lib/xlsxImport';
import { fadeIn } from '../motion/resultsMotion';
import type { ParsedImportBatch } from '../lib/xlsxImport';
import type { Survey } from '../types';

export default function ImportOldSurveyDataPage() {
  const navigate = useNavigate();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [surveyId, setSurveyId] = useState<number | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [batch, setBatch] = useState<ParsedImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: { row: number; error: string }[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSurveys();
        if (cancelled) return;
        setSurveys(list);
        if (!surveyId && list.length) setSurveyId(list[0].id);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Не удалось загрузить список опросов');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!surveyId) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      setSurvey(null);
      setBatch(null);
      setResult(null);
      try {
        const s = await getSurvey(surveyId);
        if (cancelled) return;
        setSurvey(s);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Не удалось загрузить опрос');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surveyId]);

  const canParse = Boolean(survey?.questions?.length);

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (!f.name.toLowerCase().endsWith('.xlsx')) {
        setErr('Нужен файл .xlsx');
        return;
      }
      if (!survey?.questions?.length) {
        setErr('Сначала выберите опрос с вопросами');
        return;
      }
      setBusy(true);
      setErr(null);
      setResult(null);
      try {
        const buf = await f.arrayBuffer();
        const parsed = parseSurveyXlsxBuffer(buf, survey.questions);
        setBatch(parsed);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Не удалось разобрать Excel');
        setBatch(null);
      } finally {
        setBusy(false);
      }
    },
    [survey?.questions],
  );

  const summary = useMemo(() => {
    if (!batch) return null;
    const headersMatched = batch.columnMap.filter((x) => x != null).length;
    return { rows: batch.rows.length, warnings: batch.warnings.length, headersMatched, headersTotal: batch.headers.length };
  }, [batch]);

  async function doImport() {
    if (!surveyId || !batch) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await importRowsFromXlsxParse(surveyId, batch.rows);
      setResult({ imported: r.imported, skipped: r.skipped, errors: r.errors || [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Импорт не удался');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div className="page import-workbook-page" {...fadeIn}>
        <motion.header className="card import-workbook-hero glass-surface" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="admin-dash-kicker">Пульс · подгрузка данных</p>
          <h1 className="admin-dash-title">Подгрузка данных из старых опросов</h1>
          <p className="muted admin-dash-lead">
            Выберите существующий опрос и загрузите Excel с ответами. Мы сопоставим столбцы с вопросами и добавим ответы в базу — после этого
            страница результатов построит аналитику.
          </p>
          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <Link className="btn" to="/surveys/new">
              ← К шаблонам
            </Link>
            {surveyId && (
              <button type="button" className="btn primary" onClick={() => navigate(`/surveys/${surveyId}/results`)}>
                Открыть результаты
              </button>
            )}
          </div>
        </motion.header>

        <motion.section className="card import-workbook-drop glass-surface" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="admin-dash-h2">1) Выберите опрос</h2>
          <label style={{ display: 'block', marginTop: '0.5rem' }}>
            Опрос
            <select value={surveyId ?? ''} onChange={(e) => setSurveyId(e.target.value ? Number(e.target.value) : null)}>
              {surveys.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} · {s.title || 'Без названия'}
                </option>
              ))}
            </select>
          </label>
          {!canParse && <p className="muted">У опроса нет вопросов — импортировать ответы не получится.</p>}
        </motion.section>

        <motion.section className="card import-workbook-drop glass-surface" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="admin-dash-h2">2) Загрузите Excel (.xlsx)</h2>
          <label className="btn primary import-workbook-file-btn">
            {busy ? 'Обработка…' : 'Выбрать Excel'}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={busy || !canParse} onChange={(ev) => void onPick(ev)} />
          </label>
          {summary && (
            <p className="muted" style={{ marginTop: '0.6rem' }}>
              Строк к импорту: <strong>{summary.rows}</strong>. Сопоставлено столбцов: <strong>{summary.headersMatched}</strong> из {summary.headersTotal}.
              Предупреждений: <strong>{summary.warnings}</strong>.
            </p>
          )}
          {batch?.warnings?.length ? (
            <ul className="muted" style={{ marginTop: '0.5rem' }}>
              {batch.warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          {err && <p className="err">{err}</p>}
        </motion.section>

        <motion.section className="card glass-surface" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h2 className="admin-dash-h2">3) Импортировать ответы</h2>
          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy || !batch || !surveyId} onClick={() => void doImport()}>
              {busy ? 'Импорт…' : 'Импортировать в базу'}
            </button>
          </div>
          {result && (
            <p className="muted" style={{ marginTop: '0.6rem' }}>
              Импортировано: <strong>{result.imported}</strong>, пропущено: <strong>{result.skipped}</strong>, ошибок: <strong>{result.errors.length}</strong>.
            </p>
          )}
          {result?.errors?.length ? (
            <ul className="muted" style={{ marginTop: '0.5rem' }}>
              {result.errors.slice(0, 8).map((e, i) => (
                <li key={i}>
                  Строка {e.row}: {e.error}
                </li>
              ))}
            </ul>
          ) : null}
        </motion.section>
      </motion.div>
    </MotionConfig>
  );
}


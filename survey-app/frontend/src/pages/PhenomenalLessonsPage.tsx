import { motion } from 'framer-motion';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSurveys, postPhenomenalLessonsMerge } from '../api/client';
import AiWaitIndicator from '../components/AiWaitIndicator';
import { adminStagger, adminStaggerItem } from '../motion/adminMotion';
import {
  readParentResponsesSheetArrayBuffer,
  type ParseParentResponsesResult,
} from '../lib/phenomenalLessons/parseParentResponsesSheet';
import {
  buildLessonMatchKey,
  readTeacherChecklistAprilArrayBuffer,
  type ParseTeacherChecklistResult,
  type TeacherLessonChecklistRow,
} from '../lib/phenomenalLessons/parseTeacherChecklistApril';
import PhenomenalBlockCompetencyPanel from '../lib/phenomenalLessons/PhenomenalBlockCompetencyPanel';
import PhenomenalCompetencyCharts from '../lib/phenomenalLessons/PhenomenalCompetencyCharts';
import { teacherRowCompetencySummary } from '../lib/phenomenalLessons/competencyScores';
import { PHENOMENAL_REPORT_SEED_KEY } from '../lib/phenomenalLessons/reportDraftTypes';
import type { PhenomenalLessonsMergePayload, Survey } from '../types';

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function PhenomenalUploadRowCompetency({ row }: { row: TeacherLessonChecklistRow }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => teacherRowCompetencySummary(row), [row]);
  return (
    <details
      className="phenomenal-upload-row-competency"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="phenomenal-upload-row-competency-summary">{summary}</summary>
      {open ? (
        <div className="phenomenal-upload-row-competency-panel">
          <PhenomenalBlockCompetencyPanel source="teacherRow" row={row} />
        </div>
      ) : null}
    </details>
  );
}

function answersLabeledPreview(answers: Record<string, unknown>, maxLen: number): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(answers)) {
    const s = `${k}: ${String(v)}`.replace(/\s+/g, ' ').trim();
    parts.push(s);
  }
  const t = parts.join(' · ');
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}

export default function PhenomenalLessonsPage() {
  const navigate = useNavigate();
  const [parseResult, setParseResult] = useState<ParseTeacherChecklistResult | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [surveysErr, setSurveysErr] = useState<string | null>(null);
  const [surveyId, setSurveyId] = useState<string>('');
  const [mergeThreshold, setMergeThreshold] = useState<string>('0.72');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<PhenomenalLessonsMergePayload | null>(null);
  const [parentFileLabel, setParentFileLabel] = useState<string>('');
  const [parentFileError, setParentFileError] = useState<string | null>(null);
  const [parentParseResult, setParentParseResult] = useState<ParseParentResponsesResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSurveys();
        if (!cancelled) {
          setSurveys(list);
          setSurveysErr(null);
        }
      } catch (e) {
        if (!cancelled) setSurveysErr(e instanceof Error ? e.message : 'Не удалось загрузить опросы');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runMerge = useCallback(async () => {
    setMergeErr(null);
    setMergeResult(null);
    const teacherRows = parseResult?.rows;
    if (!teacherRows?.length) {
      setMergeErr('Сначала загрузите файл чек-листа педагогов (.xlsx).');
      return;
    }
    const parentFromExcel = parentParseResult?.rows?.length ? parentParseResult.rows : null;
    const sid = Number(surveyId);
    if (!parentFromExcel && (!Number.isFinite(sid) || sid < 1)) {
      setMergeErr('Выберите опрос родителей в системе или загрузите второй Excel с ответами родителей.');
      return;
    }
    const th = Number(mergeThreshold.replace(',', '.'));
    const threshold = Number.isFinite(th) ? Math.min(1, Math.max(0, th)) : 0.72;
    setMergeBusy(true);
    try {
      const data = await postPhenomenalLessonsMerge(teacherRows, {
        surveyId: parentFromExcel ? undefined : sid,
        parentRows: parentFromExcel ?? undefined,
        parentSourceTitle: parentFromExcel ? parentFileLabel || undefined : undefined,
        confidenceThreshold: threshold,
      });
      setMergeResult(data);
    } catch (e) {
      setMergeErr(e instanceof Error ? e.message : 'Ошибка слияния');
    } finally {
      setMergeBusy(false);
    }
  }, [surveyId, parseResult, parentParseResult, parentFileLabel, mergeThreshold]);

  const onFile = useCallback(async (f: File | null) => {
    setFileError(null);
    setParseResult(null);
    setFileLabel('');
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) {
      setFileError('Нужен файл .xlsx (экспорт формы).');
      return;
    }
    setFileLabel(f.name);
    try {
      const buf = await f.arrayBuffer();
      const res = readTeacherChecklistAprilArrayBuffer(buf);
      setParseResult(res);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    }
  }, []);

  const onParentFile = useCallback(async (f: File | null) => {
    setParentFileError(null);
    setParentParseResult(null);
    setParentFileLabel('');
    setMergeResult(null);
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) {
      setParentFileError('Нужен файл .xlsx с ответами родителей.');
      return;
    }
    setParentFileLabel(f.name);
    try {
      const buf = await f.arrayBuffer();
      const res = readParentResponsesSheetArrayBuffer(buf);
      setParentParseResult(res);
    } catch (e) {
      setParentFileError(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    }
  }, []);

  const stats = useMemo(() => {
    const rows = parseResult?.rows ?? [];
    const scores = rows.map((r) => r.methodologicalScore).filter((n): n is number => n != null);
    const mean =
      scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return { n: rows.length, mean };
  }, [parseResult]);

  const parentStats = useMemo(() => {
    const n = parentParseResult?.rows.length ?? 0;
    return { n };
  }, [parentParseResult]);

  const canRunMerge =
    Boolean(parseResult?.rows.length) &&
    (parentStats.n > 0 || (Number(surveyId) >= 1 && Number.isFinite(Number(surveyId))));

  const openReportFromMerge = useCallback(() => {
    if (!mergeResult?.merged?.length) return;
    sessionStorage.setItem(
      PHENOMENAL_REPORT_SEED_KEY,
      JSON.stringify({ kind: 'merge', payload: mergeResult }),
    );
    navigate('/analytics/phenomenal/report?from=seed');
  }, [mergeResult, navigate]);

  const openReportFromTeachersOnly = useCallback(() => {
    const rows = parseResult?.rows;
    if (!rows?.length) return;
    sessionStorage.setItem(
      PHENOMENAL_REPORT_SEED_KEY,
      JSON.stringify({ kind: 'teacher', rows, fileLabel: fileLabel || '' }),
    );
    navigate('/analytics/phenomenal/report?from=seed');
  }, [parseResult, fileLabel, navigate]);

  return (
    <motion.div
      className="page phenomenal-lessons-page"
      variants={adminStagger}
      initial="hidden"
      animate="show"
    >
      <motion.section className="card glass-surface" variants={adminStaggerItem}>
        <p className="admin-dash-kicker">Аналитика · феноменальные уроки</p>
        <h1 className="admin-dash-title">Педагоги и родители</h1>
        <p className="muted admin-dash-lead">
          Чек-лист педагогов — первый Excel. Ответы родителей можно взять из{' '}
          <strong>опроса в системе</strong> или из <strong>второго Excel</strong> (как выгрузка Google Forms: первая
          строка — заголовки столбцов). Если загружен файл родителей, он <strong>имеет приоритет</strong> над выбранным
          опросом. Нейросеть на сервере сопоставит строки по дате, классу/шифру и ФИО ведущих.
        </p>

        <div className="phenomenal-upload-block" style={{ marginTop: '1rem' }}>
          <label className="btn btn-secondary phenomenal-file-label">
            Загрузить чек-лист педагогов (.xlsx)
            <input
              type="file"
              accept=".xlsx,.xls"
              className="phenomenal-file-input"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {fileLabel ? (
            <span className="muted" style={{ marginLeft: '0.75rem' }}>
              {fileLabel}
            </span>
          ) : null}
        </div>
        {fileError ? <p className="err" style={{ marginTop: '0.75rem' }}>{fileError}</p> : null}
        {parseResult?.warnings.map((w) => (
          <p key={w} className="muted" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {w}
          </p>
        ))}

        {parseResult && (
          <p style={{ marginTop: '1rem' }}>
            Лист: <strong>{parseResult.sheetName}</strong>, строк ответов: <strong>{stats.n}</strong>
            {stats.mean != null ? (
              <>
                , средняя оценка методики (из колонки 10 бала): <strong>{stats.mean.toFixed(2)}</strong>
              </>
            ) : null}
          </p>
        )}

        {parseResult && parseResult.rows.length > 0 ? (
          <>
            <div className="phenomenal-competency-on-upload" style={{ marginTop: '1rem' }}>
              <PhenomenalCompetencyCharts mode="teacherRows" rows={parseResult.rows} />
            </div>
            <div className="phenomenal-report-entry" style={{ marginTop: '0.75rem' }}>
              <motion.button
                type="button"
                className="btn"
                onClick={openReportFromTeachersOnly}
                whileTap={{ scale: 0.97 }}
              >
                Черновик отчёта только из Excel педагогов
              </motion.button>
              <span className="muted" style={{ marginLeft: '0.65rem', fontSize: '0.88rem' }}>
                Блоки по строкам чек-листа; отзывы родителей — вручную в редакторе.
              </span>
            </div>
          </>
        ) : null}

        <div className="phenomenal-upload-block" style={{ marginTop: '1rem' }}>
          <label className="btn btn-secondary phenomenal-file-label">
            Ответы родителей (.xlsx), опционально
            <input
              type="file"
              accept=".xlsx,.xls"
              className="phenomenal-file-input"
              onChange={(e) => void onParentFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {parentFileLabel ? (
            <span className="muted" style={{ marginLeft: '0.75rem' }}>
              {parentFileLabel}
            </span>
          ) : null}
        </div>
        {parentFileError ? <p className="err" style={{ marginTop: '0.5rem' }}>{parentFileError}</p> : null}
        {parentParseResult?.warnings.map((w) => (
          <p key={w} className="muted" style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>
            {w}
          </p>
        ))}
        {parentParseResult && parentStats.n > 0 ? (
          <p className="muted" style={{ marginTop: '0.35rem', fontSize: '0.9rem' }}>
            Родители из файла: лист <strong>{parentParseResult.sheetName}</strong>, строк:{' '}
            <strong>{parentStats.n}</strong>. Опрос из списка ниже для слияния не используется.
          </p>
        ) : null}

        <div className="phenomenal-merge-toolbar" style={{ marginTop: '1.25rem' }}>
          <label className="phenomenal-merge-field">
            <span className="muted">Опрос родителей (если нет второго Excel)</span>
            <select
              className="excel-analytics-select"
              value={surveyId}
              onChange={(e) => setSurveyId(e.target.value)}
              disabled={parentStats.n > 0}
              aria-label="Опрос для слияния с чек-листом"
            >
              <option value="">— выберите —</option>
              {surveys.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.title || `Опрос #${s.id}`} (id {s.id})
                </option>
              ))}
            </select>
          </label>
          <label className="phenomenal-merge-field">
            <span className="muted">Порог уверенности</span>
            <input
              type="text"
              className="phenomenal-merge-threshold-input"
              inputMode="decimal"
              value={mergeThreshold}
              onChange={(e) => setMergeThreshold(e.target.value)}
              aria-label="Минимальная уверенность ИИ для автослияния, 0–1"
            />
          </label>
          <motion.button
            type="button"
            className="btn primary"
            disabled={mergeBusy || !canRunMerge}
            onClick={() => void runMerge()}
            whileTap={{ scale: 0.97 }}
          >
            {mergeBusy ? 'Слияние с ИИ…' : 'Автослияние с ИИ'}
          </motion.button>
        </div>
        {surveysErr ? <p className="err" style={{ marginTop: '0.5rem' }}>{surveysErr}</p> : null}
        {mergeErr ? <p className="err" style={{ marginTop: '0.5rem' }}>{mergeErr}</p> : null}
        <AiWaitIndicator
          active={mergeBusy}
          className="phenomenal-merge-wait"
          label="Нейросеть сопоставляет ответы родителей со строками чек-листа"
          typicalMinSec={25}
          typicalMaxSec={90}
          slowAfterSec={120}
          hint="Пакеты к LLM идут параллельно; при 504 увеличьте таймаут API Gateway и функции (до 300 с / 180 с)."
        />
      </motion.section>

      <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
        <h2 className="admin-dash-h2 admin-dash-h2--flush">Сопоставление полей</h2>
        <table className="phenomenal-mapping-table">
          <thead>
            <tr>
              <th>Родители: опрос на сайте или второй Excel</th>
              <th>Чек-лист педагога (Excel)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Дата посещения урока</td>
              <td>Дата отправки формы педагогом (колонка «Отметка времени») — ориентир; точнее совпадать с датой у родителя</td>
            </tr>
            <tr>
              <td>Класс / группа</td>
              <td>«Шифр урока» (часто совпадает с классом/местом, напр. СР-6-Бассеин)</td>
            </tr>
            <tr>
              <td>ФИО учителей, проводивших урок</td>
              <td>Та же колонка в чек-листе (ведущие педагоги)</td>
            </tr>
            <tr>
              <td>Общая оценка урока 1–10</td>
              <td>«Уровень профессионально-методического мастерства… из 10» (педагогическая оценка, не родительская)</td>
            </tr>
            <tr>
              <td>Текстовые впечатления, «что понравилось», глубина феномена</td>
              <td>Нет прямых колонок; у педагога — шкалы по блокам + «Общие выводы / рекомендации»</td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
          Дополнительно на клиенте считается детерминированный ключ (
          <code>buildLessonMatchKey</code>) — для справки; итоговое сопоставление делает модель на сервере.
        </p>
      </motion.section>

      {mergeResult && (
        <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
          <h2 className="admin-dash-h2 admin-dash-h2--flush">Результат слияния (ИИ)</h2>
          {mergeResult.warnings.map((w) => (
            <p key={w} className="muted" style={{ fontSize: '0.9rem' }}>
              {w}
            </p>
          ))}
          <p style={{ marginTop: '0.5rem' }}>
            Источник родителей:{' '}
            <strong>{mergeResult.parent_source === 'excel' ? 'файл Excel' : `опрос id ${mergeResult.survey.id}`}</strong>
            {' — '}
            <strong>{mergeResult.survey.title}</strong>
            {mergeResult.llm_provider ? (
              <>
                {' '}
                · провайдер: <strong>{mergeResult.llm_provider}</strong>
              </>
            ) : null}
            . Порог: <strong>{mergeResult.confidence_threshold}</strong>. Слито:{' '}
            <strong>{mergeResult.stats.merged_high_confidence}</strong> / родителей{' '}
            <strong>{mergeResult.stats.parent_rows}</strong>, педагогов в файле{' '}
            <strong>{mergeResult.stats.teacher_rows}</strong>; без уверенного совпадения:{' '}
            <strong>{mergeResult.stats.uncertain_or_no_match}</strong>.
          </p>
          <div className="phenomenal-report-entry" style={{ marginBottom: '1rem' }}>
            <motion.button
              type="button"
              className="btn primary"
              disabled={!mergeResult.merged.length}
              onClick={openReportFromMerge}
              whileTap={{ scale: 0.97 }}
            >
              Открыть редактор отчёта (как «Отзывы»)
            </motion.button>
            <span className="muted" style={{ marginLeft: '0.65rem', fontSize: '0.88rem' }}>
              В редакторе один блок на шифр урока: все отзывы и строки чек-листа с этим шифром вместе; правки, порядок,
              .xlsx.
            </span>
            {!mergeResult.merged.length ? (
              <p className="muted" style={{ marginTop: '0.35rem', fontSize: '0.85rem' }}>
                Нет слитых пар выше порога — снизьте порог или дождитесь успешного слияния.
              </p>
            ) : null}
          </div>
          <h3 className="phenomenal-merge-subtitle">Слитые пары (≥ порога)</h3>
          <div className="phenomenal-table-wrap">
            <table className="phenomenal-data-table">
              <thead>
                <tr>
                  <th>Уверенность</th>
                  <th>Шифр / учителя (педагог)</th>
                  <th>Оценка педагога /10</th>
                  <th>Ответы родителя (сжато)</th>
                  <th>Комментарий ИИ</th>
                </tr>
              </thead>
              <tbody>
                {mergeResult.merged.map((m) => (
                  <tr key={`m-${m.parent_row_index}-${m.teacher_row_index}`}>
                    <td>{m.confidence.toFixed(2)}</td>
                    <td>
                      {m.teacher
                        ? `${m.teacher.lessonCode || '—'} · ${truncate(m.teacher.conductingTeachers, 56)}`
                        : '—'}
                    </td>
                    <td>{m.teacher?.methodologicalScore ?? '—'}</td>
                    <td>
                      {m.parent?.answers_labeled
                        ? answersLabeledPreview(m.parent.answers_labeled, 220)
                        : '—'}
                    </td>
                    <td>{truncate(m.reason, 120)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mergeResult.merged.length === 0 ? <p className="muted">Нет пар выше порога.</p> : null}
          </div>

          <h3 className="phenomenal-merge-subtitle">Ниже порога или без пары</h3>
          <div className="phenomenal-table-wrap">
            <table className="phenomenal-data-table">
              <thead>
                <tr>
                  <th>Уверенность</th>
                  <th>ti</th>
                  <th>Педагог (если есть)</th>
                  <th>Родитель (сжато)</th>
                  <th>Комментарий ИИ</th>
                </tr>
              </thead>
              <tbody>
                {mergeResult.uncertain.map((u) => (
                  <tr key={`u-${u.parent_row_index}-${u.teacher_row_index ?? 'x'}`}>
                    <td>{u.confidence.toFixed(2)}</td>
                    <td>{u.teacher_row_index ?? '—'}</td>
                    <td>
                      {u.teacher
                        ? `${truncate(u.teacher.lessonCode, 24)} · ${truncate(u.teacher.conductingTeachers, 40)}`
                        : '—'}
                    </td>
                    <td>
                      {u.parent?.answers_labeled
                        ? answersLabeledPreview(u.parent.answers_labeled, 160)
                        : '—'}
                    </td>
                    <td>{truncate(u.reason, 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      )}

      {parseResult && parseResult.rows.length > 0 && (
        <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
          <h2 className="admin-dash-h2 admin-dash-h2--flush">Ответы педагогов (первые 80 строк)</h2>
          <p className="muted" style={{ marginBottom: '0.65rem', fontSize: '0.86rem' }}>
            Под каждой строкой — свёрнутая сводка баллов; разверните, чтобы увидеть методику (/10), семь компетенций (/5) и
            диаграммы по этой строке Excel (данные обновляются при повторной загрузке файла).
          </p>
          <div className="phenomenal-table-wrap">
            <table className="phenomenal-data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Шифр</th>
                  <th>Ведущие</th>
                  <th>Предметы</th>
                  <th>Балл</th>
                  <th>Выводы</th>
                  <th>Ключ</th>
                </tr>
              </thead>
              <tbody>
                {parseResult.rows.slice(0, 80).map((row: TeacherLessonChecklistRow, idx: number) => (
                  <Fragment key={`pl-row-${idx}`}>
                    <tr>
                      <td>{formatTs(row.submittedAt)}</td>
                      <td>{row.lessonCode || '—'}</td>
                      <td>{truncate(row.conductingTeachers, 48)}</td>
                      <td>{truncate(row.subjects, 24)}</td>
                      <td>{row.methodologicalScore ?? '—'}</td>
                      <td>{truncate(row.generalThoughts, 64)}</td>
                      <td className="phenomenal-key-cell" title={buildLessonMatchKey(row.lessonCode, row.conductingTeachers)}>
                        {truncate(buildLessonMatchKey(row.lessonCode, row.conductingTeachers), 28)}
                      </td>
                    </tr>
                    <tr className="phenomenal-upload-competency-tr">
                      <td colSpan={7}>
                        <PhenomenalUploadRowCompetency row={row} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </motion.section>
      )}
    </motion.div>
  );
}

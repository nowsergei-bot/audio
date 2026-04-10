import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listSurveys, postPhenomenalLessonsMerge } from '../../api/client';
import AiWaitIndicator from '../../components/AiWaitIndicator';
import { adminStaggerItem } from '../../motion/adminMotion';
import {
  readParentResponsesSheetArrayBuffer,
  type ParseParentResponsesResult,
} from './parseParentResponsesSheet';
import { readTeacherChecklistAprilArrayBuffer, type ParseTeacherChecklistResult } from './parseTeacherChecklistApril';
import {
  buildDraftFromMerge,
  buildDraftFromTeacherRows,
  type PhenomenalReportDraft,
} from './reportDraftTypes';
import type { PhenomenalLessonsMergePayload, Survey } from '../../types';

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
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

export type PhenomenalMergeImportCardProps = {
  /** После слияния или «только педагоги» — один черновик отчёта (блоки = уроки, внутри и данные педагога, и отзывы родителей). */
  onDraftReady: (draft: PhenomenalReportDraft, loadMsg: string) => void;
};

/**
 * Импорт чек-листа + слияние с родителями. Не отдельная «страница-редактор» — результат сразу в общий черновик отчёта.
 */
export default function PhenomenalMergeImportCard({ onDraftReady }: PhenomenalMergeImportCardProps) {
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
    void listSurveys()
      .then((list) => {
        if (!cancelled) {
          setSurveys(list);
          setSurveysErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setSurveysErr(e instanceof Error ? e.message : 'Не удалось загрузить опросы');
      });
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
      const draft = buildDraftFromMerge(data, { title: data.survey?.title, teacherRows });
      const msg = [
        `Слияние ИИ: в черновике ${draft.blocks.length} блок(ов) — все уроки из чек-листа; без пары с родителем — без отзывов.`,
        `Ответов родителей с уверенностью ≥ порога: ${data.stats.merged_high_confidence} из ${data.stats.parent_rows}.`,
        data.warnings.length ? data.warnings.join(' ') : '',
      ]
        .filter(Boolean)
        .join(' ');
      if (draft.blocks.length > 0) {
        onDraftReady(draft, msg);
      }
    } catch (e) {
      setMergeErr(e instanceof Error ? e.message : 'Ошибка слияния');
    } finally {
      setMergeBusy(false);
    }
  }, [surveyId, parseResult, parentParseResult, parentFileLabel, mergeThreshold, onDraftReady]);

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
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return { n: rows.length, mean };
  }, [parseResult]);

  const parentStats = useMemo(() => {
    const n = parentParseResult?.rows.length ?? 0;
    return { n };
  }, [parentParseResult]);

  const canRunMerge =
    Boolean(parseResult?.rows.length) &&
    (parentStats.n > 0 || (Number(surveyId) >= 1 && Number.isFinite(Number(surveyId))));

  const continueTeachersOnly = useCallback(() => {
    const rows = parseResult?.rows;
    if (!rows?.length) return;
    const draft = buildDraftFromTeacherRows(rows, { title: fileLabel || undefined });
    onDraftReady(
      draft,
      'Черновик из чек-листа педагогов. Подключите опрос Пульса в карточке ниже или добавьте отзывы родителей вручную в каждом блоке.',
    );
  }, [parseResult, fileLabel, onDraftReady]);

  return (
    <div className="phenomenal-merge-import-root">
      <motion.section className="card glass-surface phenomenal-merge-import-inner" variants={adminStaggerItem}>
        <p className="admin-dash-kicker">Шаг 1 · импорт и ИИ</p>
        <h2 className="admin-dash-h2 admin-dash-h2--flush">Чек-лист педагогов и ответы родителей</h2>
        <p className="muted admin-dash-lead" style={{ marginTop: '0.35rem' }}>
          После <strong>автослияния с ИИ</strong> откроется <strong>один черновик отчёта</strong>: в каждом блоке и поля
          урока (педагог), и строки отзывов родителей. Отдельной страницы «второго редактора» нет.
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
            Лист: <strong>{parseResult.sheetName}</strong>, строк: <strong>{stats.n}</strong>
            {stats.mean != null ? (
              <>
                , средняя оценка методики (/10): <strong>{stats.mean.toFixed(2)}</strong>
              </>
            ) : null}
          </p>
        )}

        {parseResult && parseResult.rows.length > 0 ? (
          <div className="phenomenal-report-entry" style={{ marginTop: '0.75rem' }}>
            <motion.button type="button" className="btn" onClick={continueTeachersOnly} whileTap={{ scale: 0.97 }}>
              Продолжить без родителей (только чек-лист)
            </motion.button>
            <span className="muted" style={{ marginLeft: '0.65rem', fontSize: '0.88rem' }}>
              Тот же черновик отчёта: блоки по строкам Excel; отзывы родителей — позже в блоках или через опрос Пульса.
            </span>
          </div>
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
            Родители из файла: лист <strong>{parentParseResult.sheetName}</strong>, строк: <strong>{parentStats.n}</strong>.
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
            {mergeBusy ? 'Слияние с ИИ…' : 'Автослияние с ИИ → черновик отчёта'}
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
        <h3 className="admin-dash-h2 admin-dash-h2--flush">Сопоставление полей</h3>
        <table className="phenomenal-mapping-table">
          <thead>
            <tr>
              <th>Родители</th>
              <th>Чек-лист педагога</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Дата посещения</td>
              <td>«Отметка времени» в Excel педагога</td>
            </tr>
            <tr>
              <td>Класс / группа</td>
              <td>«Шифр урока» (часто совпадает с классом/местом)</td>
            </tr>
            <tr>
              <td>ФИО учителей, проводивших урок</td>
              <td>Колонка ведущих в чек-листе</td>
            </tr>
          </tbody>
        </table>
      </motion.section>

      {mergeResult && mergeResult.merged.length === 0 ? (
        <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
          <h3 className="admin-dash-h2 admin-dash-h2--flush">Слияние не дало блоков</h3>
          <p className="muted">
            Ни одна пара не прошла порог — понизьте порог и запустите снова, либо нажмите «Продолжить без родителей».
          </p>
        </motion.section>
      ) : null}

      {mergeResult ? (
        <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
          <details className="phenomenal-merge-details">
            <summary>Детали последнего слияния (таблицы)</summary>
            {mergeResult.warnings.map((w) => (
              <p key={w} className="muted" style={{ fontSize: '0.9rem' }}>
                {w}
              </p>
            ))}
            <p style={{ marginTop: '0.5rem' }}>
              Источник родителей:{' '}
              <strong>{mergeResult.parent_source === 'excel' ? 'Excel' : `опрос id ${mergeResult.survey.id}`}</strong> —{' '}
              <strong>{mergeResult.survey.title}</strong>. Порог: <strong>{mergeResult.confidence_threshold}</strong>.
              Слито: <strong>{mergeResult.stats.merged_high_confidence}</strong> /{' '}
              <strong>{mergeResult.stats.parent_rows}</strong>; без пары:{' '}
              <strong>{mergeResult.stats.uncertain_or_no_match}</strong>.
            </p>
            <h4 className="phenomenal-merge-subtitle">Слитые пары</h4>
            <div className="phenomenal-table-wrap">
              <table className="phenomenal-data-table">
                <thead>
                  <tr>
                    <th>Уверенность</th>
                    <th>Шифр / учителя</th>
                    <th>Оценка /10</th>
                    <th>Родитель (сжато)</th>
                    <th>Комментарий</th>
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
            </div>
            <h4 className="phenomenal-merge-subtitle">Ниже порога или без пары</h4>
            <div className="phenomenal-table-wrap">
              <table className="phenomenal-data-table">
                <thead>
                  <tr>
                    <th>Уверенность</th>
                    <th>ti</th>
                    <th>Педагог</th>
                    <th>Родитель</th>
                    <th>Комментарий</th>
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
          </details>
        </motion.section>
      ) : null}
    </div>
  );
}

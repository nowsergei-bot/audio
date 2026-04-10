import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { getPedagogicalSession, postPedagogicalLlmTeachersBatch } from '../api/client';
import type { PedagogicalAnalyticsState } from '../types';

function segIndexFromId(id: string): number | null {
  const m = /^seg-(\d+)$/.exec(String(id || ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function filenameSafe(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export default function PedagogicalReviewPage() {
  const { sessionId } = useParams();
  const id = sessionId ? Number(sessionId) : NaN;
  const [state, setState] = useState<PedagogicalAnalyticsState | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [subjectQuery, setSubjectQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'done' | 'pending' | 'failed'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id < 1) return;
    setErr(null);
    try {
      const s = await getPedagogicalSession(id);
      setTitle(s.title);
      setState(s.state);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка загрузки';
      if (/^not found$/i.test(msg.trim())) {
        setErr(
          'Сессия не найдена (удалена, другой пользователь или несовпадение входа и ключа API). Откройте список сессий или войдите заново.',
        );
      } else {
        setErr(msg);
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const jobRunning = state?.job?.status === 'running';
  const jobTotal = state?.job?.total ?? 0;
  const jobDone = state?.job?.done ?? 0;

  useEffect(() => {
    if (!jobRunning || !Number.isFinite(id) || id < 1) return;
    const t = window.setInterval(() => void load(), 1600);
    return () => window.clearInterval(t);
  }, [jobRunning, id, load]);

  const map = state?.piiMap || {};
  const segments = useMemo(() => state?.segments ?? [], [state?.segments]);
  const filteredSegments = useMemo(() => {
    const tq = teacherQuery.trim().toLowerCase();
    const sq = subjectQuery.trim().toLowerCase();
    return segments.filter((seg) => {
      if (statusFilter !== 'all' && String(seg.genStatus || '') !== statusFilter) return false;
      if (tq && !String(seg.teacher || '').toLowerCase().includes(tq)) return false;
      if (sq && !String(seg.subject || '').toLowerCase().includes(sq)) return false;
      return true;
    });
  }, [segments, teacherQuery, subjectQuery, statusFilter]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSegments = useMemo(
    () => filteredSegments.filter((seg) => selectedSet.has(seg.id)),
    [filteredSegments, selectedSet],
  );

  useEffect(() => {
    const visible = new Set(filteredSegments.map((s) => s.id));
    setSelectedIds((prev) => prev.filter((id) => visible.has(id)));
  }, [filteredSegments]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllFiltered = () => setSelectedIds(filteredSegments.map((s) => s.id));
  const clearSelection = () => setSelectedIds([]);

  const runForSelected = async () => {
    if (!Number.isFinite(id) || id < 1 || !state) return;
    const selectedIndices = selectedSegments
      .map((seg) => segIndexFromId(seg.id))
      .filter((v): v is number => v != null);
    if (!selectedIndices.length) {
      setErr('Выберите учителей в списке ниже.');
      return;
    }
    setBatchBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const out = await postPedagogicalLlmTeachersBatch(id, {
        selectedIndices,
        sourceBlocks: state.sourceBlocks ?? undefined,
        parallel: 3,
      });
      setState(out.session.state);
      setTitle(out.session.title);
      setInfo(`Сформированы выводы по выбранным учителям: ${selectedIndices.length}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сформировать выводы');
    } finally {
      setBatchBusy(false);
    }
  };

  const exportSelectedPdf = async () => {
    if (!selectedSegments.length) {
      setErr('Выберите учителей для экспорта PDF.');
      return;
    }
    setPdfBusy(true);
    setErr(null);
    setInfo(null);
    try {
      for (const seg of selectedSegments) {
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const w = doc.internal.pageSize.getWidth();
        const h = doc.internal.pageSize.getHeight();
        const margin = 48;
        const maxW = w - margin * 2;
        let y = margin;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        const header = `Педагогическая аналитика: ${title}`;
        for (const ln of doc.splitTextToSize(header, maxW)) {
          doc.text(ln, margin, y);
          y += 18;
        }
        y += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.text(`Педагог: ${seg.teacher}`, margin, y);
        y += 18;
        if (seg.subject) {
          doc.text(`Предмет: ${seg.subject}`, margin, y);
          y += 18;
        }
        y += 8;

        const body = (seg.narrative || seg.sourceSnippet || '').trim() || 'Нет текста.';
        doc.setFontSize(11);
        const lines = doc.splitTextToSize(body, maxW);
        for (const ln of lines) {
          if (y > h - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(ln, margin, y);
          y += 15;
        }
        const fn = `pedagogical_${id}_${filenameSafe(seg.teacher || seg.id)}.pdf`;
        doc.save(fn);
      }
      setInfo(`PDF сформированы: ${selectedSegments.length} файл(ов).`);
    } finally {
      setPdfBusy(false);
    }
  };

  if (!Number.isFinite(id) || id < 1) {
    return <p className="muted">Некорректный id сессии.</p>;
  }

  if (err) {
    return <p className="err">{err}</p>;
  }

  if (!state) {
    return <p className="muted">Загрузка…</p>;
  }

  const progressPct = jobTotal > 0 ? Math.round((100 * jobDone) / jobTotal) : 0;

  return (
    <div className="card glass-surface pedagogical-review">
      <p className="muted">
        <Link to="/analytics/pedagogical">← К списку</Link>
      </p>
      <h2 className="admin-dash-title" style={{ fontSize: '1.35rem', marginTop: '0.5rem' }}>
        Согласование · {title}
      </h2>
      <p className="muted">
        Карточки по педагогам появляются после режима «ИИ по каждому педагогу» на шаге «Факты». Пока идёт пошаговая
        обработка, эту страницу можно держать открытой (в т.ч. во второй вкладке) — список обновляется автоматически.
      </p>
      {info ? (
        <p className="muted" style={{ color: 'var(--ok, #2e7d32)' }}>
          {info}
        </p>
      ) : null}

      {jobRunning && jobTotal > 0 ? (
        <div className="pedagogical-review-job card" style={{ marginTop: '1rem', padding: '0.9rem 1rem' }}>
          <p className="field-label" style={{ marginTop: 0 }}>
            Заполняется согласование
          </p>
          <div
            className="pedagogical-review-progress-track"
            style={{
              height: 12,
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--page-fg, #111) 12%, transparent)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--accent, #e30613)',
                transition: 'width 0.3s ease-out',
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.45rem', marginBottom: 0 }}>
            Готово выводов ИИ: <strong>{jobDone}</strong> / {jobTotal}
          </p>
        </div>
      ) : null}

      {state.job?.status === 'failed' && state.job?.error ? (
        <p className="err" style={{ marginTop: '0.75rem' }}>
          {state.job.error}
        </p>
      ) : null}

      {state.llmLast ? (
        <section className="pedagogical-review-llm card" style={{ marginTop: '1rem', padding: '1rem' }}>
          <h3 className="pedagogical-subheading" style={{ marginTop: 0 }}>
            Сводный текст (все педагоги)
          </h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {state.llmLast.at ? new Date(state.llmLast.at).toLocaleString('ru-RU') : ''}
            {state.llmLast.provider ? ` · ${state.llmLast.provider}` : ''}
          </p>
          <pre className="pedagogical-redacted-preview pedagogical-segment-narrative">{state.llmLast.replyPlain}</pre>
        </section>
      ) : null}

      {segments.length === 0 ? (
        <p className="muted" style={{ marginTop: '1rem' }}>
          {state.llmLast
            ? 'Нет карточек по педагогам — используйте на шаге «Факты» загрузку Excel и «ИИ по каждому педагогу».'
            : 'Пока нет данных — на шаге «Факты» загрузите таблицу или текст и запустите анализ.'}
        </p>
      ) : (
        <>
          <div className="card" style={{ marginTop: '1rem', padding: '0.8rem 1rem' }}>
            <p className="field-label" style={{ marginTop: 0 }}>
              Фильтры и массовые действия
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.55rem' }}>
              <input
                className="input"
                value={teacherQuery}
                onChange={(e) => setTeacherQuery(e.target.value)}
                placeholder="Фильтр: педагог"
              />
              <input
                className="input"
                value={subjectQuery}
                onChange={(e) => setSubjectQuery(e.target.value)}
                placeholder="Фильтр: предмет"
              />
              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'done' | 'pending' | 'failed')}
              >
                <option value="all">Статус: все</option>
                <option value="done">Статус: готово</option>
                <option value="pending">Статус: ожидает</option>
                <option value="failed">Статус: ошибка</option>
              </select>
            </div>
            <p className="muted" style={{ fontSize: '0.86rem', marginTop: '0.55rem', marginBottom: 0 }}>
              В выборке: {filteredSegments.length} · выбрано: {selectedSegments.length}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.7rem' }}>
              <button type="button" className="btn secondary btn-small" onClick={selectAllFiltered}>
                Выбрать все в фильтре
              </button>
              <button type="button" className="btn secondary btn-small" onClick={clearSelection}>
                Снять выбор
              </button>
              <button
                type="button"
                className="btn primary btn-small"
                disabled={batchBusy || pdfBusy || selectedSegments.length === 0}
                onClick={() => void runForSelected()}
              >
                {batchBusy ? 'Формирование…' : 'Сформировать выводы'}
              </button>
              <button
                type="button"
                className="btn secondary btn-small"
                disabled={batchBusy || pdfBusy || selectedSegments.length === 0}
                onClick={() => void exportSelectedPdf()}
              >
                {pdfBusy ? 'Подготовка PDF…' : 'Скачать PDF по выбранным'}
              </button>
            </div>
          </div>
          <ul className="pedagogical-segment-list">
            {filteredSegments.map((seg) => (
            <li key={seg.id} className="pedagogical-segment-card">
              <div className="pedagogical-segment-head">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginRight: '0.55rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(seg.id)}
                    onChange={() => toggleSelection(seg.id)}
                  />
                </label>
                <strong>{seg.teacher}</strong>
                {seg.subject ? <span className="muted"> · {seg.subject}</span> : null}
                {seg.genStatus === 'pending' ? (
                  <span className="muted"> · ожидает ИИ…</span>
                ) : seg.genStatus === 'done' ? (
                  <span className="muted"> · готово</span>
                ) : seg.genStatus === 'failed' ? (
                  <span className="err"> · ошибка</span>
                ) : seg.genStatus ? (
                  <span className="muted"> · {seg.genStatus}</span>
                ) : null}
              </div>
              {seg.genStatus === 'pending' && jobRunning ? (
                <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.5rem' }}>
                  В очереди обработки…
                </p>
              ) : null}
              {seg.genStatus === 'failed' && seg.genError ? (
                <p className="err" style={{ fontSize: '0.88rem', marginTop: '0.5rem' }}>
                  {seg.genError}
                </p>
              ) : null}
              {seg.narrative ? (
                <>
                  <p className="field-label" style={{ marginTop: '0.75rem' }}>
                    С подстановкой значений
                  </p>
                  <pre className="pedagogical-redacted-preview pedagogical-segment-narrative">{seg.narrative}</pre>
                  {Object.keys(map).length > 0 && seg.narrativeRedacted ? (
                    <details className="pedagogical-map-details" style={{ marginTop: '0.5rem' }}>
                      <summary>Как вернула модель (токены)</summary>
                      <pre className="pedagogical-redacted-preview pedagogical-segment-narrative">
                        {seg.narrativeRedacted}
                      </pre>
                    </details>
                  ) : null}
                </>
              ) : seg.genStatus === 'done' ? (
                <p className="muted">Нет текста.</p>
              ) : null}
            </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted" style={{ marginTop: '1rem' }}>
        <Link to={`/analytics/pedagogical/${id}/progress`}>Факты и ИИ</Link> ·{' '}
        <Link to={`/analytics/pedagogical/${id}/report`}>Отчёт</Link>
      </p>
    </div>
  );
}

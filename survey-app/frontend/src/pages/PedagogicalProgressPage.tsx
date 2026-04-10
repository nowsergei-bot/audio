import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getPedagogicalSession,
  postPedagogicalAnalyticsLlm,
  postPedagogicalLlmTeacher,
  postPedagogicalLlmTeachersBatch,
  savePedagogicalSession,
} from '../api/client';
import { detokenizePedagogicalText } from '../lib/pedagogicalDetokenize';
import { defaultPedagogicalState } from '../lib/pedagogicalDefaultState';
import { parsePedagogicalExcelBuffer } from '../lib/pedagogicalExcelImport';
import type { PedagogicalAnalyticsState, PedagogicalPiiEntityDraft, PedagogicalPiiEntityType } from '../types';

const PII_TYPE_LABELS: Record<PedagogicalPiiEntityType, string> = {
  teacher: 'Педагог (ФИО)',
  phone: 'Телефон',
  address: 'Адрес',
  class: 'Класс / группа',
  child: 'Ребёнок',
  other: 'Прочее ПДн',
};

function newExtraRow(): PedagogicalPiiEntityDraft {
  return { type: 'other', value: '' };
}

const MAX_TEACHERS_PARALLEL_BATCH = 28;

export default function PedagogicalProgressPage() {
  const nav = useNavigate();
  const { sessionId } = useParams();
  const id = sessionId ? Number(sessionId) : NaN;
  const [title, setTitle] = useState('');
  const [state, setState] = useState<PedagogicalAnalyticsState>(() => defaultPedagogicalState());
  const [extraRows, setExtraRows] = useState<PedagogicalPiiEntityDraft[]>([newExtraRow()]);
  const [mockLlmOut, setMockLlmOut] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [autosavePending, setAutosavePending] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** 404 при загрузке — не показываем пустую форму, только пояснение и ссылки */
  const [sessionMissing, setSessionMissing] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [teachersStepBusy, setTeachersStepBusy] = useState(false);
  const [teachersBatchBusy, setTeachersBatchBusy] = useState(false);
  const [teachersProgress, setTeachersProgress] = useState<{ done: number; total: number } | null>(null);

  const titleRef = useRef(title);
  const stateRef = useRef(state);
  const baselineRef = useRef({ title: '', plain: '' });
  titleRef.current = title;
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id < 1) return;
    setErr(null);
    setSessionMissing(false);
    try {
      const s = await getPedagogicalSession(id);
      setTitle(s.title);
      setState(s.state);
      titleRef.current = s.title;
      stateRef.current = s.state;
      baselineRef.current = { title: s.title.trim(), plain: s.state.sourcePlain };
      setLastSavedAt(s.updated_at);
      setLoaded(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка загрузки';
      if (/^not found$/i.test(msg.trim())) {
        setSessionMissing(true);
        setLoaded(false);
      } else {
        setErr(msg);
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const performSave = useCallback(
    async (opts?: { title?: string; silent?: boolean }): Promise<boolean> => {
      if (!Number.isFinite(id) || id < 1) return false;
      const tit = (opts?.title ?? titleRef.current).trim() || 'Педагогическая аналитика';
      const st = stateRef.current;
      if (!opts?.silent) setSaveBusy(true);
      setErr(null);
      try {
        const saved = await savePedagogicalSession({ id, title: tit, state: st });
        setState(saved.state);
        setTitle(saved.title);
        titleRef.current = saved.title;
        stateRef.current = saved.state;
        baselineRef.current = { title: saved.title.trim(), plain: saved.state.sourcePlain };
        setLastSavedAt(saved.updated_at);
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Не сохранилось');
        return false;
      } finally {
        if (!opts?.silent) setSaveBusy(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!loaded || !Number.isFinite(id) || id < 1) return;
    const tTrim = title.trim();
    const plain = state.sourcePlain;
    if (tTrim === baselineRef.current.title && plain === baselineRef.current.plain) return;
    const h = setTimeout(() => {
      void (async () => {
        setAutosavePending(true);
        await performSave({ silent: true });
        setAutosavePending(false);
      })();
    }, 2000);
    return () => clearTimeout(h);
  }, [title, state.sourcePlain, loaded, id, performSave]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const dirty =
        titleRef.current.trim() !== baselineRef.current.title ||
        stateRef.current.sourcePlain !== baselineRef.current.plain;
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const extraEntities = useMemo(
    () => extraRows.filter((e) => e.value.trim()),
    [extraRows],
  );

  const onExcelPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setErr('Нужен файл .xlsx');
      return;
    }
    setErr(null);
    setExcelBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const r = parsePedagogicalExcelBuffer(buf);
      setState((p) => ({
        ...p,
        sourceBlocks: r.blocks,
        sourcePlain: r.plain,
      }));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Не удалось разобрать Excel');
    } finally {
      setExcelBusy(false);
    }
  };

  const onSequentialTeachers = async () => {
    if (!Number.isFinite(id) || id < 1) return;
    const blocks = (stateRef.current.sourceBlocks ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!blocks.length) {
      setErr('Сначала загрузите Excel с несколькими строками (педагогами).');
      return;
    }
    const dirty =
      title.trim() !== baselineRef.current.title || state.sourcePlain !== baselineRef.current.plain;
    if (dirty) {
      const ok = await performSave({ silent: true });
      if (!ok) return;
    }
    setTeachersStepBusy(true);
    setTeachersProgress({ done: 0, total: blocks.length });
    setErr(null);
    try {
      for (let i = 0; i < blocks.length; i++) {
        const { session } = await postPedagogicalLlmTeacher(id, {
          index: i,
          restart: i === 0,
          sourceBlocks: blocks,
          extraEntities: extraEntities.length ? extraEntities : undefined,
        });
        setState(session.state);
        stateRef.current = session.state;
        setTeachersProgress({ done: i + 1, total: blocks.length });
        if (session.updated_at) setLastSavedAt(session.updated_at);
      }
      baselineRef.current = {
        title: titleRef.current.trim(),
        plain: stateRef.current.sourcePlain,
      };
      nav(`/analytics/pedagogical/${id}/review`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка анализа по педагогам');
      void load();
    } finally {
      setTeachersStepBusy(false);
      setTeachersProgress(null);
    }
  };

  const onParallelTeachersBatch = async () => {
    if (!Number.isFinite(id) || id < 1) return;
    const blocks = (stateRef.current.sourceBlocks ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!blocks.length) {
      setErr('Сначала загрузите Excel с несколькими строками (педагогами).');
      return;
    }
    if (blocks.length > MAX_TEACHERS_PARALLEL_BATCH) {
      setErr(`Параллельный режим: не более ${MAX_TEACHERS_PARALLEL_BATCH} педагогов за один запрос. Используйте пошаговый режим или разбейте таблицу.`);
      return;
    }
    const dirty =
      title.trim() !== baselineRef.current.title || state.sourcePlain !== baselineRef.current.plain;
    if (dirty) {
      const ok = await performSave({ silent: true });
      if (!ok) return;
    }
    setTeachersBatchBusy(true);
    setErr(null);
    try {
      const { ok, message, session } = await postPedagogicalLlmTeachersBatch(id, {
        sourceBlocks: blocks,
        extraEntities: extraEntities.length ? extraEntities : undefined,
        parallel: 3,
      });
      setState(session.state);
      stateRef.current = session.state;
      if (session.updated_at) setLastSavedAt(session.updated_at);
      baselineRef.current = {
        title: titleRef.current.trim(),
        plain: session.state.sourcePlain,
      };
      if (!ok && message) setErr(message);
      nav(`/analytics/pedagogical/${id}/review`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка пакетного анализа');
    } finally {
      setTeachersBatchBusy(false);
    }
  };

  const onRunAnalysis = async () => {
    if (!Number.isFinite(id) || id < 1) return;
    const plain = state.sourcePlain.trim();
    if (!plain) {
      setErr('Загрузите таблицу .xlsx или вставьте текст фактов в поле ниже.');
      return;
    }
    const dirty =
      title.trim() !== baselineRef.current.title || state.sourcePlain !== baselineRef.current.plain;
    if (dirty) {
      const ok = await performSave({ silent: true });
      if (!ok) return;
    }
    setAnalysisBusy(true);
    setErr(null);
    try {
      const blocks = (stateRef.current.sourceBlocks ?? []).map((s) => String(s).trim()).filter(Boolean);
      const out = await postPedagogicalAnalyticsLlm(id, {
        sourcePlain: plain,
        sourceBlocks: blocks.length ? blocks : undefined,
        extraEntities: extraEntities.length ? extraEntities : undefined,
      });
      setState(out.session.state);
      setTitle(out.session.title);
      titleRef.current = out.session.title;
      stateRef.current = out.session.state;
      baselineRef.current = {
        title: out.session.title.trim(),
        plain: out.session.state.sourcePlain,
      };
      if (out.session.updated_at) setLastSavedAt(out.session.updated_at);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка вызова ИИ');
    } finally {
      setAnalysisBusy(false);
    }
  };

  const mapEntries = useMemo(() => Object.entries(state.piiMap || {}), [state.piiMap]);
  const detokenizedPreview = useMemo(
    () => (mockLlmOut.trim() ? detokenizePedagogicalText(mockLlmOut, state.piiMap) : ''),
    [mockLlmOut, state.piiMap],
  );

  if (!Number.isFinite(id) || id < 1) {
    return <p className="muted">Некорректный id сессии.</p>;
  }

  if (sessionMissing) {
    return (
      <div className="card glass-surface pedagogical-progress">
        <p className="admin-dash-kicker" style={{ marginBottom: '0.25rem' }}>
          Пульс · педагогическая аналитика
        </p>
        <h2 className="admin-dash-title" style={{ fontSize: '1.25rem', marginTop: '0.35rem' }}>
          Сессия не найдена
        </h2>
        <p className="err" style={{ marginTop: '0.75rem', lineHeight: 1.45 }}>
          Сервер не отдал сессию #{id}. Так бывает, если она привязана к другому пользователю, удалена или запрос пошёл
          без того входа, под которым её создавали (например, только ключ API без активной сессии входа — или наоборот).
        </p>
        <p className="muted" style={{ marginTop: '0.75rem', lineHeight: 1.45 }}>
          Что сделать: войдите через страницу входа (при необходимости временно уберите ключ API с главной админки),
          обновите страницу; проверьте, что в облаке задеплоена актуальная версия API. Или откройте список и создайте
          новую сессию.
        </p>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          <Link to="/analytics/pedagogical">К списку сессий</Link>
          {' · '}
          <Link to="/auth">Вход</Link>
          {' · '}
          <Link to="/">Главная</Link>
        </p>
      </div>
    );
  }

  if (!loaded && !err) {
    return <p className="muted">Загрузка…</p>;
  }

  return (
    <div className="card glass-surface pedagogical-progress">
      <p className="admin-dash-kicker" style={{ marginBottom: '0.25rem' }}>
        Пульс · педагогическая аналитика
      </p>
      <p className="muted">
        <Link to="/analytics/pedagogical">← К списку сессий</Link>
        {' · '}
        <Link to={`/analytics/pedagogical/${id}/excel?linkPedSession=${id}`}>Графики, выборки и ИИ</Link>
      </p>
      <h2 className="admin-dash-title" style={{ fontSize: '1.35rem', marginTop: '0.5rem' }}>
        Исходные факты и анализ ИИ
      </h2>
      <p className="muted pedagogical-progress-lead">
        Можно <strong>загрузить .xlsx</strong> прямо здесь (первая строка — заголовки; по каждой строке таблицы — отдельный
        педагог): сервер <strong>по очереди</strong> ищет ПДн в тексте каждого педагога и только потом объединяет результат
        для модели. Либо вставьте готовый текст фактов (в т.ч. из «Наблюдения Excel»). Перед LLM значения заменяются на
        токены (УЧ_, ТЛФ_, АДР_, КЛ_, ПД_); таблица соответствия в запрос не передаётся.
      </p>
      <div className="pedagogical-copy-workflow" role="region" aria-label="Как скопировать факты из Excel">
        <p className="pedagogical-copy-workflow-title">Как подготовить факты (таблица или текст из Excel)</p>
        <ol className="pedagogical-copy-workflow-list">
          <li>
            <strong>Вариант A:</strong> загрузите на этой странице файл <strong>.xlsx</strong> с таблицей (строка = педагог,
            в заголовках желательно колонку «Педагог» / «ФИО» / «Учитель»).
          </li>
          <li>
            <strong>Вариант B:</strong> откройте{' '}
            <Link to="/analytics/excel">Наблюдения Excel</Link>, сформируйте срез или отчёт ИИ и раскройте{' '}
            <strong>«Исходные факты (машинная сводка)»</strong>.
          </li>
          <li>Если вариант B — выделите текст сводки и скопируйте (Cmd+C / Ctrl+C).</li>
          <li>Вставьте текст в поле ниже (или оставьте данные после загрузки Excel); при необходимости измените название сессии.</li>
          <li>
            Сохраните сессию кнопкой <strong>«Сохранить сессию»</strong> или дождитесь автосохранения (~2 с после паузы в
            вводе) — иначе при обрыве связи или закрытии вкладки черновик можно потерять.
          </li>
          <li>Нажмите <strong>«Запустить анализ ИИ»</strong> (перед вызовом несохранённые правки тоже будут записаны).</li>
        </ol>
      </div>
      {err && <p className="err">{err}</p>}
      <p className="muted pedagogical-save-meta" style={{ fontSize: '0.88rem', marginTop: '0.35rem' }}>
        {lastSavedAt ? (
          <>
            Последнее сохранение: {new Date(lastSavedAt).toLocaleString('ru-RU')}
            {autosavePending ? ' · автосохранение…' : ''}
          </>
        ) : autosavePending ? (
          'Автосохранение…'
        ) : (
          'После правок сессия сохраняется автоматически через ~2 с или по кнопке ниже.'
        )}
      </p>

      <label className="field-label" htmlFor="ped-title">
        Название сессии
      </label>
      <input
        id="ped-title"
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={(e) => void performSave({ title: e.target.value })}
      />

      <div className="pedagogical-excel-upload" style={{ marginTop: '1rem' }}>
        <label className="field-label" htmlFor="ped-excel">
          Таблица Excel (.xlsx)
        </label>
        <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.2rem' }}>
          Первый лист, первая строка — заголовки столбцов. Каждая следующая строка — один педагог; колонка с ФИО ищется по
          названию (педагог, учитель, ФИО…), иначе используется первый столбец.
        </p>
        <input
          id="ped-excel"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="input"
          disabled={saveBusy || analysisBusy || excelBusy || teachersStepBusy || teachersBatchBusy}
          onChange={(e) => void onExcelPick(e)}
          style={{ marginTop: '0.35rem', padding: '0.4rem' }}
        />
        {excelBusy ? <p className="muted" style={{ fontSize: '0.85rem' }}>Разбор файла…</p> : null}
      </div>

      {state.sourceBlocks && state.sourceBlocks.length > 0 ? (
        <p className="muted pedagogical-excel-mode-hint" style={{ fontSize: '0.88rem', marginTop: '0.65rem' }}>
          Режим таблицы: <strong>{state.sourceBlocks.length}</strong> блок(ов) по педагогам — при псевдонимизации сервер
          обходит каждый блок отдельно. Если отредактировать текст в поле ниже вручную, привязка к строкам Excel{' '}
          <strong>сбросится</strong> (останется обычный сплошной текст).
        </p>
      ) : null}

      <label className="field-label" htmlFor="ped-plain" style={{ marginTop: '1rem' }}>
        Исходные факты (текст или результат загрузки Excel)
      </label>
      <textarea
        id="ped-plain"
        className="input pedagogical-plain-textarea"
        rows={14}
        value={state.sourcePlain}
        onChange={(e) =>
          setState((p) => ({
            ...p,
            sourcePlain: e.target.value,
            sourceBlocks: null,
          }))
        }
        placeholder="Вставьте текст из «Наблюдения Excel» (исходные факты, сводку), другой отчёт или загрузите .xlsx выше…"
      />

      <details className="pedagogical-map-details" style={{ marginTop: '0.75rem' }}>
        <summary>Дополнительные строки для замены (необязательно)</summary>
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          Если авто-режим что-то пропустил, добавьте точную подстроку из текста. Тип влияет на префикс токена.
        </p>
        <div className="pedagogical-entity-rows">
          {extraRows.map((row, idx) => (
            <div key={idx} className="pedagogical-entity-row">
              <select
                className="input pedagogical-entity-type"
                value={row.type}
                onChange={(e) => {
                  const t = e.target.value as PedagogicalPiiEntityType;
                  setExtraRows((rows) => {
                    const next = [...rows];
                    next[idx] = { ...row, type: t };
                    return next;
                  });
                }}
              >
                {(Object.keys(PII_TYPE_LABELS) as PedagogicalPiiEntityType[]).map((k) => (
                  <option key={k} value={k}>
                    {PII_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                className="input pedagogical-entity-value"
                value={row.value}
                onChange={(e) => {
                  setExtraRows((rows) => {
                    const next = [...rows];
                    next[idx] = { ...row, value: e.target.value };
                    return next;
                  });
                }}
                placeholder="Подстрока из текста выше"
              />
              <button
                type="button"
                className="btn btn-small secondary"
                onClick={() =>
                  setExtraRows((rows) => {
                    const next = rows.filter((_, i) => i !== idx);
                    return next.length ? next : [newExtraRow()];
                  })
                }
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn secondary btn-small" onClick={() => setExtraRows((r) => [...r, newExtraRow()])}>
          + Строка
        </button>
      </details>

      <div className="pedagogical-progress-actions" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          disabled={saveBusy || analysisBusy || teachersStepBusy || teachersBatchBusy}
          onClick={() => void performSave()}
        >
          {saveBusy ? 'Сохранение…' : 'Сохранить сессию'}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={saveBusy || analysisBusy || teachersStepBusy || teachersBatchBusy}
          onClick={() => void onRunAnalysis()}
        >
          {analysisBusy ? 'Анализ…' : 'Сводный анализ ИИ (весь текст)'}
        </button>
      </div>

      {state.sourceBlocks && state.sourceBlocks.length > 0 ? (
        <section
          className="pedagogical-teachers-batch card glass-surface"
          style={{ marginTop: '1rem', padding: '1rem 1.1rem' }}
          aria-label="Анализ по каждому педагогу"
        >
          <h3 className="pedagogical-subheading" style={{ marginTop: 0 }}>
            Режим методиста: ИИ по каждому педагогу
          </h3>
          <p className="muted" style={{ fontSize: '0.88rem', lineHeight: 1.45 }}>
            Для каждой строки таблицы — отдельный прогон: псевдонимизация по тексту этого педагога, затем модель. В
            пошаговом режиме откройте{' '}
            <Link to={`/analytics/pedagogical/${id}/review`} target="_blank" rel="noreferrer">
              «Согласование» в новой вкладке
            </Link>
            , чтобы видеть заполнение карточек по мере готовности. Дашборд Excel — кнопка в шапке сессии.
          </p>
          {teachersProgress ? (
            <div className="pedagogical-teachers-progress" style={{ marginTop: '0.75rem' }}>
              <div
                className="pedagogical-teachers-progress-track"
                style={{
                  height: 10,
                  borderRadius: 6,
                  background: 'color-mix(in srgb, var(--page-fg, #111) 12%, transparent)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round((100 * teachersProgress.done) / Math.max(1, teachersProgress.total))}%`,
                    background: 'var(--accent, #e30613)',
                    transition: 'width 0.25s ease-out',
                  }}
                />
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                Обработано педагогов: {teachersProgress.done} / {teachersProgress.total}
              </p>
            </div>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn primary"
              disabled={
                saveBusy ||
                analysisBusy ||
                excelBusy ||
                teachersStepBusy ||
                teachersBatchBusy ||
                state.sourceBlocks.length < 1
              }
              onClick={() => void onSequentialTeachers()}
            >
              {teachersStepBusy ? 'Идёт анализ…' : 'Пошагово (прогресс → согласование)'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={
                saveBusy ||
                analysisBusy ||
                excelBusy ||
                teachersStepBusy ||
                teachersBatchBusy ||
                state.sourceBlocks.length < 1 ||
                state.sourceBlocks.length > MAX_TEACHERS_PARALLEL_BATCH
              }
              onClick={() => void onParallelTeachersBatch()}
            >
              {teachersBatchBusy ? 'Параллельный запуск…' : `Параллельно (до ${MAX_TEACHERS_PARALLEL_BATCH} педагогов)`}
            </button>
          </div>
          {state.sourceBlocks.length > MAX_TEACHERS_PARALLEL_BATCH ? (
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Строк больше {MAX_TEACHERS_PARALLEL_BATCH}: используйте пошаговый режим или разбейте файл.
            </p>
          ) : null}
        </section>
      ) : null}

      {state.piiAuto ? (
        <p className="muted" style={{ fontSize: '0.88rem', marginTop: '0.75rem' }}>
          Последний прогон: найдено сущностей — <strong>{state.piiAuto.entityCount}</strong>, из них авто —{' '}
          <strong>{state.piiAuto.autoDetectedCount}</strong>
          {state.piiAuto.at ? ` · ${new Date(state.piiAuto.at).toLocaleString('ru-RU')}` : ''}
        </p>
      ) : null}

      {state.redactedSource ? (
        <details className="pedagogical-map-details" style={{ marginTop: '0.75rem' }}>
          <summary>Текст, ушедший в модель (только токены)</summary>
          <pre className="pedagogical-redacted-preview">{state.redactedSource}</pre>
        </details>
      ) : null}

      {state.llmLast ? (
        <div className="pedagogical-llm-last">
          <h3 className="pedagogical-subheading">Ответ модели</h3>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            {state.llmLast.at ? new Date(state.llmLast.at).toLocaleString('ru-RU') : ''}
            {state.llmLast.provider ? ` · ${state.llmLast.provider}` : ''}
          </p>
          <span className="field-label">С подстановкой значений</span>
          <pre className="pedagogical-redacted-preview pedagogical-llm-plain">{state.llmLast.replyPlain}</pre>
          <details className="pedagogical-map-details">
            <summary>Ответ с токенами (как от модели)</summary>
            <pre className="pedagogical-redacted-preview pedagogical-llm-redacted">{state.llmLast.replyRedacted}</pre>
          </details>
        </div>
      ) : null}

      {mapEntries.length > 0 && (
        <details className="pedagogical-map-details">
          <summary>Таблица соответствия (на сервере, не в LLM)</summary>
          <table className="pedagogical-map-table">
            <thead>
              <tr>
                <th>Токен</th>
                <th>Значение</th>
              </tr>
            </thead>
            <tbody>
              {mapEntries.map(([tok, val]) => (
                <tr key={tok}>
                  <td>
                    <code>{tok}</code>
                  </td>
                  <td>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <details className="pedagogical-map-details" style={{ marginTop: '1rem' }}>
        <summary>Проверка расшифровки фрагмента</summary>
        <textarea
          className="input pedagogical-plain-textarea"
          rows={4}
          value={mockLlmOut}
          onChange={(e) => setMockLlmOut(e.target.value)}
          placeholder="Вставьте фрагмент с токенами…"
        />
        {detokenizedPreview ? (
          <pre className="pedagogical-redacted-preview pedagogical-detoken-preview-inner">{detokenizedPreview}</pre>
        ) : null}
      </details>

      <p className="muted" style={{ marginTop: '1.25rem' }}>
        Далее: <Link to={`/analytics/pedagogical/${id}/review`}>согласование</Link> ·{' '}
        <Link to={`/analytics/pedagogical/${id}/report`}>отчёт и уведомления</Link>
      </p>
    </div>
  );
}

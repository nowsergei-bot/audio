import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { adminStagger, adminStaggerItem } from '../motion/adminMotion';
import AiWaitIndicator from '../components/AiWaitIndicator';
import {
  listSurveys,
  phenomenalReportPublicUrl,
  getPhenomenalReportProject,
  postPhenomenalLessonsClusterReportBlocks,
  postPhenomenalPreviewPulseComments,
  postPhenomenalReportProject,
  putPhenomenalReportProject,
} from '../api/client';
import PhenomenalBlockCompetencyPanel from '../lib/phenomenalLessons/PhenomenalBlockCompetencyPanel';
import { downloadPhenomenalReportXlsx } from '../lib/phenomenalLessons/exportPhenomenalReportXlsx';
import {
  applyPhenomenalBlockClusterGroups,
  buildDraftFromMerge,
  buildDraftFromTeacherRows,
  emptyBlock,
  emptyReviewLine,
  PHENOMENAL_REPORT_AUTOSAVE_KEY,
  PHENOMENAL_REPORT_SEED_KEY,
  type PhenomenalReportBlockDraft,
  type PhenomenalReportDraft,
} from '../lib/phenomenalLessons/reportDraftTypes';
import type { TeacherLessonChecklistRow } from '../lib/phenomenalLessons/parseTeacherChecklistApril';
import type { PhenomenalLessonsMergePayload, Survey } from '../types';

function applyPulseCommentsToDraft(
  d: PhenomenalReportDraft,
  pulse: Record<string, { question: string; text: string }[]>,
): PhenomenalReportDraft {
  const blocks = d.blocks.map((block) => {
    const snippets = pulse[block.id] ?? [];
    const manual = block.reviews.filter((r) => !r.fromPulse);
    const pulseReviews =
      snippets.length === 0
        ? []
        : snippets.map((s, i) => ({
            id: `pulse-${block.id}-${i}`,
            text: `${String(s.question || 'Вопрос').trim()}\n\n${String(s.text || '').trim()}`.trim(),
            fromMergedParent: true,
            fromPulse: true,
          }));
    return { ...block, reviews: [...manual, ...pulseReviews] };
  });
  return { ...d, blocks, updatedAt: new Date().toISOString() };
}

function pulseSignatureForDraft(d: PhenomenalReportDraft): string {
  const sid = d.surveyId != null ? String(d.surveyId) : '';
  const parts = d.blocks.map((b) =>
    [b.id, b.lessonCode, b.conductingTeachers, b.parentClassLabel ?? ''].join('\t'),
  );
  return `${sid}::${parts.join('|')}`;
}

function swapBlocks(blocks: PhenomenalReportBlockDraft[], i: number, j: number): PhenomenalReportBlockDraft[] {
  if (j < 0 || j >= blocks.length) return blocks;
  const next = [...blocks];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function swapReviews(
  block: PhenomenalReportBlockDraft,
  i: number,
  j: number,
): PhenomenalReportBlockDraft {
  if (j < 0 || j >= block.reviews.length) return block;
  const rev = [...block.reviews];
  [rev[i], rev[j]] = [rev[j], rev[i]];
  return { ...block, reviews: rev };
}

export default function PhenomenalReportEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<PhenomenalReportDraft | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [clusterBusy, setClusterBusy] = useState(false);
  const [clusterErr, setClusterErr] = useState<string | null>(null);
  const [savedProject, setSavedProject] = useState<{ id: number; directorShareToken: string } | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseErr, setPulseErr] = useState<string | null>(null);
  const [pulseHint, setPulseHint] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<PhenomenalReportDraft | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseReq = useRef(0);

  draftRef.current = draft;

  useEffect(() => {
    let cancelled = false;
    void listSurveys()
      .then((list) => {
        if (!cancelled) setSurveys(list);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    const projectIdRaw = params.get('project');
    const projectId = projectIdRaw ? Number(projectIdRaw) : NaN;

    void (async () => {
      if (Number.isFinite(projectId) && projectId > 0) {
        try {
          const { project, draft: d } = await getPhenomenalReportProject(projectId);
          if (cancelled) return;
          setDraft(d);
          setSavedProject({ id: project.id, directorShareToken: project.director_share_token });
          setLoadMsg('Проект загружен с сервера.');
          return;
        } catch (e) {
          if (!cancelled) {
            setSavedProject(null);
            setLoadMsg(e instanceof Error ? e.message : 'Не удалось загрузить проект');
          }
        }
      } else if (!cancelled) {
        setSavedProject(null);
      }

      let seeded = false;
      if (params.get('from') === 'seed') {
        const raw = sessionStorage.getItem(PHENOMENAL_REPORT_SEED_KEY);
        if (raw) {
          try {
            const data = JSON.parse(raw) as {
              kind?: string;
              payload?: PhenomenalLessonsMergePayload;
              rows?: unknown[];
              fileLabel?: string;
            };
            sessionStorage.removeItem(PHENOMENAL_REPORT_SEED_KEY);
            if (data.kind === 'merge' && data.payload) {
              if (!cancelled) {
                setDraft(
                  buildDraftFromMerge(data.payload, {
                    title: data.payload.survey?.title,
                  }),
                );
                setLoadMsg('Черновик собран из результата слияния с ИИ.');
              }
              seeded = true;
            } else if (data.kind === 'teacher' && Array.isArray(data.rows) && data.rows.length) {
              if (!cancelled) {
                setDraft(
                  buildDraftFromTeacherRows(data.rows as TeacherLessonChecklistRow[], {
                    title: data.fileLabel || undefined,
                  }),
                );
                setLoadMsg('Блоки заполнены из Excel педагогов; отзывы родителей добавьте вручную.');
              }
              seeded = true;
            }
          } catch {
            if (!cancelled) setLoadMsg('Не удалось разобрать сохранённые данные.');
          }
        }
      }

      if (!seeded && !(Number.isFinite(projectId) && projectId > 0)) {
        try {
          const saved = localStorage.getItem(PHENOMENAL_REPORT_AUTOSAVE_KEY);
          if (saved) {
            const d = JSON.parse(saved) as PhenomenalReportDraft;
            if (d && Array.isArray(d.blocks) && !cancelled) {
              setDraft((prev) => prev ?? d);
              if (!params.get('from')) setLoadMsg('Восстановлен черновик с диска (автосохранение).');
            }
          }
        } catch {
          /* ignore */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  useEffect(() => {
    if (!draft) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const toSave = { ...draft, updatedAt: new Date().toISOString() };
        localStorage.setItem(PHENOMENAL_REPORT_AUTOSAVE_KEY, JSON.stringify(toSave));
      } catch {
        /* quota */
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft]);

  useEffect(() => {
    setDraft((d) => {
      if (!d) return d;
      if (d.surveyId != null && Number.isFinite(Number(d.surveyId)) && Number(d.surveyId) >= 1) return d;
      const hasPulse = d.blocks.some((b) => b.reviews.some((r) => r.fromPulse));
      if (!hasPulse) return d;
      return {
        ...d,
        blocks: d.blocks.map((b) => ({ ...b, reviews: b.reviews.filter((r) => !r.fromPulse) })),
        updatedAt: new Date().toISOString(),
      };
    });
  }, [draft?.surveyId]);

  const pulseSig = draft ? pulseSignatureForDraft(draft) : '';

  useEffect(() => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    const d = draftRef.current;
    if (!d?.surveyId || !Number.isFinite(Number(d.surveyId)) || Number(d.surveyId) < 1) {
      setPulseBusy(false);
      setPulseErr(null);
      setPulseHint(null);
      return () => {
        if (pulseTimer.current) clearTimeout(pulseTimer.current);
      };
    }

    pulseTimer.current = setTimeout(() => {
      const cur = draftRef.current;
      if (!cur?.surveyId || Number(cur.surveyId) < 1) return;
      const surveyId = Number(cur.surveyId);
      const req = ++pulseReq.current;
      setPulseBusy(true);
      setPulseErr(null);
      void postPhenomenalPreviewPulseComments(surveyId, cur.blocks)
        .then((res) => {
          if (pulseReq.current !== req) return;
          setPulseHint(res.pulse_hint ?? null);
          setDraft((state) => {
            if (!state || state.surveyId !== surveyId) return state;
            return applyPulseCommentsToDraft(state, res.parent_pulse_comments || {});
          });
        })
        .catch((e) => {
          if (pulseReq.current !== req) return;
          setPulseErr(e instanceof Error ? e.message : 'Не удалось загрузить отзывы с Пульса');
        })
        .finally(() => {
          if (pulseReq.current === req) setPulseBusy(false);
        });
    }, 550);

    return () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, [pulseSig]);

  const updateBlock = useCallback((index: number, patch: Partial<PhenomenalReportBlockDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = [...d.blocks];
      blocks[index] = { ...blocks[index], ...patch };
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const updateReview = useCallback((blockIndex: number, reviewIndex: number, text: string) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = [...d.blocks];
      const b = { ...blocks[blockIndex] };
      const reviews = [...b.reviews];
      const prev = reviews[reviewIndex];
      reviews[reviewIndex] = {
        ...prev,
        text,
        ...(prev.fromPulse ? { fromPulse: false } : {}),
      };
      b.reviews = reviews;
      blocks[blockIndex] = b;
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const removeBlock = useCallback((index: number) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = d.blocks.filter((_, i) => i !== index);
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const moveBlock = useCallback((index: number, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const j = index + dir;
      return { ...d, blocks: swapBlocks(d.blocks, index, j), updatedAt: new Date().toISOString() };
    });
  }, []);

  const addBlock = useCallback(() => {
    setDraft((d) => {
      const base =
        d ??
        ({
          title: 'Отчёт по феноменальным урокам',
          periodLabel: '',
          blocks: [],
          surveyId: null,
          updatedAt: new Date().toISOString(),
        } as PhenomenalReportDraft);
      return {
        ...base,
        blocks: [...base.blocks, emptyBlock()],
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const addReview = useCallback((blockIndex: number) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = [...d.blocks];
      const b = { ...blocks[blockIndex] };
      b.reviews = [...b.reviews, emptyReviewLine()];
      blocks[blockIndex] = b;
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const removeReview = useCallback((blockIndex: number, reviewIndex: number) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = [...d.blocks];
      const b = { ...blocks[blockIndex] };
      b.reviews = b.reviews.filter((_, i) => i !== reviewIndex);
      blocks[blockIndex] = b;
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const moveReview = useCallback((blockIndex: number, reviewIndex: number, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const blocks = [...d.blocks];
      blocks[blockIndex] = swapReviews(blocks[blockIndex], reviewIndex, reviewIndex + dir);
      return { ...d, blocks, updatedAt: new Date().toISOString() };
    });
  }, []);

  const clearAutosave = useCallback(() => {
    localStorage.removeItem(PHENOMENAL_REPORT_AUTOSAVE_KEY);
    setDraft(null);
    setLoadMsg(null);
    setSavedProject(null);
    setServerMsg(null);
    setServerErr(null);
    navigate('/analytics/phenomenal/report', { replace: true });
  }, [navigate]);

  const saveProjectToServer = useCallback(async () => {
    if (!draft) return;
    setSaveBusy(true);
    setServerErr(null);
    setServerMsg(null);
    try {
      const sid =
        draft.surveyId != null && Number.isFinite(Number(draft.surveyId)) ? Number(draft.surveyId) : null;
      const nextDraft: PhenomenalReportDraft = {
        ...draft,
        surveyId: sid,
        updatedAt: new Date().toISOString(),
      };
      const payload = { title: nextDraft.title, survey_id: sid, draft: nextDraft };
      if (savedProject?.id) {
        const { project, draft: d } = await putPhenomenalReportProject(savedProject.id, payload);
        setDraft(d);
        setSavedProject({ id: project.id, directorShareToken: project.director_share_token });
        setServerMsg('Сохранено на сервере.');
      } else {
        const { project, draft: d } = await postPhenomenalReportProject(payload);
        setDraft(d);
        setSavedProject({ id: project.id, directorShareToken: project.director_share_token });
        navigate(`/analytics/phenomenal/report?project=${project.id}`, { replace: true });
        setServerMsg('Проект создан. Скопируйте ссылку для руководителя.');
      }
    } catch (e) {
      setServerErr(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaveBusy(false);
    }
  }, [draft, savedProject?.id, navigate]);

  const copyDirectorLink = useCallback(async () => {
    const t = savedProject?.directorShareToken;
    if (!t) return;
    const url = phenomenalReportPublicUrl(t);
    try {
      await navigator.clipboard.writeText(url);
      setServerMsg('Ссылка для руководителя скопирована в буфер обмена.');
      setServerErr(null);
    } catch {
      setServerMsg(url);
      setServerErr(null);
    }
  }, [savedProject?.directorShareToken]);

  const startNewProject = useCallback(() => {
    setSavedProject(null);
    setServerMsg(null);
    setServerErr(null);
    navigate('/analytics/phenomenal/report', { replace: true });
    setDraft({
      title: 'Отчёт по феноменальным урокам',
      periodLabel: '',
      blocks: [emptyBlock()],
      updatedAt: new Date().toISOString(),
      surveyId: null,
    });
    setLoadMsg('Новый проект. Сохраните на сервере, чтобы получить ссылку для руководителя.');
  }, [navigate]);

  const exportXlsx = useCallback(() => {
    if (!draft) return;
    const safe = draft.title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80);
    void downloadPhenomenalReportXlsx(draft, `${safe || 'phenomenal-report'}.xlsx`);
  }, [draft]);

  const runAiClusterBlocks = useCallback(async () => {
    if (!draft || draft.blocks.length < 2) return;
    setClusterBusy(true);
    setClusterErr(null);
    try {
      const { groups, warning } = await postPhenomenalLessonsClusterReportBlocks(draft.blocks);
      const next = applyPhenomenalBlockClusterGroups(draft.blocks, groups);
      if (!next) {
        setClusterErr('Сервер вернул некорректное разбиение на группы. Попробуйте ещё раз.');
        return;
      }
      setDraft({
        ...draft,
        blocks: next,
        updatedAt: new Date().toISOString(),
      });
      let msg = `ИИ свёл дубликаты уроков: было ${draft.blocks.length} блок(ов), стало ${next.length}.`;
      if (warning) {
        msg += ` ${warning}`;
      }
      setLoadMsg(msg);
    } catch (e) {
      setClusterErr(e instanceof Error ? e.message : 'Ошибка запроса к ИИ');
    } finally {
      setClusterBusy(false);
    }
  }, [draft]);

  return (
    <motion.div
      className="page phenomenal-report-editor-page"
      variants={adminStagger}
      initial="hidden"
      animate="show"
    >
      <motion.section className="card glass-surface" variants={adminStaggerItem}>
        <p className="admin-dash-kicker">
          <Link to="/analytics/phenomenal" className="phenomenal-report-back-link">
            ← Феноменальные уроки
          </Link>
        </p>
        <h1 className="admin-dash-title">Редактор отчёта (как лист «Отзывы»)</h1>
        <p className="muted admin-dash-lead">
          Слева в каждом блоке — поля урока; справа — диаграмма метрик. Ниже — выводы педагога и отзывы родителей. Выберите
          опрос на Пульсе: свободные ответы подставятся в строки отзывов автоматически (по шифру, классу и ФИО ведущих);
          правка текста строки снимает метку «Пульс».
        </p>
        {loadMsg ? (
          <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.92rem' }}>
            {loadMsg}
          </p>
        ) : null}
      </motion.section>

      {!draft ? (
        <motion.section className="card glass-surface" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
          <p className="muted">
            Нет данных для редактора. Вернитесь на страницу феноменальных уроков и после слияния с ИИ нажмите «Открыть
            редактор отчёта», либо «Черновик только из Excel педагогов».
          </p>
          <p style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn" onClick={() => navigate('/analytics/phenomenal')}>
              К загрузке и слиянию
            </button>
          </p>
        </motion.section>
      ) : (
        <>
          <motion.section className="card glass-surface phenomenal-report-meta" variants={adminStaggerItem} style={{ marginTop: '1rem' }}>
            <label className="phenomenal-report-label">
              Заголовок отчёта
              <input
                type="text"
                className="phenomenal-report-input"
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, title: e.target.value, updatedAt: new Date().toISOString() } : d))
                }
              />
            </label>
            <label className="phenomenal-report-label">
              Период (подзаголовок, необязательно)
              <input
                type="text"
                className="phenomenal-report-input"
                value={draft.periodLabel}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, periodLabel: e.target.value, updatedAt: new Date().toISOString() } : d))
                }
              />
            </label>
            <label className="phenomenal-report-label">
              Опрос родителей на Пульсе (автоотзывы в редакторе и ссылка руководителю)
              <select
                className="phenomenal-report-input"
                value={draft.surveyId != null ? String(draft.surveyId) : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          surveyId: v ? Number(v) : null,
                          updatedAt: new Date().toISOString(),
                        }
                      : d,
                  );
                }}
              >
                <option value="">— Не выбран —</option>
                {surveys
                  .filter((s) => s.status === 'published' || s.status === 'closed')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
              </select>
            </label>
            {pulseBusy ? (
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
                Подтягиваю отзывы с Пульса…
              </p>
            ) : null}
            {pulseErr ? (
              <p className="err" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
                {pulseErr}
              </p>
            ) : null}
            {pulseHint ? (
              <p className="muted" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
                {pulseHint}
              </p>
            ) : null}
            <div className="phenomenal-report-toolbar">
              <motion.button
                type="button"
                className="btn primary"
                disabled={saveBusy}
                onClick={() => void saveProjectToServer()}
                whileTap={{ scale: 0.97 }}
              >
                {saveBusy ? 'Сохранение…' : savedProject ? 'Сохранить проект' : 'Сохранить проект на сайте'}
              </motion.button>
              <motion.button
                type="button"
                className="btn"
                disabled={!savedProject?.directorShareToken}
                onClick={() => void copyDirectorLink()}
                whileTap={{ scale: 0.97 }}
              >
                Скопировать ссылку для руководителя
              </motion.button>
              <motion.button type="button" className="btn" onClick={startNewProject} whileTap={{ scale: 0.97 }}>
                Новый проект
              </motion.button>
              <motion.button type="button" className="btn" onClick={exportXlsx} whileTap={{ scale: 0.97 }}>
                Скачать .xlsx
              </motion.button>
              <motion.button type="button" className="btn" onClick={addBlock} whileTap={{ scale: 0.97 }}>
                Добавить блок урока
              </motion.button>
              <motion.button
                type="button"
                className="btn"
                disabled={clusterBusy || draft.blocks.length < 2}
                onClick={() => void runAiClusterBlocks()}
                whileTap={{ scale: 0.97 }}
              >
                {clusterBusy ? 'ИИ группирует…' : 'Свести дубликаты уроков (ИИ)'}
              </motion.button>
              <motion.button type="button" className="btn ghost" onClick={clearAutosave} whileTap={{ scale: 0.97 }}>
                Очистить черновик
              </motion.button>
            </div>
            {serverMsg ? (
              <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.88rem' }}>
                {serverMsg}
              </p>
            ) : null}
            {serverErr ? (
              <p className="err" style={{ marginTop: '0.5rem', fontSize: '0.88rem' }}>
                {serverErr}
              </p>
            ) : null}
            {clusterErr ? (
              <p className="err" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                {clusterErr}
              </p>
            ) : null}
            <AiWaitIndicator
              active={clusterBusy}
              className="phenomenal-cluster-wait"
              label="Нейросеть ищет блоки одного и того же урока (разный шифр, опечатки)"
              typicalMinSec={8}
              typicalMaxSec={35}
              slowAfterSec={55}
            />
            <p className="muted" style={{ marginTop: '0.65rem', fontSize: '0.85rem' }}>
              Автосохранение в браузере (localStorage). Блоков: <strong>{draft.blocks.length}</strong>.
              {savedProject ? (
                <>
                  {' '}
                  Проект на сервере: <strong>№ {savedProject.id}</strong>.
                </>
              ) : null}{' '}
              «Свести дубликаты (ИИ)» при большом числе блоков обрабатывает черновик{' '}
              <strong>порциями по 72</strong> — пары на стыке порций могут потребовать второго нажатия или ручного
              объединения.
            </p>
          </motion.section>

          {draft.blocks.map((block, bi) => (
            <motion.article
              key={block.id}
              className="card glass-surface phenomenal-report-block"
              variants={adminStaggerItem}
              style={{ marginTop: '1rem' }}
            >
              <div className="phenomenal-report-block-head">
                <h2 className="phenomenal-report-block-title">Урок {bi + 1}</h2>
                <div className="phenomenal-report-block-actions">
                  <button type="button" className="btn btn-sm" disabled={bi === 0} onClick={() => moveBlock(bi, -1)}>
                    Блок ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={bi >= draft.blocks.length - 1}
                    onClick={() => moveBlock(bi, 1)}
                  >
                    Блок ↓
                  </button>
                  <button type="button" className="btn btn-sm danger" onClick={() => removeBlock(bi)}>
                    Удалить блок
                  </button>
                </div>
              </div>
              {block.sourceTeacherRowIndex != null ? (
                <p className="muted phenomenal-report-source-tag">
                  {block.sourceTeacherRowIndices && block.sourceTeacherRowIndices.length > 1 ? (
                    <>
                      Данные шапки объединены по шифру из строк Excel педагогов:{' '}
                      <strong>{block.sourceTeacherRowIndices.map((i) => i + 1).join(', ')}</strong> (в файле)
                    </>
                  ) : (
                    <>
                      Данные шапки из строки Excel педагогов: <strong>{block.sourceTeacherRowIndex + 1}</strong> (в
                      файле)
                    </>
                  )}
                  {block.matchConfidence != null
                    ? ` · средняя уверенность ИИ: ${block.matchConfidence.toFixed(2)}`
                    : null}
                </p>
              ) : (
                <p className="muted phenomenal-report-source-tag">Блок добавлен вручную</p>
              )}

              <div className="phenomenal-report-block-top">
                <div className="phenomenal-report-block-fields">
                  <label className="phenomenal-report-label">
                    Шифр урока
                    <input
                      type="text"
                      className="phenomenal-report-input"
                      value={block.lessonCode}
                      onChange={(e) => updateBlock(bi, { lessonCode: e.target.value })}
                    />
                  </label>
                  <label className="phenomenal-report-label">
                    ФИО ведущих
                    <input
                      type="text"
                      className="phenomenal-report-input"
                      value={block.conductingTeachers}
                      onChange={(e) => updateBlock(bi, { conductingTeachers: e.target.value })}
                    />
                  </label>
                  <label className="phenomenal-report-label">
                    Предметы
                    <input
                      type="text"
                      className="phenomenal-report-input"
                      value={block.subjects}
                      onChange={(e) => updateBlock(bi, { subjects: e.target.value })}
                    />
                  </label>
                  <label className="phenomenal-report-label">
                    Оценка методики (/10)
                    <input
                      type="text"
                      className="phenomenal-report-input"
                      value={block.methodologicalScore}
                      onChange={(e) => updateBlock(bi, { methodologicalScore: e.target.value })}
                    />
                  </label>
                  <label className="phenomenal-report-label">
                    Класс как в опросе родителей (Пульс)
                    <input
                      type="text"
                      className="phenomenal-report-input"
                      value={block.parentClassLabel ?? ''}
                      onChange={(e) => updateBlock(bi, { parentClassLabel: e.target.value })}
                      placeholder="Как в ответе родителей на вопрос про класс"
                    />
                  </label>
                </div>
                <div className="phenomenal-report-block-chart">
                  <PhenomenalBlockCompetencyPanel source="block" block={block} variant="half" />
                </div>
              </div>

              <label className="phenomenal-report-label phenomenal-report-label--full phenomenal-report-teacher-notes">
                Выводы педагога (комментарии из Excel)
                <textarea
                  className="phenomenal-report-textarea"
                  rows={3}
                  value={block.teacherNotes}
                  onChange={(e) => updateBlock(bi, { teacherNotes: e.target.value })}
                />
              </label>

              <h3 className="phenomenal-merge-subtitle">Комментарии родителей</h3>
              {block.reviews.length === 0 ? (
                <p className="muted">
                  Пока нет строк — при выбранном опросе на Пульсе ответы подставятся сами; иначе добавьте вручную или
                  соберите черновик из слияния с ИИ.
                </p>
              ) : null}
              {block.reviews.map((rev, ri) => (
                <div key={rev.id} className="phenomenal-report-review-row">
                  <div className="phenomenal-report-review-meta">
                    <span className="phenomenal-report-review-num">{ri + 1}.</span>
                    {rev.fromPulse ? (
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        Пульс
                      </span>
                    ) : rev.fromMergedParent ? (
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        слияние
                      </span>
                    ) : null}
                    <div className="phenomenal-report-review-btns">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={ri === 0}
                        onClick={() => moveReview(bi, ri, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={ri >= block.reviews.length - 1}
                        onClick={() => moveReview(bi, ri, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className="btn btn-sm danger" onClick={() => removeReview(bi, ri)}>
                        Удалить строку
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="phenomenal-report-textarea"
                    rows={5}
                    value={rev.text}
                    onChange={(e) => updateReview(bi, ri, e.target.value)}
                    placeholder="Текст отзыва…"
                  />
                </div>
              ))}
              <button type="button" className="btn btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => addReview(bi)}>
                + Строка отзыва
              </button>
            </motion.article>
          ))}
        </>
      )}
    </motion.div>
  );
}

import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getPhotoWallPhotoFull,
  getPhotoWallPhotos,
  getPublicPhotoWallApproved,
  patchPhotoWallPhoto,
  postPhotoWallApproveAll,
  postPhotoWallClear,
  type GetPublicPhotoWallApprovedResult,
  type PhotoWallClearScope,
} from '../api/client';
import PhotoWallCollage from '../components/PhotoWallCollage';
import { fadeIn } from '../motion/resultsMotion';
import type { PhotoWallModerationStatus, PhotoWallPhotoRow } from '../types';

function PhotoWallModerationThumb({
  id,
  previewData,
  needsFull,
  large,
}: {
  id: number;
  previewData: string;
  needsFull: boolean;
  large?: boolean;
}) {
  const [src, setSrc] = useState(previewData);
  const [thumbErr, setThumbErr] = useState<string | null>(null);

  useEffect(() => {
    setSrc(previewData);
    setThumbErr(null);
  }, [id, previewData]);

  useEffect(() => {
    if (!needsFull || previewData) return;
    let cancelled = false;
    (async () => {
      try {
        const { image_data } = await getPhotoWallPhotoFull(id);
        if (!cancelled) setSrc(image_data);
      } catch (e) {
        if (!cancelled) setThumbErr(e instanceof Error ? e.message : 'Нет превью');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, needsFull, previewData]);

  const cls = `photo-wall-moderation-thumb${large ? ' photo-wall-moderation-thumb--lg' : ''}`;

  if (thumbErr) {
    return (
      <span className={`muted photo-wall-moderation-thumb-fallback${large ? ' photo-wall-moderation-thumb-fallback--lg' : ''}`}>
        {thumbErr}
      </span>
    );
  }
  if (!src) {
    return (
      <span className={`muted photo-wall-moderation-thumb-fallback${large ? ' photo-wall-moderation-thumb-fallback--lg' : ''}`}>
        Загрузка…
      </span>
    );
  }
  return <img src={src} alt="" className={cls} />;
}

/** Горизонтальная лента без дублирования кадров: один скролл, наведение — пауза. */
function ApprovedCollageMarquee({
  sources,
  reduceMotion,
}: {
  sources: string[];
  reduceMotion: boolean | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (sources.length === 0 || reduceMotion) return;
    const el = scrollerRef.current;
    if (!el) return;
    let rafId = 0;
    let stopped = false;
    const tick = () => {
      if (!stopped && !pausedRef.current && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += 0.42;
        const max = el.scrollWidth - el.clientWidth;
        if (el.scrollLeft >= max - 0.5) el.scrollLeft = 0;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [sources, reduceMotion]);

  if (sources.length === 0) return null;
  const staticMode = Boolean(reduceMotion);
  return (
    <div
      ref={scrollerRef}
      className={`photo-wall-results-collage-marquee${staticMode ? ' photo-wall-results-collage-marquee--static' : ''}`}
      aria-hidden="true"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
    >
      <div className="photo-wall-results-collage-strip">
        {sources.map((src, i) => (
          <img
            key={`m-${srcKeyForMarquee(src)}-${i}`}
            src={src}
            alt=""
            className="photo-wall-results-collage-marquee-img"
            draggable={false}
          />
        ))}
      </div>
    </div>
  );
}

function srcKeyForMarquee(src: string): string {
  if (src.length <= 80) return src;
  return `${src.slice(0, 40)}…${src.slice(-30)}`;
}

export default function PhotoWallResultsPage() {
  const reduceMotion = useReducedMotion();
  const [photos, setPhotos] = useState<PhotoWallPhotoRow[]>([]);
  const [collageSources, setCollageSources] = useState<string[]>([]);
  const [collageTruncationHint, setCollageTruncationHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collageErr, setCollageErr] = useState<string | null>(null);
  const [patchingIds, setPatchingIds] = useState<number[]>([]);
  const [clearBusy, setClearBusy] = useState<PhotoWallClearScope | 'database' | null>(null);
  const [approveAllBusy, setApproveAllBusy] = useState(false);

  const mapPhotoRows = useCallback((p: PhotoWallPhotoRow[]) => {
    return p.map((row) => ({
      ...row,
      preview_data: row.preview_data ?? '',
      needs_full_image: Boolean(row.needs_full_image),
      moderation_status: (row.moderation_status || 'pending') as PhotoWallModerationStatus,
    }));
  }, []);

  const emptyApproved = useCallback((): GetPublicPhotoWallApprovedResult => ({ photos: [] }), []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setCollageErr(null);
    try {
      const [p, approved] = await Promise.all([
        getPhotoWallPhotos(),
        getPublicPhotoWallApproved().catch((e) => {
          const msg = e instanceof Error ? e.message : 'Коллаж не загрузился';
          setCollageErr(msg);
          return emptyApproved();
        }),
      ]);
      setPhotos(mapPhotoRows(p));
      setCollageSources(approved.photos.map((r) => r.image_data).filter(Boolean));
      setCollageTruncationHint(approved.truncated && approved.hint ? approved.hint : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [emptyApproved, mapPhotoRows]);

  const refreshSilently = useCallback(async () => {
    try {
      const [p, approved] = await Promise.all([
        getPhotoWallPhotos(),
        getPublicPhotoWallApproved().catch((e) => {
          const msg = e instanceof Error ? e.message : 'Коллаж не загрузился';
          setCollageErr(msg);
          return emptyApproved();
        }),
      ]);
      setPhotos(mapPhotoRows(p));
      setCollageSources(approved.photos.map((r) => r.image_data).filter(Boolean));
      setCollageTruncationHint(approved.truncated && approved.hint ? approved.hint : null);
      setCollageErr(null);
    } catch {
      /* не мешаем работе */
    }
  }, [emptyApproved, mapPhotoRows]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSilently();
    }, 25_000);
    return () => clearInterval(id);
  }, [refreshSilently]);

  const pendingCount = useMemo(() => photos.filter((p) => p.moderation_status === 'pending').length, [photos]);
  const approvedCount = useMemo(() => photos.filter((p) => p.moderation_status === 'approved').length, [photos]);
  const rejectedCount = useMemo(() => photos.filter((p) => p.moderation_status === 'rejected').length, [photos]);

  async function clearWall(scope: PhotoWallClearScope) {
    const lines: Record<PhotoWallClearScope, string> = {
      approved:
        'Удалить все одобренные фото? Они исчезнут с публичного коллажа (записи в базе удалятся).',
      pending: 'Удалить все фото, ещё не обработанные модератором?',
      rejected: 'Удалить все отклонённые записи?',
      all: 'Удалить ВСЕ фото фотостены: необработанные, одобренные и отклонённые?',
    };
    if (!window.confirm(lines[scope])) return;
    if (scope === 'all' && !window.confirm('Подтвердите полную очистку ещё раз.')) return;
    let purgeObjectStorage = false;
    if (scope === 'all') {
      purgeObjectStorage = window.confirm(
        'Удалить также все файлы в Object Storage (префикс photo-wall/ в бакете)? Так освобождается место. «Отмена» — только записи в базе, файлы в бакете останутся.',
      );
    }
    setClearBusy(scope);
    setErr(null);
    try {
      const r = await postPhotoWallClear(scope, scope === 'all' ? { purgeObjectStorage } : undefined);
      await load();
      if (scope === 'all' && r.storage_error) {
        setErr(`Записи в базе удалены. Не удалось почистить бакет: ${r.storage_error}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось очистить');
    } finally {
      setClearBusy(null);
    }
  }

  /** PostgreSQL (`photo_wall_uploads`) + объекты в Yandex Object Storage с префиксом photo-wall/. */
  async function deleteAllDbAndObjectStorage() {
    if (photos.length === 0) return;
    if (
      !window.confirm(
        'Удалить все записи фотостены из базы данных (PostgreSQL) и все файлы фотостены в Yandex Object Storage (префикс photo-wall/ в бакете)? Список модерации и коллаж станут пустыми.',
      )
    ) {
      return;
    }
    if (!window.confirm('Подтвердите ещё раз: отменить будет нельзя.')) return;
    setClearBusy('database');
    setErr(null);
    try {
      const r = await postPhotoWallClear('all', { purgeObjectStorage: true });
      await load();
      if (r.storage_error) {
        setErr(`База данных очищена. Не удалось удалить файлы в Object Storage: ${r.storage_error}`);
      } else if (r.storage_skipped) {
        setErr(
          'База данных очищена. Бакет не чистился: у Cloud Function не включено хранилище (PHOTO_WALL_STORAGE=1 и ключи S3) или бакет не задан.',
        );
      } else {
        setErr(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось выполнить очистку');
    } finally {
      setClearBusy(null);
    }
  }

  async function approveAllPending() {
    if (pendingCount === 0) return;
    if (
      !window.confirm(
        `Одобрить все фото на модерации (${pendingCount})? Они появятся на публичном коллаже.`,
      )
    ) {
      return;
    }
    setApproveAllBusy(true);
    setErr(null);
    try {
      await postPhotoWallApproveAll({
        fallbackPendingIds: photos.filter((p) => p.moderation_status === 'pending').map((p) => p.id),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось одобрить');
    } finally {
      setApproveAllBusy(false);
    }
  }

  async function setStatus(id: number, moderation_status: PhotoWallModerationStatus) {
    const prevPhotos = photos;
    setErr(null);
    setPhotos((prev) =>
      prev.map((x) => (x.id === id ? { ...x, moderation_status } : x)),
    );
    setPatchingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    try {
      await patchPhotoWallPhoto(id, moderation_status);
      void refreshSilently();
    } catch (e) {
      setPhotos(prevPhotos);
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setPatchingIds((prev) => prev.filter((x) => x !== id));
    }
  }

  const authHint =
    err === 'Unauthorized' ? (
      <p className="muted photo-wall-auth-hint">
        Нужна авторизация в админке или действующий API-ключ.{' '}
        <Link to="/auth">Войти</Link>
        {' · '}
        ключ задаётся на главной админки (поле для X-Api-Key).
      </p>
    ) : null;

  return (
    <motion.div className="page results-page photo-wall-results-page" {...fadeIn}>
      <motion.header
        className="card results-hero results-hero--no-aside glass-surface photo-wall-results-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="results-hero-main">
          <p className="results-hero-kicker">Отдельно от опросов</p>
          <h1 className="results-hero-title">Фотостена</h1>
          <p className="muted results-hero-links">
            <a href={`${window.location.origin.replace(/\/$/, '')}/photo-wall`} target="_blank" rel="noreferrer">
              Загрузка
            </a>
            {' · '}
            <a href={`${window.location.origin.replace(/\/$/, '')}/photo-wall/test`} target="_blank" rel="noreferrer">
              Тест
            </a>
            {' · '}
            <a href={`${window.location.origin.replace(/\/$/, '')}/photo-wall/display`} target="_blank" rel="noreferrer">
              Коллаж
            </a>
            {' · '}
            <a
              href={`${window.location.origin.replace(/\/$/, '')}/photo-wall/display?kiosk=1`}
              target="_blank"
              rel="noreferrer"
            >
              Киоск
            </a>
          </p>
        </div>
        <motion.div className="results-hero-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Link to="/" className="btn">
            К списку опросов
          </Link>
        </motion.div>
      </motion.header>

      <motion.section
        className="photo-wall-results-collage-section photo-wall-manage-section card glass-surface"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
      >
        <h2 className="photo-wall-collage-h2">Где снимки и управление стеной</h2>
        <p className="muted photo-wall-collage-lead">
          Загруженные сегодня (и любые другие) фото <strong>не теряются</strong>: они в списке ниже. На публичном коллаже
          видны только <strong>одобренные</strong>. Пока статус «на модерации» — на экране коллажа снимка не будет.
        </p>
        {!loading && !err && (
          <p className="muted photo-wall-manage-stats">
            В списке: на модерации {pendingCount} · на коллаже {approvedCount} · отклонено {rejectedCount}
          </p>
        )}
        <div className="photo-wall-manage-actions">
          <button
            type="button"
            className="btn small primary"
            disabled={Boolean(clearBusy) || approveAllBusy || pendingCount === 0}
            onClick={() => void approveAllPending()}
          >
            {approveAllBusy ? '…' : 'Одобрить всё'}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={Boolean(clearBusy) || approvedCount === 0}
            onClick={() => void clearWall('approved')}
          >
            {clearBusy === 'approved' ? '…' : 'Убрать с коллажа'}
          </button>
          <button
            type="button"
            className="btn small ghost"
            disabled={Boolean(clearBusy) || pendingCount === 0}
            onClick={() => void clearWall('pending')}
          >
            {clearBusy === 'pending' ? '…' : 'Удалить необработанные'}
          </button>
          <button
            type="button"
            className="btn small ghost"
            disabled={Boolean(clearBusy) || rejectedCount === 0}
            onClick={() => void clearWall('rejected')}
          >
            {clearBusy === 'rejected' ? '…' : 'Удалить отклонённые'}
          </button>
          <button
            type="button"
            className="btn small danger"
            disabled={Boolean(clearBusy) || photos.length === 0}
            onClick={() => void clearWall('all')}
          >
            {clearBusy === 'all' ? '…' : 'Очистить всё'}
          </button>
          <button
            type="button"
            className="btn small ghost"
            title="Удаляет строки в PostgreSQL и объекты photo-wall/ в Yandex Object Storage (нужны PHOTO_WALL_STORAGE=1 и права на удаление в бакете)."
            disabled={Boolean(clearBusy) || approveAllBusy || photos.length === 0}
            onClick={() => void deleteAllDbAndObjectStorage()}
          >
            {clearBusy === 'database' ? '…' : 'Удалить всё: БД и бакет'}
          </button>
        </div>
      </motion.section>

      <motion.section
        className="photo-wall-results-collage-section photo-wall-moderation-table-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
      >
        <h2 className="photo-wall-collage-h2">Модерация</h2>
        <p className="muted photo-wall-collage-lead">
          Список подгружается каждые ~5 с — новые снимки появляются внизу сетки без обновления страницы. Решение
          сохраняется сразу.
        </p>
        {loading && <p className="muted">Загрузка…</p>}
        {err && (
          <>
            <p className="err">{err}</p>
            {authHint}
          </>
        )}
        {!loading && photos.length === 0 && !err && <p className="muted">Пока никто не загрузил фото.</p>}
        {!loading && photos.length > 0 && (
          <div className="photo-wall-mod-grid">
            {photos.map((p) => {
              const busy = patchingIds.includes(p.id);
              const s = p.moderation_status;
              return (
                <div key={p.id} className="photo-wall-mod-tile">
                  <div className="photo-wall-mod-tile-visual">
                    <PhotoWallModerationThumb
                      id={p.id}
                      previewData={p.preview_data}
                      needsFull={p.needs_full_image}
                      large
                    />
                    <div className="photo-wall-mod-tile-actions">
                      <button
                        type="button"
                        className={`photo-wall-mod-btn photo-wall-mod-btn--approve${s === 'approved' ? ' photo-wall-mod-btn--lit-green' : ''}`}
                        disabled={busy}
                        onClick={() => void setStatus(p.id, 'approved')}
                      >
                        {busy ? '…' : 'Одобрить'}
                      </button>
                      <button
                        type="button"
                        className={`photo-wall-mod-btn photo-wall-mod-btn--reject${s === 'rejected' ? ' photo-wall-mod-btn--lit-red' : ''}`}
                        disabled={busy}
                        onClick={() => void setStatus(p.id, 'rejected')}
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      <motion.section
        className="photo-wall-results-collage-section"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="photo-wall-collage-h2">Коллаж (как на экране)</h2>
        <p className="muted photo-wall-collage-lead">
          Лента прокручивается горизонтально без повторов кадров (наведите — пауза). Ниже — коллаж: каждый снимок не
          дублируется в сетке.
        </p>
        {collageErr && <p className="err">{collageErr}</p>}
        {collageTruncationHint && (
          <p className="photo-wall-collage-warn" role="status">
            {collageTruncationHint}
          </p>
        )}
        {!loading && !collageErr && collageSources.length > 0 && (
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Одобрено: {collageSources.length}
          </p>
        )}
        <ApprovedCollageMarquee sources={collageSources} reduceMotion={reduceMotion} />
        <PhotoWallCollage sources={collageSources} />
      </motion.section>
    </motion.div>
  );
}

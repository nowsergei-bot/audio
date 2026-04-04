import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getPublicPhotoWallApproved } from '../api/client';
import PhotoWallCollage, { type PhotoWallImmersiveLayout } from '../components/PhotoWallCollage';

function parseImmersiveLayout(params: URLSearchParams): PhotoWallImmersiveLayout {
  const v = (params.get('layout') || '').toLowerCase();
  if (v === 'fluid' || v === 'mosaic' || v === 'romance') return v;
  return 'uniform';
}

function searchWithLayout(
  current: URLSearchParams,
  layout: PhotoWallImmersiveLayout,
): string {
  const p = new URLSearchParams(current);
  if (layout === 'uniform') p.delete('layout');
  else p.set('layout', layout);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Интервал опроса коллажа; по умолчанию 45 с — реже бьём в API и в Neon. Переопределение: VITE_PHOTO_WALL_POLL_MS в .env */
const POLL_MS = (() => {
  const n = Number(import.meta.env.VITE_PHOTO_WALL_POLL_MS);
  return Number.isFinite(n) && n >= 10_000 ? n : 45_000;
})();

type WallItem = { id: number; url: string };

export default function PhotoWallDisplayPage() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const kiosk = searchParams.get('kiosk') === '1';
  const immersiveLayout = parseImmersiveLayout(searchParams);

  const [items, setItems] = useState<WallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [truncationHint, setTruncationHint] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<Date | null>(null);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const payload = await getPublicPhotoWallApproved();
      const next = payload.photos.map((r) => ({ id: r.id, url: r.image_data }));
      setItems((prev) => {
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i]?.id && p.url === next[i]?.url)) {
          return prev;
        }
        return next;
      });
      setTruncationHint(payload.truncated && payload.hint ? payload.hint : null);
      setLastOkAt(new Date());
      if (!silent) setErr(null);
    } catch (e) {
      if (!silent) setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
      setTruncationHint(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const sources = items.map((i) => i.url);
  const sourceIds = items.map((i) => i.id);
  const timeLabel =
    lastOkAt &&
    lastOkAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={`page photo-wall-display-page${kiosk ? ' photo-wall-display-page--kiosk' : ' photo-wall-display-page--live'}`}>
      {!kiosk && (
        <div className="photo-wall-display-bar">
          <span className="photo-wall-display-title">Фотостена</span>
          <div className="photo-wall-display-bar-meta" aria-live="polite">
            {!loading && !err && (
              <span className="photo-wall-display-poll muted" title="Новые одобренные фото подтягиваются автоматически">
                <span className="photo-wall-display-poll-dot" aria-hidden />
                авто · {Math.round(POLL_MS / 1000)} с
                {timeLabel ? ` · ${timeLabel}` : ''}
              </span>
            )}
          </div>
          <div className="photo-wall-display-bar-links">
            <span className="photo-wall-display-layout" aria-label="Режим сетки">
              <Link
                to={{ pathname, search: searchWithLayout(searchParams, 'uniform') }}
                className={`photo-wall-display-layout-link${immersiveLayout === 'uniform' ? ' photo-wall-display-layout-link--on' : ''}`}
              >
                Ровные
              </Link>
              <span className="photo-wall-display-layout-sep" aria-hidden>
                ·
              </span>
              <Link
                to={{ pathname, search: searchWithLayout(searchParams, 'fluid') }}
                className={`photo-wall-display-layout-link${immersiveLayout === 'fluid' ? ' photo-wall-display-layout-link--on' : ''}`}
              >
                По фото
              </Link>
              <span className="photo-wall-display-layout-sep" aria-hidden>
                ·
              </span>
              <Link
                to={{ pathname, search: searchWithLayout(searchParams, 'mosaic') }}
                className={`photo-wall-display-layout-link${immersiveLayout === 'mosaic' ? ' photo-wall-display-layout-link--on' : ''}`}
              >
                Мозаика
              </Link>
              <span className="photo-wall-display-layout-sep" aria-hidden>
                ·
              </span>
              <Link
                to={{ pathname, search: searchWithLayout(searchParams, 'romance') }}
                className={`photo-wall-display-layout-link${immersiveLayout === 'romance' ? ' photo-wall-display-layout-link--on' : ''}`}
              >
                Романтика
              </Link>
            </span>
            <Link to="/photo-wall" className="btn photo-wall-display-upload-link">
              Загрузить
            </Link>
          </div>
        </div>
      )}
      {loading && <p className="muted photo-wall-display-loading">Загрузка…</p>}
      {err && (
        <p className="err photo-wall-display-err" role="alert">
          {err}
        </p>
      )}
      {!kiosk && truncationHint && (
        <p className="muted photo-wall-display-trunc-hint" role="status">
          {truncationHint}
        </p>
      )}
      <motion.div
        className="photo-wall-display-stage"
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <PhotoWallCollage
          sources={sources}
          sourceIds={sourceIds}
          immersive
          immersiveLayout={immersiveLayout}
        />
      </motion.div>
    </div>
  );
}

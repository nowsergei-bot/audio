import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

const SIMPLE_SLOT_COUNT = 28;
/** Случайная смена плиток только в компактном коллаже; на экране/киоске — только плавное подтягивание новых фото. */
const TICK_MS = 2000;

/** Экран коллажа: uniform — ровная сетка 4:5; fluid — та же плотность; mosaic — span 2–3; romance — «поляроидная» стопка с центральным кадром. */
export type PhotoWallImmersiveLayout = 'uniform' | 'fluid' | 'mosaic' | 'romance';

const ROMANCE_CAP = 18;

function romanceUnit(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233 + salt * id * 0.0007) * 43758.5453;
  return x - Math.floor(x);
}

type Props = {
  sources: string[];
  /** Параллельно sources — стабильные id для анимаций и мягкого мержа при опросе API */
  sourceIds?: number[];
  /** Полноэкранный режим экрана коллажа */
  immersive?: boolean;
  /** Только при immersive; по умолчанию uniform */
  immersiveLayout?: PhotoWallImmersiveLayout;
};

type Ori = 'portrait' | 'landscape' | 'square';

function srcKey(src: string): string {
  if (src.length <= 240) return src;
  return `${src.slice(0, 120)}…${src.slice(-100)}`;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Ровно одно вхождение каждого индекса (без повторов кадра); остальные слоты — пустые (-1). */
function buildSlotAssignment(len: number, nSources: number): number[] {
  if (nSources <= 0) return Array.from({ length: len }, () => -1);

  const slotIndices = shuffleInPlace(Array.from({ length: len }, (_, i) => i));

  /** Пока слотов хватает — у каждого снимка ровно одна плитка, остальные слоты пустые. */
  if (nSources <= len) {
    const out = Array.from({ length: len }, () => -1);
    const perm = shuffleInPlace(Array.from({ length: nSources }, (_, i) => i));
    for (let i = 0; i < nSources; i++) {
      out[slotIndices[i]!] = perm[i]!;
    }
    return out;
  }

  /** Снимков больше, чем слотов — случайная подвыборка без повторов. */
  const pick = shuffleInPlace(Array.from({ length: nSources }, (_, i) => i)).slice(0, len);
  const out = Array.from({ length: len }, () => -1);
  for (let i = 0; i < len; i++) {
    out[slotIndices[i]!] = pick[i]!;
  }
  return out;
}

/** Случайная смена одного слота: без пустых ячеек и без дубликатов кадра в сетке. */
function tickSlotPick(prev: number[], nSources: number): number[] {
  if (nSources <= 0) return prev;
  const len = prev.length;
  const next = [...prev];
  const slot = Math.floor(Math.random() * len);
  const removed = next[slot];

  const used = new Set<number>();
  for (let i = 0; i < len; i++) {
    if (i === slot) continue;
    const v = next[i];
    if (v >= 0) used.add(v);
  }

  const candidates: number[] = [];
  for (let ni = 0; ni < nSources; ni++) {
    if (!used.has(ni)) candidates.push(ni);
  }

  if (candidates.length === 0) {
    const j = (slot + 1 + Math.floor(Math.random() * Math.max(1, len - 1))) % len;
    next[slot] = next[j]!;
    next[j] = removed;
    return next;
  }

  const preferChange = candidates.filter((c) => c !== removed);
  const pool = preferChange.length > 0 ? preferChange : candidates;
  next[slot] = pool[Math.floor(Math.random() * pool.length)] ?? removed;
  return next;
}

/** Псевдослучайный базовый паттерн размеров плиток. */
function mosaicModeForIndex(i: number): '1' | '2' | 'w' | 'h' | 'xl' {
  const cycle: ('1' | '2' | 'w' | 'h' | 'xl')[] = [
    '2',
    '1',
    'w',
    '1',
    'h',
    'xl',
    '1',
    'w',
    '1',
    '2',
    'h',
    '1',
    'w',
    '1',
    '1',
    'xl',
    'w',
    '1',
    '2',
    'h',
    '1',
    '1',
    'w',
    'xl',
  ];
  return cycle[i % cycle.length];
}

function effectiveMosaicMode(
  base: '1' | '2' | 'w' | 'h' | 'xl',
  ori: Ori | undefined,
): '1' | '2' | 'w' | 'h' | 'xl' {
  if (!ori || ori === 'square') return base;
  if (ori === 'portrait') {
    if (base === 'w') return 'h';
    if (base === '1') return 'h';
    return base;
  }
  if (ori === 'landscape') {
    if (base === 'h') return 'w';
    if (base === '1') return 'w';
    return base;
  }
  return base;
}

function mosaicClass(mode: '1' | '2' | 'w' | 'h' | 'xl'): string {
  if (mode === '1') return '';
  return `photo-wall-slot--mos-${mode}`;
}

function isFeaturedSlot(i: number, mode: '1' | '2' | 'w' | 'h' | 'xl'): boolean {
  if (mode === 'xl' || mode === '2') return (i * 13) % 7 === 1;
  return (i * 11) % 9 === 2;
}

function useImmersiveSlotCount(immersive: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [nSlots, setNSlots] = useState(56);

  useEffect(() => {
    if (!immersive) return;
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const approx = Math.ceil(r.width / 56) * Math.ceil(r.height / 52);
      setNSlots(Math.min(132, Math.max(42, approx)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [immersive]);

  return { containerRef: ref, nSlots };
}

function useSlotHeights() {
  return useMemo(
    () =>
      Array.from({ length: SIMPLE_SLOT_COUNT }, (_, i) => {
        const base = 88;
        return base + ((i * 19) % 100);
      }),
    [],
  );
}

export function useFeaturedSlotIndices(): Set<number> {
  return useMemo(() => new Set([0, 4, 9, 14, 19, 23]), []);
}

export default function PhotoWallCollage({
  sources,
  sourceIds,
  immersive,
  immersiveLayout = 'uniform',
}: Props) {
  const reduceMotion = useReducedMotion();
  const heights = useSlotHeights();
  const featuredSimple = useFeaturedSlotIndices();
  const { containerRef, nSlots } = useImmersiveSlotCount(Boolean(immersive));

  const [slotPick, setSlotPick] = useState<number[]>(() => new Array(132).fill(-1));
  const [oriBySrc, setOriBySrc] = useState<Record<string, Ori>>({});
  const prevSourcesRef = useRef<string[]>([]);

  const nSources = sources.length;
  const rawCap = immersive ? nSlots : SIMPLE_SLOT_COUNT;
  /** Без пустых плиток: показываем не больше min(cap, n) ячеек, все с фото. */
  const slotCount = nSources === 0 ? 0 : Math.min(rawCap, nSources);

  const onImgLoad = useCallback((src: string, naturalWidth: number, naturalHeight: number) => {
    if (!naturalWidth || !naturalHeight) return;
    const k = srcKey(src);
    let o: Ori = 'square';
    if (naturalHeight > naturalWidth * 1.08) o = 'portrait';
    else if (naturalWidth > naturalHeight * 1.08) o = 'landscape';
    setOriBySrc((p) => (p[k] === o ? p : { ...p, [k]: o }));
  }, []);

  useEffect(() => {
    const len = slotCount;
    if (nSources === 0) {
      setSlotPick([]);
      prevSourcesRef.current = [];
      return;
    }

    const prev = prevSourcesRef.current;
    const sameCountAndUrls =
      prev.length === nSources && prev.every((s, i) => sources[i] === s);
    if (sameCountAndUrls) {
      return;
    }

    setSlotPick(buildSlotAssignment(len, nSources));
    prevSourcesRef.current = [...sources];
  }, [sources, immersive, nSlots, nSources, slotCount]);

  useEffect(() => {
    if (nSources === 0 || reduceMotion || immersive) return;
    const id = window.setInterval(() => {
      setSlotPick((prev) => tickSlotPick(prev, nSources));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [nSources, reduceMotion, immersive]);

  const romanceDeck = useMemo(() => {
    if (!immersive || immersiveLayout !== 'romance') return [];
    const cap = Math.min(ROMANCE_CAP, sources.length);
    const list = sources.map((url, i) => ({
      url,
      id: sourceIds && sourceIds.length > i ? sourceIds[i]! : i,
    }));
    return [...list]
      .sort(
        (a, b) =>
          ((a.id * 2654435761 + 2246822519) >>> 0) - ((b.id * 2654435761 + 2246822519) >>> 0),
      )
      .slice(0, cap);
  }, [immersive, immersiveLayout, sources, sourceIds]);

  /** Один снимок — несколько «отпечатков» со сдвигом, иначе коллаж пустой; при 2+ — как есть. */
  const romanceLayers = useMemo(() => {
    if (romanceDeck.length === 0) return [];
    if (romanceDeck.length >= 2) {
      return romanceDeck.map((item, layer) => ({ ...item, layer }));
    }
    const only = romanceDeck[0]!;
    const stackN = 6;
    return Array.from({ length: stackN }, (_, layer) => ({ ...only, layer }));
  }, [romanceDeck]);

  const romanceHeroIdx = useMemo(
    () => (romanceLayers.length === 0 ? 0 : Math.floor(romanceLayers.length / 2)),
    [romanceLayers.length],
  );

  if (sources.length === 0) {
    return (
      <div className={`photo-wall-collage-empty ${immersive ? 'photo-wall-collage-empty--immersive' : ''}`}>
        <div className={immersive ? 'photo-wall-empty-immersive-inner' : undefined}>
          <p className={immersive ? 'photo-wall-display-muted' : 'muted'}>Пока нет фотографий для показа.</p>
          {immersive && (
            <p className="photo-wall-display-muted photo-wall-empty-hint">
              После одобрения модератором снимки появятся здесь. Страница сама подгружает новые фото.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!immersive) {
    return (
      <div className="photo-wall-collage photo-wall-collage--mat" aria-label="Коллаж фотостены">
        {Array.from({ length: slotCount }, (_, i) => {
          const srcIdx = slotPick[i] ?? -1;
          const src = srcIdx >= 0 ? sources[srcIdx] : null;
          const isFeatured = featuredSimple.has(i);
          const h = heights[i];
          const dur = reduceMotion ? 0 : 20 + (i % 11) * 0.9;
          const delay = reduceMotion ? 0 : (i % 14) * 0.28;
          const ori = src ? oriBySrc[srcKey(src)] : undefined;
          const oriClass = ori ? ` photo-wall-slot--ori-${ori}` : '';
          return (
            <div
              key={`slot-${i}`}
              className={`photo-wall-slot photo-wall-slot--mat${isFeatured ? ' photo-wall-slot--featured' : ''}${oriClass}${src ? '' : ' photo-wall-slot--empty'}`}
              style={{ minHeight: h, height: h }}
            >
              <motion.div
                className="photo-wall-slot-inner"
                animate={
                  reduceMotion
                    ? undefined
                    : { y: [0, -6, 4, 0], x: [0, 5, -4, 0], rotate: [0, 0.4, -0.35, 0] }
                }
                transition={reduceMotion ? undefined : { duration: dur, repeat: Infinity, ease: 'easeInOut', delay }}
              >
                {src ? (
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={`${i}-${srcIdx}-${src.slice(0, 24)}`}
                      src={src}
                      alt=""
                      className="photo-wall-img"
                      initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.05 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: reduceMotion ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
                      draggable={false}
                      loading="lazy"
                      onLoad={(e) => {
                        const im = e.currentTarget;
                        onImgLoad(src, im.naturalWidth, im.naturalHeight);
                      }}
                    />
                  </AnimatePresence>
                ) : null}
              </motion.div>
            </div>
          );
        })}
      </div>
    );
  }

  if (immersive && immersiveLayout === 'romance') {
    return (
      <div
        ref={containerRef}
        className={`photo-wall-marquee-root photo-wall-marquee-root--romance${
          reduceMotion ? ' photo-wall-marquee-root--static' : ''
        }`}
        aria-label="Коллаж фотостены, романтика"
      >
        <div className="photo-wall-marquee-track photo-wall-marquee-track--romance">
          <div className="photo-wall-marquee-panel photo-wall-marquee-panel--romance">
            <div className="photo-wall-collage photo-wall-collage--immersive photo-wall-collage--romance">
              <div className="photo-wall-romance-sizer" aria-hidden />
              {romanceLayers.map((item, i) => {
                const isHero = i === romanceHeroIdx;
                const salt = 1 + item.layer * 11;
                const id = item.id + item.layer * 9973;
                const u1 = romanceUnit(id, salt);
                const u2 = romanceUnit(id, salt + 1);
                const u3 = romanceUnit(id, salt + 2);
                const u4 = romanceUnit(id, salt + 3);
                const rot = isHero ? 0 : (u1 - 0.5) * 28;
                const dx = isHero ? 0 : (u2 - 0.5) * 48;
                const dy = isHero ? 0 : (u3 - 0.5) * 44;
                const z = isHero ? 50 : 6 + Math.floor(u4 * 20);
                const cardStyle: CSSProperties = {
                  zIndex: z,
                  left: '50%',
                  top: '50%',
                  transform: `translate(calc(-50% + ${dx}vmin), calc(-50% + ${dy}vmin)) rotate(${rot}deg)`,
                };
                return (
                  <motion.div
                    key={`rom-${item.id}-L${item.layer}`}
                    className={`photo-wall-romance-card${isHero ? ' photo-wall-romance-card--hero' : ''}`}
                    style={cardStyle}
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: reduceMotion ? 0.15 : 0.5,
                      delay: reduceMotion ? 0 : i * 0.035,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <div className="photo-wall-romance-card-frame">
                      <img
                        src={item.url}
                        alt=""
                        className="photo-wall-romance-img"
                        draggable={false}
                        loading={i < 8 ? 'eager' : 'lazy'}
                        onLoad={(e) => {
                          const im = e.currentTarget;
                          onImgLoad(item.url, im.naturalWidth, im.naturalHeight);
                        }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const immersiveGridClass =
    immersiveLayout === 'mosaic'
      ? 'photo-wall-collage--mosaic'
      : immersiveLayout === 'fluid'
        ? 'photo-wall-collage--immersive-fluid'
        : 'photo-wall-collage--immersive-uniform';

  const renderImmersiveGrid = (dup: boolean) => (
    <div
      className={`photo-wall-collage photo-wall-collage--immersive photo-wall-collage--immersive-cover ${immersiveGridClass} photo-wall-collage--mat photo-wall-collage--no-drift`}
    >
      {Array.from({ length: slotCount }, (_, i) => {
        const srcIdx = slotPick[i] ?? -1;
        const src = srcIdx >= 0 ? sources[srcIdx] : null;
        const photoId =
          srcIdx >= 0 && sourceIds && sourceIds.length > srcIdx ? sourceIds[srcIdx]! : srcIdx;
        const imgKey =
          photoId >= 0 ? `pw-${dup ? 'd' : 'a'}-${photoId}` : `slot-${dup ? 'd' : 'a'}-${i}-empty`;
        const ori = src ? oriBySrc[srcKey(src)] : undefined;
        const baseMode = mosaicModeForIndex(i);
        const mode = effectiveMosaicMode(baseMode, ori);
        const mosPiece = immersiveLayout === 'mosaic' ? mosaicClass(mode) : '';
        const mosExtra =
          immersiveLayout === 'mosaic'
            ? ` photo-wall-slot--mosaic${mosPiece ? ` ${mosPiece}` : ''}`
            : immersiveLayout === 'fluid'
              ? ' photo-wall-slot--fluid'
              : ' photo-wall-slot--uniform';
        const featured = isFeaturedSlot(i, mode);
        const oriClass = ori ? ` photo-wall-slot--ori-${ori}` : '';
        return (
          <div
            key={`slot-${dup ? 'd' : 'a'}-${i}`}
            className={`photo-wall-slot photo-wall-slot--mat${mosExtra}${
              featured ? ' photo-wall-slot--featured' : ''
            }${oriClass}${src ? '' : ' photo-wall-slot--empty'}`}
          >
            <div className="photo-wall-slot-inner">
              {src ? (
                <AnimatePresence mode="wait">
                  <motion.img
                    key={imgKey}
                    src={src}
                    alt=""
                    className="photo-wall-img"
                    initial={
                      reduceMotion
                        ? { opacity: 1, x: 0 }
                        : { opacity: 0, x: 36, filter: 'blur(4px)' }
                    }
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={
                      reduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, x: -28, filter: 'blur(3px)' }
                    }
                    transition={{
                      duration: reduceMotion ? 0.2 : 1.05,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    draggable={false}
                    loading={i < 24 ? 'eager' : 'lazy'}
                    onLoad={(e) => {
                      const im = e.currentTarget;
                      onImgLoad(src, im.naturalWidth, im.naturalHeight);
                    }}
                  />
                </AnimatePresence>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`photo-wall-marquee-root${reduceMotion ? ' photo-wall-marquee-root--static' : ''}`}
      aria-label="Коллаж фотостены"
    >
      <div className="photo-wall-marquee-track">
        <div className="photo-wall-marquee-panel">{renderImmersiveGrid(false)}</div>
        <div className="photo-wall-marquee-panel" aria-hidden>
          {renderImmersiveGrid(true)}
        </div>
      </div>
    </div>
  );
}

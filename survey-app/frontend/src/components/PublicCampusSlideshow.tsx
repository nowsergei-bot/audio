import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { PUBLIC_CAMPUS_PHOTOS } from '../data/publicCampusPhotos';

const INTERVAL_MS = 10_000;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Props = {
  /** Слайдшоу только пока респондент заполняет форму */
  active: boolean;
  /** Если передано — используем эти фото вместо кампуса */
  sources?: string[];
};

export default function PublicCampusSlideshow({ active, sources }: Props) {
  const srcs = sources && sources.length ? sources : PUBLIC_CAMPUS_PHOTOS;
  const order = useMemo(() => shuffle([...srcs]), [srcs]);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * order.length));

  useEffect(() => {
    if (!active || order.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((prev) => {
        let next = Math.floor(Math.random() * order.length);
        let guard = 0;
        while (next === prev && guard < 8) {
          next = Math.floor(Math.random() * order.length);
          guard++;
        }
        return next;
      });
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, order.length]);

  const src = order[idx] ?? order[0];

  return (
    <div className="card public-slideshow glass-surface-public" aria-hidden>
      <div className="public-slideshow-frame">
        <AnimatePresence mode="wait">
          <motion.img
            key={src}
            src={src}
            alt=""
            className="public-slideshow-img"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            decoding="async"
          />
        </AnimatePresence>
      </div>
    </div>
  );
}

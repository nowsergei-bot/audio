import { animate, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { useEffect, useState } from 'react';

type Props = { value: number; className?: string; duration?: number };

/** Плавный счётчик целых чисел для показателей на экране. */
export default function AnimatedNumber({ value, className, duration = 0.95 }: Props) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);

  useMotionValueEvent(mv, 'change', (v) => setDisplay(Math.round(v)));

  useEffect(() => {
    const c = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, duration, mv]);

  return <span className={className}>{display}</span>;
}

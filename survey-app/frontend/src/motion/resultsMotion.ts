/** Общие варианты для страницы результатов и ИИ-панели */

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.072,
      delayChildren: 0.06,
    },
  },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 420, damping: 30 },
  },
};

export const springCard = {
  rest: { scale: 1, y: 0, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.25)' },
  hover: {
    scale: 1.008,
    y: -3,
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.38)',
    transition: { type: 'spring', stiffness: 400, damping: 22 },
  },
  tap: { scale: 0.995 },
};

export const barEase = [0.22, 1, 0.36, 1] as const;

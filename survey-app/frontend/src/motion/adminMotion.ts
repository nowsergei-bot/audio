export const adminPageTransition = {
  initial: { opacity: 0, x: 56, filter: 'blur(10px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, x: -40, filter: 'blur(8px)' },
  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
};

export const adminStagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

export const adminStaggerItem = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
  },
};

export const templateCardHover = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.02, y: -4, transition: { type: 'spring', stiffness: 400, damping: 22 } },
  tap: { scale: 0.98 },
};

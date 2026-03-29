import { useId } from 'react';

type Props = {
  className?: string;
  /** sm — компакт; md — средний; brand — длинная линия от логотипа в шапке */
  size?: 'sm' | 'md' | 'brand';
};

/**
 * Анимированная линия ЭКГ (осциллограмма пульса).
 */
export default function PulseEkg({ className = '', size = 'sm' }: Props) {
  const uid = useId().replace(/:/g, '');
  const w = size === 'brand' ? 288 : size === 'md' ? 200 : 132;
  const h = size === 'brand' ? 34 : size === 'md' ? 28 : 22;
  const y = h / 2;
  const sw = size === 'brand' ? 2 : size === 'md' ? 2 : 1.65;
  const d =
    size === 'brand'
      ? `M0 ${y} L20 ${y} L28 ${y - 10} L38 ${y + 9} L48 ${y - 7} L60 ${y + 11} L72 ${y - 12} L88 ${y + 8} L102 ${y} L118 ${y} L128 ${y - 8} L142 ${y + 7} L156 ${y - 6} L172 ${y + 9} L190 ${y} L${w} ${y}`
      : `M0 ${y} L22 ${y} L28 ${y - 7} L34 ${y + 6} L40 ${y - 5} L48 ${y + 8} L56 ${y - 9} L64 ${y + 5} L72 ${y} L${w} ${y}`;

  return (
    <svg
      className={`pulse-ekg pulse-ekg--${size} ${className}`.trim()}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={`pulse-ekg-shine-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="55%" stopColor="rgba(255,200,200,0.4)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path
        className="pulse-ekg__glow"
        d={d}
        fill="none"
        stroke="rgba(227, 6, 19, 0.35)"
        strokeWidth={Number(sw) + 4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="pulse-ekg__trace"
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="pulse-ekg__shine"
        d={d}
        fill="none"
        stroke={`url(#pulse-ekg-shine-${uid})`}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

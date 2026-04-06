import { useEffect, useState } from 'react';

export type AiWaitIndicatorProps = {
  active: boolean;
  /** Что сейчас делает система */
  label: string;
  /** Вместо стандартной фразы про «обычно N–M с» */
  hint?: string;
  typicalMinSec?: number;
  typicalMaxSec?: number;
  /** После стольки секунд — доп. строка про затянувшийся запрос */
  slowAfterSec?: number;
  /** Узкий вариант для встраивания в чат / под кнопки */
  compact?: boolean;
  className?: string;
};

/**
 * Пока идёт запрос к LLM на бэкенде: полоска ожидания, прошедшее время и ориентир по длительности.
 */
export default function AiWaitIndicator({
  active,
  label,
  hint,
  typicalMinSec = 12,
  typicalMaxSec = 55,
  slowAfterSec = Math.max(typicalMaxSec + 30, 75),
  compact,
  className,
}: AiWaitIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const defaultHint = `Обычно ${typicalMinSec}–${typicalMaxSec} с. Большой объём данных или сводка по нескольким опросам могут занять до нескольких минут — это нормально.`;
  const slowNote =
    elapsed >= slowAfterSec
      ? ' Запрос всё ещё выполняется на сервере — не закрывайте вкладку.'
      : '';

  return (
    <div
      className={`ai-wait-indicator${compact ? ' ai-wait-indicator--compact' : ''}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="ai-wait-indicator-head">
        <span className="ai-wait-indicator-label">{label}</span>
        <span className="ai-wait-indicator-elapsed" aria-label={`Прошло секунд: ${elapsed}`}>
          {elapsed < 1 ? 'отправка…' : `${elapsed} с`}
        </span>
      </div>
      <div className="ai-wait-bar-track" aria-hidden>
        <div className="ai-wait-bar-fill" />
      </div>
      <p className={`ai-wait-indicator-meta${compact ? ' ai-wait-indicator-meta--compact' : ''}`}>
        {(hint ?? defaultHint) + slowNote}
      </p>
    </div>
  );
}

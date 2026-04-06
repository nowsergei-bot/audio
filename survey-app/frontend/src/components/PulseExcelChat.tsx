import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { postPulseExcelChat } from '../api/client';
import AiWaitIndicator from './AiWaitIndicator';
import type { AnalyticsChatMessage } from '../types';
import type { FilterSelection } from '../lib/excelAnalytics/engine';

type Props = {
  /** Ключи = как в filterSelection; значения — допустимые строки (срез для модели). */
  facetOptions: Record<string, string[]>;
  facetLabels: Record<string, string>;
  currentFilters: FilterSelection;
  numericSummary: string;
  extraContext?: string;
  onApplyFilters: (update: (prev: FilterSelection) => FilterSelection) => void;
  disabled?: boolean;
  /** Блоки ИИ (отчёты, глубокий режим и т.д.) — над лентой чата */
  embeddedPanel?: ReactNode;
};

function mergeSuggestedFilters(
  current: FilterSelection,
  suggested: Record<string, string[]> | null | undefined,
  facetOptions: Record<string, string[]>,
): FilterSelection {
  if (!suggested || Object.keys(suggested).length === 0) return current;
  const next = { ...current };
  for (const [key, vals] of Object.entries(suggested)) {
    const all = facetOptions[key];
    if (!all || !Array.isArray(vals)) continue;
    const allowed = new Set(all);
    const picked = vals.filter((v) => allowed.has(v));
    if (picked.length === 0) continue;
    if (picked.length === all.length) next[key] = null;
    else next[key] = picked;
  }
  return next;
}

export default function PulseExcelChat({
  facetOptions,
  facetLabels,
  currentFilters,
  numericSummary,
  extraContext,
  onApplyFilters,
  disabled,
  embeddedPanel,
}: Props) {
  const [messages, setMessages] = useState<AnalyticsChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const contextKey = JSON.stringify({ facetOptions, currentFilters, numericSummary: numericSummary.slice(0, 200) });

  useEffect(() => {
    setMessages([]);
    setErr(null);
    setInput('');
  }, [contextKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || disabled) return;
    const nextMsgs: AnalyticsChatMessage[] = [...messages, { role: 'user', content: text }];
    setInput('');
    setMessages(nextMsgs);
    setLoading(true);
    setErr(null);
    try {
      const res = await postPulseExcelChat({
        messages: nextMsgs,
        context: {
          facetOptions,
          facetLabels,
          currentFilters: currentFilters as Record<string, string[] | null>,
          numericSummary: numericSummary.slice(0, 14000),
          extraContext: extraContext?.slice(0, 8000),
        },
      });
      setMessages([...nextMsgs, { role: 'assistant', content: res.reply }]);
      if (res.apply_filters && Object.keys(res.apply_filters).length > 0) {
        onApplyFilters((prev: FilterSelection) => mergeSuggestedFilters(prev, res.apply_filters, facetOptions));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [
    messages,
    input,
    loading,
    disabled,
    facetOptions,
    facetLabels,
    currentFilters,
    numericSummary,
    extraContext,
    onApplyFilters,
  ]);

  return (
    <motion.section
      className="card pulse-excel-chat glass-surface excel-dash-card excel-dash-card--wide"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 }}
      aria-label="ПУЛЬС"
    >
      <div className="pulse-excel-chat-header">
        <h3 className="pulse-excel-chat-title">ПУЛЬС</h3>
        <p className="muted pulse-excel-chat-lead">
          Спросите выборку словами — например: «Покажи географию в 7 классах» или «Сравни наставников по математике». Ответ
          строится по текущим данным дашборда; при необходимости фильтры подставятся автоматически.
        </p>
      </div>
      {embeddedPanel != null ? <div className="pulse-excel-embedded-panel">{embeddedPanel}</div> : null}
      <div className="pulse-excel-chat-conversation">
        <div className="pulse-excel-chat-log" role="log">
          {messages.length === 0 && !loading && (
            <p className="muted pulse-excel-chat-placeholder">
              Например: «Расскажи про уроки географии в 7 классах», «Кто из наставников выше по пункту „Вовлечённость“?»
            </p>
          )}
          {messages.map((m, i) => (
            <div key={`${i}-${m.role}`} className={`pulse-excel-chat-msg pulse-excel-chat-msg--${m.role}`}>
              <span className="pulse-excel-chat-msg-label">{m.role === 'user' ? 'Вы' : 'ПУЛЬС'}</span>
              <div className="pulse-excel-chat-msg-body">{m.content}</div>
            </div>
          ))}
          {loading && (
            <AiWaitIndicator
              active
              compact
              className="pulse-excel-chat-wait"
              label="ПУЛЬС обрабатывает запрос по текущей выборке"
              typicalMinSec={8}
              typicalMaxSec={40}
              slowAfterSec={55}
            />
          )}
          <div ref={bottomRef} />
        </div>
        {err && <p className="err pulse-excel-chat-err">{err}</p>}
        <div className="pulse-excel-chat-input-row">
          <textarea
            className="field pulse-excel-chat-textarea"
            rows={2}
            placeholder="Запрос к выборке…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={loading || disabled}
          />
          <button
            type="button"
            className="btn primary pulse-excel-chat-send"
            disabled={loading || !input.trim() || disabled}
            onClick={() => void send()}
          >
            Спросить
          </button>
        </div>
      </div>
    </motion.section>
  );
}

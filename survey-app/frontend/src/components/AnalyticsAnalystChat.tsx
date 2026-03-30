import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { postAnalyticsChat } from '../api/client';
import type { AnalyticsChatMessage, AnalyticsFilter } from '../types';

type Props = {
  surveyId: number;
  /** Уже применённые условия (совпадают с графиками на странице). */
  filters: AnalyticsFilter[];
};

export default function AnalyticsAnalystChat({ surveyId, filters }: Props) {
  const [messages, setMessages] = useState<AnalyticsChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    setMessages([]);
    setErr(null);
    setInput('');
  }, [surveyId, filterKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextMsgs: AnalyticsChatMessage[] = [...messages, { role: 'user', content: text }];
    setInput('');
    setMessages(nextMsgs);
    setLoading(true);
    setErr(null);
    try {
      const res = await postAnalyticsChat(surveyId, { filters, messages: nextMsgs });
      setMessages([...nextMsgs, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [surveyId, filters, messages, input, loading]);

  return (
    <motion.section
      className="card analytics-analyst-chat glass-surface"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
      aria-label="Чат с аналитиком"
    >
      <h2 className="analytics-analyst-chat-title">Чат с аналитиком</h2>
      <p className="muted analytics-analyst-chat-lead">
        Вопросы по <strong>текущей выборке</strong> (после «Применить срез»). Ответ строится по цифрам, связям между
        вопросами и свободным ответам в этой подвыборке.
      </p>
      <div className="analytics-analyst-chat-log" role="log">
        {messages.length === 0 && !loading && (
          <p className="muted analytics-analyst-chat-placeholder">
            Например: «Какие шкалы просели относительно остальных?», «Что связано с низкой оценкой по вопросу N?»,
            «Сформулируй выводы для руководства».
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={`analytics-analyst-chat-msg analytics-analyst-chat-msg--${m.role}`}
          >
            <span className="analytics-analyst-chat-msg-label">{m.role === 'user' ? 'Вы' : 'Аналитик'}</span>
            <div className="analytics-analyst-chat-msg-body">{m.content}</div>
          </div>
        ))}
        {loading && (
          <p className="muted analytics-analyst-chat-typing" aria-live="polite">
            Аналитик пишет…
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      {err && <p className="err analytics-analyst-chat-err">{err}</p>}
      <div className="analytics-analyst-chat-input-row">
        <textarea
          className="field analytics-analyst-chat-textarea"
          rows={2}
          placeholder="Ваш вопрос по данным выборки…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={loading}
        />
        <button type="button" className="btn primary analytics-analyst-chat-send" disabled={loading || !input.trim()} onClick={() => void send()}>
          Отправить
        </button>
      </div>
    </motion.section>
  );
}

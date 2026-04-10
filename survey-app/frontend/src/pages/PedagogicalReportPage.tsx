import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPedagogicalSession, postPedagogicalNotify, savePedagogicalSession } from '../api/client';
import { detokenizePedagogicalText } from '../lib/pedagogicalDetokenize';
import type { PedagogicalAnalyticsState } from '../types';

export default function PedagogicalReportPage() {
  const { sessionId } = useParams();
  const id = sessionId ? Number(sessionId) : NaN;
  const [title, setTitle] = useState('');
  const [state, setState] = useState<PedagogicalAnalyticsState | null>(null);
  const [emails, setEmails] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef<PedagogicalAnalyticsState | null>(null);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id < 1) return;
    setErr(null);
    try {
      const s = await getPedagogicalSession(id);
      setTitle(s.title);
      setState(s.state);
      const bodyPlain =
        (s.state.llmLast?.replyPlain && s.state.llmLast.replyPlain.trim()) ||
        s.state.redactedSource ||
        '';
      setHtmlBody(bodyPlain ? `<p>${bodyPlain.replace(/\n/g, '</p><p>')}</p>` : '<p></p>');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка загрузки';
      if (/^not found$/i.test(msg.trim())) {
        setErr(
          'Сессия не найдена (удалена, другой пользователь или несовпадение входа и ключа API). Откройте список сессий или войдите заново.',
        );
      } else {
        setErr(msg);
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const map = state?.piiMap || {};
  const plainPreview = htmlBody
    ? detokenizePedagogicalText(htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), map)
    : '';

  const saveStateToServer = async (next: PedagogicalAnalyticsState) => {
    if (!Number.isFinite(id) || id < 1) return;
    setBusy(true);
    try {
      const saved = await savePedagogicalSession({
        id,
        title: title.trim() || 'Педагогическая аналитика',
        state: next,
      });
      setState(saved.state);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не сохранилось');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!Number.isFinite(id) || id < 1 || !state) return;
    if (!consent) {
      setErr('Нужно подтвердить согласие на отправку.');
      return;
    }
    const list = emails
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const textRaw = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const r = await postPedagogicalNotify(id, {
        consent: true,
        emails: list,
        maxWebhookUrl: state.notification.maxWebhookUrl || undefined,
        subject: `Педагогическая аналитика: ${title}`,
        html: htmlBody,
        text: textRaw,
        maxText: textRaw,
        detokenizeEmail: true,
        maxDetokenize: false,
      });
      const smtpHint =
        r.smtp_configured === false
          ? ' SMTP на функции не настроен (см. переменные SMTP_* и GET /api/ping).'
          : '';
      setInfo(
        `Почта: отправлено ${r.results.email.sent}, ошибок ${r.results.email.failed.length}.${smtpHint} Вебхук: ${
          r.results.max.ok ? 'ok' : r.results.max.detail || 'нет'
        }`,
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка отправки');
    } finally {
      setBusy(false);
    }
  };

  if (!Number.isFinite(id) || id < 1) {
    return <p className="muted">Некорректный id сессии.</p>;
  }

  if (err && !state) {
    return <p className="err">{err}</p>;
  }

  if (!state) {
    return <p className="muted">Загрузка…</p>;
  }

  return (
    <div className="card glass-surface pedagogical-report">
      <p className="muted">
        <Link to="/analytics/pedagogical">← К списку</Link>
      </p>
      <h2 className="admin-dash-title" style={{ fontSize: '1.35rem', marginTop: '0.5rem' }}>
        Отчёт и уведомления · {title}
      </h2>
      <p className="muted">
        Тело письма можно набрать с токенами — на сервере перед SMTP подстановка выполнится по таблице сессии. Вебхук
        по умолчанию получает тот же текст с токенами; чтобы уйти от ПДн во внешнюю систему, оставьте токены и не
        включайте расшифровку для Max. Почта: в консоли функции должны быть заданы переменные{' '}
        <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_FROM</code> (и при необходимости{' '}
        <code>SMTP_USER</code>, <code>SMTP_PASS</code>); проверка — <code>GET /api/ping</code> →{' '}
        <code>smtp_configured: true</code>.
      </p>
      {err && <p className="err">{err}</p>}
      {info && (
        <p className="muted" style={{ color: 'var(--ok, #2e7d32)' }}>
          {info}
        </p>
      )}

      <label className="field-label" htmlFor="ped-max-url">
        URL входящего вебхука (Max / др.)
      </label>
      <input
        id="ped-max-url"
        className="input"
        value={state.notification.maxWebhookUrl}
        onChange={(e) =>
          setState((p) =>
            p ? { ...p, notification: { ...p.notification, maxWebhookUrl: e.target.value } } : p,
          )
        }
        onBlur={(e) => {
          const s = stateRef.current;
          if (!s) return;
          const maxWebhookUrl = e.target.value.trim();
          void saveStateToServer({ ...s, notification: { ...s.notification, maxWebhookUrl } });
        }}
        placeholder="https://…"
      />

      <label className="field-label" htmlFor="ped-emails" style={{ marginTop: '1rem' }}>
        Email получателей (через запятую)
      </label>
      <input
        id="ped-emails"
        className="input"
        value={emails}
        onChange={(e) => setEmails(e.target.value)}
        placeholder="a@school.ru, b@school.ru"
      />

      <label className="field-label" htmlFor="ped-html" style={{ marginTop: '1rem' }}>
        HTML письма (можно с токенами)
      </label>
      <textarea
        id="ped-html"
        className="input pedagogical-plain-textarea"
        rows={14}
        value={htmlBody}
        onChange={(e) => setHtmlBody(e.target.value)}
      />

      {Object.keys(map).length > 0 && plainPreview ? (
        <div className="pedagogical-detoken-preview" style={{ marginTop: '0.75rem' }}>
          <span className="field-label">Как уйдёт в письме (после расшифровки на сервере)</span>
          <pre className="pedagogical-redacted-preview pedagogical-detoken-preview-inner">{plainPreview}</pre>
        </div>
      ) : null}

      <label className="pedagogical-consent" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Подтверждаю согласие на отправку уведомлений указанным адресам и вебхуку.</span>
      </label>

      <div className="pedagogical-progress-actions" style={{ marginTop: '1rem' }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void send()}>
          {busy ? '…' : 'Отправить'}
        </button>
      </div>

      <p className="muted" style={{ marginTop: '1rem' }}>
        <Link to={`/analytics/pedagogical/${id}/progress`}>Прогресс</Link> ·{' '}
        <Link to={`/analytics/pedagogical/${id}/review`}>Согласование</Link>
      </p>
    </div>
  );
}

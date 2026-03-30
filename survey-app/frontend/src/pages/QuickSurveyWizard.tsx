import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createSurvey, putSurveyInviteTemplate } from '../api/client';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linesToParagraphs(text: string): string {
  const blocks = String(text || '')
    .split(/\n{2,}/g)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '<p style="margin:0;">Здравствуйте!</p>';
  return blocks
    .map((b) => {
      const one = b.replace(/\n+/g, '<br/>');
      return `<p style="margin:0 0 12px;">${escapeHtml(one).replace(/&lt;br\/&gt;/g, '<br/>')}</p>`;
    })
    .join('\n');
}

function buildInviteHtml({ title, letterText }: { title: string; letterText: string }): string {
  const safeTitle = escapeHtml(title || 'Опрос');
  const body = linesToParagraphs(letterText);
  return `
<div style="font-family: Arial, sans-serif; line-height: 1.45; color:#111827;">
  ${body}
  <div style="margin:16px 0 10px;">
    <a href="{{link}}" style="display:inline-block; padding:12px 16px; border-radius:12px; background:#111827; color:#ffffff; text-decoration:none; font-weight:700;">
      Пройти опрос
    </a>
  </div>
  <div style="font-size:12px; color:#6b7280;">
    Если кнопка не работает, откройте ссылку: <a href="{{link}}">{{link}}</a><br/>
    Опрос: <b>${safeTitle}</b>
  </div>
</div>
`.trim();
}

function normalizeAccessLink(raw: string): string {
  const s = String(raw || '').trim();
  // разрешим только URL-safe токен
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export default function QuickSurveyWizard() {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [accessLink, setAccessLink] = useState('');
  const [letterText, setLetterText] = useState('Здравствуйте!\n\nПриглашаем пройти короткий опрос. Это займёт 1–2 минуты.');
  const [subject, setSubject] = useState('Приглашение: {{title}}');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const normLink = useMemo(() => normalizeAccessLink(accessLink), [accessLink]);
  const html = useMemo(() => buildInviteHtml({ title, letterText }), [title, letterText]);

  async function create() {
    setSaving(true);
    setErr(null);
    try {
      const s = await createSurvey({
        title,
        description: '',
        status: 'draft',
        access_link: normLink || undefined,
        questions: [],
      });
      await putSurveyInviteTemplate(s.id, { subject, html });
      nav(`/surveys/${s.id}/edit`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
          <div>
            <p className="muted" style={{ margin: 0 }}>
              Быстрое создание
            </p>
            <h1 style={{ margin: '0.25rem 0 0.1rem' }}>Модуль создания опросника</h1>
            <p className="muted" style={{ margin: 0 }}>
              Вы вводите только заголовок, ссылку и текст письма — HTML сформируется автоматически.
            </p>
          </div>
          <Link to="/" className="btn">
            К списку
          </Link>
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      <div className="card">
        <label>
          Заголовок опроса
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Обратная связь" />
        </label>
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Ссылка (access_link)
          <input
            value={accessLink}
            onChange={(e) => setAccessLink(e.target.value)}
            placeholder="Например: april-event-2026"
          />
        </label>
        {accessLink && normLink !== accessLink.trim() && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Нормализовано: <code>{normLink || '—'}</code>
          </p>
        )}
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Тема письма
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Приглашение: {{title}}" />
        </label>
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Текст письма (без HTML)
          <textarea
            className="field field--desc"
            value={letterText}
            onChange={(e) => setLetterText(e.target.value)}
            rows={6}
            placeholder="Напишите обычный текст. Пустые строки будут абзацами."
          />
        </label>
        <div className="row" style={{ marginTop: '0.9rem', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" disabled={saving} onClick={() => void create()}>
            {saving ? 'Создаю…' : 'Создать опрос и шаблон письма'}
          </button>
          <span className="muted">
            После создания откроется редактирование — там можно добавить вопросы, список email и отправить письма.
          </span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Предпросмотр HTML</h2>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          В письме ссылка подставится автоматически (переменная <code>{'{{link}}'}</code>).
        </p>
        <div className="card card-nested" style={{ overflow: 'auto' }}>
          <pre className="insights-pre" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {html}
          </pre>
        </div>
      </div>
    </div>
  );
}


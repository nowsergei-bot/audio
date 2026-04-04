import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createSurvey,
  directorSurveyUrl,
  getSurvey,
  getSurveyExportRows,
  getSurveyInvites,
  getSurveyInviteTemplate,
  putSurveyInviteTemplate,
  remindSurveyInvites,
  saveSurveyInvites,
  sendSurveyInvites,
  updateSurvey,
} from '../api/client';
import { downloadSurveyResponsesXlsx } from '../lib/exportResponsesXlsx';
import TemplateGallery from '../components/TemplateGallery';
import { getSurveyTemplate, saveCustomTemplate } from '../data/surveyTemplates';
import { QUESTION_TYPE_LABEL_RU } from '../lib/labels';
import { adminStaggerItem } from '../motion/adminMotion';
import type { QuestionType, Survey, SurveyStatus } from '../types';

type DraftQuestion = {
  tempKey: string;
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
  required: boolean;
};

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
}

function AutoGrowTextarea({
  className,
  value,
  onChange,
  onInput,
  placeholder,
}: {
  className?: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onInput?: React.FormEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
}) {
  return (
    <textarea
      className={className}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      ref={(el) => autosize(el)}
      onInput={(e) => {
        autosize(e.currentTarget);
        onInput?.(e);
      }}
    />
  );
}

function defaultOptions(type: QuestionType): unknown {
  switch (type) {
    case 'radio':
    case 'checkbox':
      return ['Вариант 1', 'Вариант 2'];
    case 'scale':
      return { min: 1, max: 10 };
    case 'rating':
      return { min: 1, max: 5 };
    case 'text':
      return { maxLength: 2000 };
    case 'date':
      return {};
    default:
      return [];
  }
}

function toDraft(q: {
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
  required?: boolean;
}): DraftQuestion {
  return {
    tempKey: crypto.randomUUID(),
    text: q.text,
    type: q.type,
    options: q.options,
    sort_order: q.sort_order,
    required: q.required !== false,
  };
}

export default function SurveyBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const surveyId = id ? Number(id) : NaN;
  const isEdit = Number.isFinite(surveyId);
  const templateId = searchParams.get('template');
  const asTemplate = searchParams.get('asTemplate') === '1' || searchParams.get('as_template') === '1';
  const templateAppliedRef = useRef<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<SurveyStatus>('draft');
  const [accessLink, setAccessLink] = useState('');
  const [directorToken, setDirectorToken] = useState<string | null>(null);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [photos, setPhotos] = useState<{ src: string; name?: string }[]>([]);
  const [inviteText, setInviteText] = useState('');
  const [invites, setInvites] = useState<{ email: string; status: string; last_error?: string | null }[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesSaving, setInvitesSaving] = useState(false);
  const [invitesSending, setInvitesSending] = useState(false);
  const [invitesReminding, setInvitesReminding] = useState(false);
  const [inviteSubject, setInviteSubject] = useState('');
  const [inviteHtml, setInviteHtml] = useState('');
  const [inviteTplSaving, setInviteTplSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tplEmoji, setTplEmoji] = useState('🧩');
  const [tplCategory, setTplCategory] = useState('Пользовательские');

  useEffect(() => {
    if (isEdit) return;
    const tid = searchParams.get('template');
    if (tid && !getSurveyTemplate(tid)) {
      navigate('/surveys/new', { replace: true });
    }
  }, [isEdit, searchParams, navigate]);

  useEffect(() => {
    if (isEdit) return;
    if (!templateId) {
      templateAppliedRef.current = null;
      return;
    }
    const t = getSurveyTemplate(templateId);
    if (!t) return;
    if (templateAppliedRef.current === templateId) return;
    templateAppliedRef.current = templateId;
    setTitle(t.title);
    setDescription(t.description);
    setQuestions(
      t.questions.map((q, i) =>
        toDraft({
          text: q.text,
          type: q.type,
          options: q.options,
          sort_order: i,
          required: q.required,
        })
      )
    );
  }, [isEdit, templateId]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const s = await getSurvey(surveyId);
        if (cancelled) return;
        setTitle(s.title);
        setDescription(s.description);
        setStatus(s.status);
        setAccessLink(s.access_link);
        setDirectorToken(s.director_token != null && s.director_token !== '' ? s.director_token : null);
        setQuestions((s.questions || []).map((q) => toDraft(q)));
        setPhotos(s.media?.photos || []);
        setInvitesLoading(true);
        try {
          const list = await getSurveyInvites(surveyId);
          if (!cancelled) {
            setInvites(list.map((r) => ({ email: r.email, status: r.status, last_error: r.last_error })));
            setInviteText(list.map((r) => r.email).join('\n'));
          }
          const tpl = await getSurveyInviteTemplate(surveyId);
          if (!cancelled) {
            setInviteSubject(tpl.subject || '');
            setInviteHtml(tpl.html || '');
          }
        } finally {
          if (!cancelled) setInvitesLoading(false);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, surveyId]);

  const payloadQuestions = useMemo(
    () =>
      questions.map((q, i) => ({
        text: q.text,
        type: q.type,
        options: q.options,
        sort_order: Number.isFinite(q.sort_order) ? q.sort_order : i,
        required: q.required !== false,
      })),
    [questions]
  );

  async function exportExcel() {
    if (!isEdit) return;
    setExporting(true);
    setErr(null);
    try {
      const data = await getSurveyExportRows(surveyId);
      const safeTitle = (title || `opros-${surveyId}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
      downloadSurveyResponsesXlsx(data, `${safeTitle}-otvety.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось выгрузить Excel');
    } finally {
      setExporting(false);
    }
  }

  async function fileToResizedDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const maxW = 1600;
    const maxH = 900;
    const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas не поддерживается');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    bitmap.close?.();
    return dataUrl;
  }

  async function addPhotosFromFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSaving(true);
    setErr(null);
    try {
      const picked = Array.from(files).slice(0, 8);
      const mapped: { src: string; name?: string }[] = [];
      for (const f of picked) {
        if (!f.type.startsWith('image/')) continue;
        const src = await fileToResizedDataUrl(f);
        mapped.push({ src, name: f.name });
      }
      setPhotos((prev) => [...mapped, ...prev].slice(0, 12));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось обработать фото');
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (asTemplate && !isEdit) {
      setSaving(true);
      setErr(null);
      try {
        saveCustomTemplate({
          emoji: tplEmoji || '🧩',
          category: tplCategory || 'Пользовательские',
          title,
          description,
          questions: payloadQuestions.map((q) => ({ text: q.text, type: q.type, options: q.options, required: q.required })),
        });
        setSearchParams({});
        navigate('/surveys/new', { replace: true });
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Ошибка сохранения шаблона');
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body = {
        title,
        description,
        status,
        access_link: accessLink || undefined,
        questions: payloadQuestions,
        media: { photos },
      };
      let s: Survey;
      if (isEdit) {
        s = await updateSurvey(surveyId, body);
      } else {
        s = await createSurvey(body);
        if (inviteText.trim()) {
          try {
            await saveSurveyInvites(s.id, inviteText);
          } catch (e) {
            // Опрос создан — но список приглашений мог не сохраниться. Покажем ошибку, но не ломаем навигацию.
            setErr(e instanceof Error ? e.message : 'Не удалось сохранить список email');
          }
        }
      }
      setDirectorToken(s.director_token != null && s.director_token !== '' ? s.director_token : null);
      navigate(`/surveys/${s.id}/edit`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function saveInvites() {
    if (!isEdit) return;
    setInvitesSaving(true);
    setErr(null);
    try {
      await saveSurveyInvites(surveyId, inviteText);
      const list = await getSurveyInvites(surveyId);
      setInvites(list.map((r) => ({ email: r.email, status: r.status, last_error: r.last_error })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить список email');
    } finally {
      setInvitesSaving(false);
    }
  }

  async function sendInvites() {
    if (!isEdit) return;
    setInvitesSending(true);
    setErr(null);
    try {
      await saveSurveyInvites(surveyId, inviteText);
      await sendSurveyInvites(surveyId, { limit: 80 });
      const list = await getSurveyInvites(surveyId);
      setInvites(list.map((r) => ({ email: r.email, status: r.status, last_error: r.last_error })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить письма');
    } finally {
      setInvitesSending(false);
    }
  }

  async function remindInvites() {
    if (!isEdit) return;
    setInvitesReminding(true);
    setErr(null);
    try {
      await saveSurveyInvites(surveyId, inviteText);
      await putSurveyInviteTemplate(surveyId, { subject: inviteSubject, html: inviteHtml });
      await remindSurveyInvites(surveyId, { limit: 80, min_hours_between: 24 });
      const list = await getSurveyInvites(surveyId);
      setInvites(list.map((r) => ({ email: r.email, status: r.status, last_error: r.last_error })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить напоминания');
    } finally {
      setInvitesReminding(false);
    }
  }

  async function saveInviteTemplate() {
    if (!isEdit) return;
    setInviteTplSaving(true);
    setErr(null);
    try {
      await putSurveyInviteTemplate(surveyId, { subject: inviteSubject, html: inviteHtml });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить шаблон письма');
    } finally {
      setInviteTplSaving(false);
    }
  }

  function addQuestion(type: QuestionType) {
    setQuestions((prev) => [
      ...prev,
      {
        tempKey: crypto.randomUUID(),
        text: '',
        type,
        options: defaultOptions(type),
        sort_order: prev.length,
        required: true,
      },
    ]);
  }

  function updateQ(tempKey: string, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.tempKey === tempKey ? { ...q, ...patch } : q)));
  }

  function removeQ(tempKey: string) {
    setQuestions((prev) => prev.filter((q) => q.tempKey !== tempKey));
  }

  function moveQuestion(from: number, to: number) {
    setQuestions((prev) => {
      if (from === to) return prev;
      if (from < 0 || to < 0) return prev;
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((q, i) => ({ ...q, sort_order: i }));
    });
  }

  function optionsString(q: DraftQuestion): string {
    if (q.type !== 'radio' && q.type !== 'checkbox') return '';
    const o = q.options;
    if (Array.isArray(o)) return o.map(String).join('\n');
    return '';
  }

  function setOptionsFromString(q: DraftQuestion, raw: string) {
    const lines = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    updateQ(q.tempKey, { options: lines });
  }

  function hasOtherOpt(q: DraftQuestion): boolean {
    return (q.type === 'radio' || q.type === 'checkbox') && Array.isArray(q.options) && q.options.map(String).includes('Другое');
  }

  function toggleOtherOpt(q: DraftQuestion, enabled: boolean) {
    if (q.type !== 'radio' && q.type !== 'checkbox') return;
    const base = Array.isArray(q.options) ? q.options.map(String).filter(Boolean) : [];
    const withoutOther = base.filter((x) => x !== 'Другое');
    const next = enabled ? [...withoutOther, 'Другое'] : withoutOther;
    updateQ(q.tempKey, { options: next });
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (!isEdit && !templateId) {
    return (
      <TemplateGallery
        onPickTemplate={(tid) => setSearchParams({ template: tid })}
        onCreateTemplate={() => setSearchParams({ template: 'blank', asTemplate: '1' })}
      />
    );
  }

  return (
    <div className="page admin-builder-page">
      <div className="card admin-builder-head">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ margin: 0 }}>{isEdit ? `Опрос #${surveyId}` : 'Новый опрос'}</h1>
            {!isEdit && (
              <p className="muted admin-builder-sub">Заполните поля и сохраните — ссылку для респондентов получите после первого сохранения.</p>
            )}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            {!isEdit && (
              <Link to="/surveys/new" className="btn">
                ← Шаблоны
              </Link>
            )}
            <Link to="/" className="btn">
              К списку
            </Link>
          </div>
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      <div className="card">
        <label>
          Заголовок
          <AutoGrowTextarea
            className="field field--title"
            placeholder="Например: Обратная связь после мероприятия"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Описание
          <AutoGrowTextarea
            className="field field--desc"
            placeholder="Коротко: зачем опрос, сколько времени займёт, что будет с результатами…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <label>
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value as SurveyStatus)}>
              <option value="draft">Черновик</option>
              <option value="published">Опубликован</option>
              <option value="closed">Закрыт</option>
            </select>
          </label>
          {isEdit && (
            <label style={{ flex: '1 1 280px' }}>
              Публичный токен (access_link)
              <input value={accessLink} onChange={(e) => setAccessLink(e.target.value)} />
            </label>
          )}
        </div>
        <p className="muted">
          Опрос принимает ответы только в статусе «Опубликован». Ссылка для респондентов:{' '}
          {accessLink ? (
            <a href={`/s/${accessLink}`} target="_blank" rel="noreferrer">
              /s/{accessLink}
            </a>
          ) : (
            'сохраните опрос, чтобы увидеть токен'
          )}
        </p>
        {isEdit && directorToken && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Сводка для руководителя (без входа в админку):{' '}
            <a href={directorSurveyUrl(directorToken)} target="_blank" rel="noreferrer">
              открыть
            </a>
            {' · '}
            <button
              type="button"
              className="muted"
              style={{
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
                font: 'inherit',
                color: 'inherit',
              }}
              onClick={() => void navigator.clipboard.writeText(directorSurveyUrl(directorToken))}
            >
              скопировать ссылку
            </button>
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Фото мероприятия</h2>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Эти фото будут показываться слайдшоу во время заполнения публичной формы.
        </p>
        <div className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          <label className="btn">
            Добавить фото…
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addPhotosFromFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <span className="muted">Добавлено: {photos.length}</span>
        </div>
        {photos.length > 0 && (
          <div
            className="row"
            style={{
              marginTop: '0.75rem',
              flexWrap: 'wrap',
              gap: '0.6rem',
            }}
          >
            {photos.map((p, i) => (
              <div key={`${p.name || 'photo'}-${i}`} style={{ width: 140 }}>
                <img
                  src={p.src}
                  alt={p.name || ''}
                  style={{
                    width: '100%',
                    height: 90,
                    objectFit: 'cover',
                    borderRadius: 12,
                    border: '1px solid rgba(17,24,39,0.10)',
                  }}
                />
                <button
                  type="button"
                  className="btn danger"
                  style={{ marginTop: '0.35rem', width: '100%' }}
                  onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Приглашения по email</h2>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Добавьте список адресов (по одному в строке). {isEdit ? 'Кнопка «Отправить» пришлёт ссылку на публичную форму.' : 'После первого сохранения опроса список будет записан.'}
        </p>
        <div className="row" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 360px' }}>
            Тема письма
            <input value={inviteSubject} onChange={(e) => setInviteSubject(e.target.value)} placeholder="Приглашение: {{title}}" />
          </label>
          {isEdit && (
            <button type="button" className="btn" disabled={inviteTplSaving} onClick={saveInviteTemplate}>
              {inviteTplSaving ? 'Сохраняю…' : 'Сохранить шаблон'}
            </button>
          )}
        </div>
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          HTML письма (можно использовать переменные <code>{'{{link}}'}</code> и <code>{'{{title}}'}</code>)
          <AutoGrowTextarea
            className="field field--options"
            placeholder={
              `<div style="font-family: Arial, sans-serif; line-height: 1.45;">\n` +
              `  <p>Здравствуйте!</p>\n` +
              `  <p>Пройдите опрос: <b>{{title}}</b></p>\n` +
              `  <p><a href="{{link}}">{{link}}</a></p>\n` +
              `</div>`
            }
            value={inviteHtml}
            onChange={(e) => setInviteHtml(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginTop: '0.6rem' }}>
          Список email
          <AutoGrowTextarea
            className="field field--options"
            placeholder={'guest1@corp.ru\nguest2@corp.ru'}
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
        </label>
        {isEdit ? (
          <div className="row" style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn"
              disabled={invitesLoading || invitesSaving || invitesSending || invitesReminding || inviteTplSaving}
              onClick={saveInvites}
            >
              {invitesSaving ? 'Сохраняю…' : 'Сохранить список'}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={invitesLoading || invitesSaving || invitesSending || invitesReminding || inviteTplSaving}
              onClick={sendInvites}
            >
              {invitesSending ? 'Отправляю…' : 'Отправить приглашения'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={invitesLoading || invitesSaving || invitesSending || invitesReminding || inviteTplSaving}
              onClick={remindInvites}
            >
              {invitesReminding ? 'Напоминаю…' : 'Отправить напоминания'}
            </button>
            <span className="muted">
              Всего: {invites.length} · отправлено: {invites.filter((x) => x.status === 'sent').length} · ответили:{' '}
              {invites.filter((x) => x.status === 'responded').length} · ошибки: {invites.filter((x) => x.status === 'error').length}
            </span>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Чтобы отправить письма, сначала сохраните опрос — затем откроется режим редактирования с кнопкой «Отправить приглашения».
          </p>
        )}
        {isEdit && invites.length > 0 && (
          <div style={{ marginTop: '0.9rem' }}>
            <p className="muted" style={{ margin: 0 }}>
              Статусы (детально):
            </p>
            <div className="card card-nested" style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: '0.35rem 0.75rem' }}>
                {invites.map((r) => (
                  <div key={r.email} style={{ display: 'contents' }}>
                    <div style={{ fontWeight: 700 }}>{r.email}</div>
                    <div className="muted">
                      {r.status}
                      {r.status === 'error' && r.last_error ? ` — ${String(r.last_error).slice(0, 140)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Ошибки по конкретным адресам будут видны здесь после обновления списка (кнопка «Сохранить список» или отправки).
              </p>
            </div>
          </div>
        )}
      </div>

      {asTemplate && !isEdit && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Шаблон</h2>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Этот режим сохраняет набор вопросов как шаблон в браузере (для этой учётной записи/устройства).
          </p>
          <div className="row" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ flex: '0 0 160px' }}>
              Emoji
              <input value={tplEmoji} onChange={(e) => setTplEmoji(e.target.value)} />
            </label>
            <label style={{ flex: '1 1 280px' }}>
              Категория
              <input value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Вопросы</h2>
        <div className="row" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.4rem' }}>
          <span className="muted">Добавить:</span>
          {(
            [
              ['radio', 'Один вариант'],
              ['checkbox', 'Несколько'],
              ['scale', 'Шкала'],
              ['rating', 'Рейтинг'],
              ['text', 'Текст'],
              ['date', 'Дата'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" className="btn" onClick={() => addQuestion(t)}>
              {label}
            </button>
          ))}
        </div>

        {questions.map((q, idx) => (
          <motion.div
            key={q.tempKey}
            className="card card-nested admin-builder-q"
            variants={adminStaggerItem}
            initial="hidden"
            animate="show"
            layout
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                #{idx + 1} — {QUESTION_TYPE_LABEL_RU[q.type]}
              </strong>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={idx === 0}
                  onClick={() => moveQuestion(idx, idx - 1)}
                  title="Поднять выше"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={idx === questions.length - 1}
                  onClick={() => moveQuestion(idx, idx + 1)}
                  title="Опустить ниже"
                >
                  ↓
                </button>
                <button type="button" className="btn danger" onClick={() => removeQ(q.tempKey)}>
                  Удалить
                </button>
              </div>
            </div>
            <label style={{ display: 'block', marginTop: '0.5rem' }}>
              Текст вопроса
              <AutoGrowTextarea
                className="field field--qtext"
                placeholder="Введите формулировку вопроса…"
                value={q.text}
                onChange={(e) => updateQ(q.tempKey, { text: e.target.value })}
              />
            </label>
            <div className="admin-required-toggle-row">
              <span className="muted">Ответ:</span>
              <div className="admin-required-toggle" role="group" aria-label={`Режим ответа для вопроса ${idx + 1}`}>
                <button
                  type="button"
                  className={`btn admin-required-btn${q.required ? ' is-active' : ''}`}
                  onClick={() => updateQ(q.tempKey, { required: true })}
                >
                  Обязательный
                </button>
                <button
                  type="button"
                  className={`btn admin-required-btn${!q.required ? ' is-active' : ''}`}
                  onClick={() => updateQ(q.tempKey, { required: false })}
                >
                  Необязательный
                </button>
              </div>
            </div>
            {(q.type === 'radio' || q.type === 'checkbox') && (
              <label style={{ display: 'block', marginTop: '0.5rem' }}>
                Варианты (по одному на строку)
                <AutoGrowTextarea
                  className="field field--options"
                  value={optionsString(q)}
                  onChange={(e) => setOptionsFromString(q, e.target.value)}
                />
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={hasOtherOpt(q)}
                      onChange={(e) => toggleOtherOpt(q, e.target.checked)}
                      style={{ width: 18, height: 18 }}
                    />
                    Добавить вариант «Другое» (с полем ввода)
                  </label>
                </div>
              </label>
            )}
            {(q.type === 'scale' || q.type === 'rating') && (
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <label>
                  Минимум
                  <input
                    type="number"
                    value={Number((q.options as { min?: number }).min ?? 1)}
                    onChange={(e) =>
                      updateQ(q.tempKey, {
                        options: {
                          ...(typeof q.options === 'object' && q.options ? q.options : {}),
                          min: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Максимум
                  <input
                    type="number"
                    value={Number((q.options as { max?: number }).max ?? (q.type === 'rating' ? 5 : 10))}
                    onChange={(e) =>
                      updateQ(q.tempKey, {
                        options: {
                          ...(typeof q.options === 'object' && q.options ? q.options : {}),
                          max: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
            {q.type === 'text' && (
              <label style={{ display: 'block', marginTop: '0.5rem' }}>
                Макс. длина текста
                <input
                  type="number"
                  value={Number((q.options as { maxLength?: number }).maxLength ?? 2000)}
                  onChange={(e) =>
                    updateQ(q.tempKey, {
                      options: { maxLength: Number(e.target.value) },
                    })
                  }
                />
              </label>
            )}
          </motion.div>
        ))}
      </div>

      <div className="row">
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Сохранение…' : asTemplate && !isEdit ? 'Сохранить шаблон' : 'Сохранить'}
        </button>
        {isEdit && (
          <>
            <button type="button" className="btn" disabled={exporting} onClick={() => void exportExcel()}>
              {exporting ? 'Выгрузка…' : 'Скачать ответы (Excel)'}
            </button>
            <Link className="btn" to={`/surveys/${surveyId}/results`}>
              Результаты
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

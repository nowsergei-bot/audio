import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createSurvey, getSurvey, getSurveyExportRows, updateSurvey } from '../api/client';
import { downloadSurveyResponsesXlsx } from '../lib/exportResponsesXlsx';
import TemplateGallery from '../components/TemplateGallery';
import { getSurveyTemplate } from '../data/surveyTemplates';
import { QUESTION_TYPE_LABEL_RU } from '../lib/labels';
import { adminStaggerItem } from '../motion/adminMotion';
import type { QuestionType, Survey, SurveyStatus } from '../types';

type DraftQuestion = {
  tempKey: string;
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
};

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
    default:
      return [];
  }
}

function toDraft(q: {
  text: string;
  type: QuestionType;
  options: unknown;
  sort_order: number;
}): DraftQuestion {
  return {
    tempKey: crypto.randomUUID(),
    text: q.text,
    type: q.type,
    options: q.options,
    sort_order: q.sort_order,
  };
}

export default function SurveyBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const surveyId = id ? Number(id) : NaN;
  const isEdit = Number.isFinite(surveyId);
  const templateId = searchParams.get('template');
  const templateAppliedRef = useRef<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<SurveyStatus>('draft');
  const [accessLink, setAccessLink] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        setQuestions((s.questions || []).map((q) => toDraft(q)));
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

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body = {
        title,
        description,
        status,
        access_link: accessLink || undefined,
        questions: payloadQuestions,
      };
      let s: Survey;
      if (isEdit) {
        s = await updateSurvey(surveyId, body);
      } else {
        s = await createSurvey(body);
      }
      navigate(`/surveys/${s.id}/edit`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
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
      },
    ]);
  }

  function updateQ(tempKey: string, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.tempKey === tempKey ? { ...q, ...patch } : q)));
  }

  function removeQ(tempKey: string) {
    setQuestions((prev) => prev.filter((q) => q.tempKey !== tempKey));
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

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (!isEdit && !templateId) {
    return <TemplateGallery onPickTemplate={(tid) => setSearchParams({ template: tid })} />;
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Описание
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
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
      </div>

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
              <button type="button" className="btn danger" onClick={() => removeQ(q.tempKey)}>
                Удалить
              </button>
            </div>
            <label style={{ display: 'block', marginTop: '0.5rem' }}>
              Текст вопроса
              <input value={q.text} onChange={(e) => updateQ(q.tempKey, { text: e.target.value })} />
            </label>
            {(q.type === 'radio' || q.type === 'checkbox') && (
              <label style={{ display: 'block', marginTop: '0.5rem' }}>
                Варианты (по одному на строку)
                <textarea
                  value={optionsString(q)}
                  onChange={(e) => setOptionsFromString(q, e.target.value)}
                />
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
          {saving ? 'Сохранение…' : 'Сохранить'}
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

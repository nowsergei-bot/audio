import { motion } from 'framer-motion';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { postPublicPhotoWallUpload } from '../api/client';
import { fileToJpegPairForUpload } from '../lib/photoWallImage';

const BULK_MAX_FILES = 120;

export type PhotoWallUploadFormProps = {
  /** Ключ localStorage для respondent_id (отдельный для теста). */
  uidStorageKey: string;
  /** Заголовок карточки */
  heading: string;
  /** Короткая подпись под заголовком; null — не показывать */
  subline?: string | null;
  /** Компактный эскиз вместо крупного превью */
  compact?: boolean;
  /** Несколько файлов за раз (только для тестовой страницы). */
  allowMultiple?: boolean;
};

function getOrCreateUid(key: string): string {
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export default function PhotoWallUploadForm({
  uidStorageKey,
  heading,
  subline = null,
  compact = true,
  allowMultiple = false,
}: PhotoWallUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; fail: number } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.removeItem('photo_wall_done');
    } catch {
      /* ignore */
    }
  }, []);

  const previewSource = allowMultiple ? files[0] : file;
  useEffect(() => {
    if (!previewSource) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(previewSource);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [previewSource]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (allowMultiple) {
      if (files.length === 0) {
        setErr('Выберите хотя бы одно изображение');
        return;
      }
      setSubmitting(true);
      setErr(null);
      setBulkSummary(null);
      /* Тест: один respondent_id в БД = одна строка (ON CONFLICT). Для пакета — уникальный id на каждый файл. */
      const testParticipantBase = getOrCreateUid(uidStorageKey);
      let ok = 0;
      let fail = 0;
      const total = files.length;
      setBulkProgress({ done: 0, total });
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            const { full, thumb } = await fileToJpegPairForUpload(f);
            const respondentId = `${testParticipantBase}:${crypto.randomUUID()}`;
            await postPublicPhotoWallUpload(respondentId, full, thumb);
            ok++;
          } catch {
            fail++;
          }
          setBulkProgress({ done: i + 1, total });
        }
        setBulkSummary({ ok, fail });
        if (ok === 0) {
          setErr(fail ? `Не удалось отправить ни одного файла (${fail}).` : 'Ошибка отправки');
        } else {
          setJustSubmitted(true);
        }
      } finally {
        setBulkProgress(null);
        setSubmitting(false);
      }
      return;
    }
    if (!file) {
      setErr('Выберите фотографию');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const { full, thumb } = await fileToJpegPairForUpload(file);
      await postPublicPhotoWallUpload(getOrCreateUid(uidStorageKey), full, thumb);
      setJustSubmitted(true);
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setJustSubmitted(false);
    setFile(null);
    setFiles([]);
    setErr(null);
    setBulkSummary(null);
    setFormKey((k) => k + 1);
  }

  return (
    <motion.div
      className={`card public-form-glass-card photo-wall-upload-card${compact ? ' photo-wall-upload-card--compact' : ''}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h1 className="photo-wall-upload-title">{heading}</h1>
      {subline != null && subline !== '' && <p className="photo-wall-upload-lead">{subline}</p>}
      {justSubmitted ? (
        <div className="photo-wall-done-block">
          <p className="photo-wall-done-lead">
            {bulkSummary
              ? `Готово: отправлено ${bulkSummary.ok}${bulkSummary.fail ? `, не удалось ${bulkSummary.fail}` : ''}. Все на модерации.`
              : 'Отправлено на модерацию.'}
          </p>
          <div className="photo-wall-submit-row" style={{ marginTop: '0.75rem' }}>
            <motion.button
              type="button"
              className="btn primary"
              onClick={resetForm}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {allowMultiple ? 'Ещё пакет' : 'Другое фото'}
            </motion.button>
          </div>
        </div>
      ) : (
        <form key={formKey} onSubmit={(e) => void onSubmit(e)} className="photo-wall-upload-form">
          <div className="photo-wall-file-pick">
            <input
              ref={fileInputRef}
              id={`photo-wall-file-${formKey}`}
              type="file"
              accept="image/*"
              multiple={allowMultiple}
              className="photo-wall-file-input-sr"
              aria-label={allowMultiple ? 'Выбрать изображения' : 'Выбрать файл изображения'}
              onChange={(ev) => {
                setErr(null);
                const list = ev.target.files;
                if (!list?.length) {
                  setFile(null);
                  setFiles([]);
                  return;
                }
                if (allowMultiple) {
                  const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
                  if (picked.length === 0) {
                    setErr('Нужны файлы изображений');
                    setFiles([]);
                    return;
                  }
                  if (picked.length < list.length) {
                    setErr('Часть файлов пропущена (не изображения)');
                  } else {
                    setErr(null);
                  }
                  if (picked.length > BULK_MAX_FILES) {
                    setErr(`Не больше ${BULK_MAX_FILES} файлов за раз (взяты первые ${BULK_MAX_FILES})`);
                    setFiles(picked.slice(0, BULK_MAX_FILES));
                    return;
                  }
                  setFiles(picked);
                  return;
                }
                const f = list[0];
                if (!f.type.startsWith('image/')) {
                  setErr('Нужен файл изображения');
                  setFile(null);
                  return;
                }
                setFile(f);
              }}
            />
            <button
              type="button"
              className="photo-wall-file-pick-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="photo-wall-file-pick-btn-main">
                {allowMultiple ? 'Выбрать файлы' : 'Выбрать файл'}
              </span>
              <span className="photo-wall-file-pick-btn-sub">
                {allowMultiple ? `JPEG, PNG… · до ${BULK_MAX_FILES} шт.` : 'JPEG, PNG…'}
              </span>
            </button>
            <p className={`photo-wall-file-pick-name${file || files.length ? '' : ' photo-wall-file-pick-name--empty'}`}>
              {allowMultiple
                ? files.length
                  ? `Выбрано файлов: ${files.length}`
                  : 'Файлы не выбраны'
                : file
                  ? file.name
                  : 'Файл не выбран'}
            </p>
          </div>
          {preview && (
            <div className={`photo-wall-preview-wrap${compact ? ' photo-wall-preview-wrap--compact' : ''}`}>
              <img src={preview} alt="" className={`photo-wall-preview${compact ? ' photo-wall-preview--compact' : ''}`} />
              {allowMultiple && files.length > 1 && !submitting && (
                <p className="muted photo-wall-bulk-preview-note">+ ещё {files.length - 1}</p>
              )}
            </div>
          )}
          {err && <p className="err photo-wall-upload-err">{err}</p>}
          <div
            className="photo-wall-submit-row"
            aria-busy={submitting && Boolean(allowMultiple && bulkProgress) ? true : undefined}
          >
            <motion.button
              type="submit"
              className="btn primary"
              disabled={submitting || (allowMultiple ? files.length === 0 : !file)}
              aria-label={
                submitting && allowMultiple && bulkProgress
                  ? `Загрузка ${bulkProgress.done} из ${bulkProgress.total}`
                  : undefined
              }
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {submitting
                ? allowMultiple && bulkProgress
                  ? `Загрузка ${bulkProgress.done}/${bulkProgress.total}`
                  : 'Отправка…'
                : allowMultiple
                  ? 'Отправить все'
                  : 'Отправить'}
            </motion.button>
          </div>
        </form>
      )}
    </motion.div>
  );
}

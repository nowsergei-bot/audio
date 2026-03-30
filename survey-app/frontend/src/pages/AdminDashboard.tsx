import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteSurvey, listSurveys, publicFormUrl } from '../api/client';
import PulseLoadingDashboard from '../components/PulseLoadingDashboard';
import { adminStagger, adminStaggerItem } from '../motion/adminMotion';
import { SURVEY_STATUS_LABEL_RU } from '../lib/labels';
import type { Survey } from '../types';

function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminDashboard() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('admin_api_key') || '');
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('admin_api_key', apiKey);
  }, [apiKey]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await listSurveys();
      setSurveys(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 400);
    return () => clearTimeout(t);
  }, [apiKey, refresh]);

  async function onDelete(id: number) {
    if (!confirm('Удалить опрос и все ответы?')) return;
    try {
      await deleteSurvey(id);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка');
    }
  }

  function exportListCsv() {
    const lines = ['id,title,status,access_link'];
    for (const s of surveys) {
      const title = (s.title || '').replace(/"/g, '""');
      lines.push(`${s.id},"${title}",${s.status},${s.access_link || ''}`);
    }
    downloadCsv('puls-spisok-oprosov.csv', lines.join('\n'));
  }

  return (
    <div className="page admin-dash-page">
      <motion.header
        className="card admin-dash-hero glass-surface"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="admin-dash-hero-grid">
          <div>
            <p className="admin-dash-kicker">Пульс · панель</p>
            <h1 className="admin-dash-title">Опросы</h1>
            <p className="muted admin-dash-lead">
              Создавайте опросы из русскоязычных шаблонов или с нуля, публикуйте ссылку и смотрите результаты с графиками.
              Если есть готовые ответы из прошлых опросов — используйте раздел <strong>«Подгрузка данных из старых опросов»</strong> в шаблонах,
              чтобы импортировать Excel в существующий опрос и сразу получить аналитику.
            </p>
          </div>
          <motion.div
            className="admin-dash-hero-actions"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24, delay: 0.1 }}
          >
            <Link to="/surveys/new" className="btn primary admin-dash-cta">
              Новый опрос
            </Link>
            <p className="muted admin-dash-cta-hint">Сначала выберите шаблон или пустую форму</p>
          </motion.div>
        </div>
      </motion.header>

      <motion.section
        className="card admin-dash-settings glass-surface"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="admin-dash-h2">Доступ к API</h2>
        <p className="muted">
          Укажите тот же API-ключ, что задан в переменной <code>ADMIN_API_KEY</code> у Cloud Function.
        </p>
        <div className="row admin-dash-key-row">
          <label className="admin-dash-key-label">
            X-Api-Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="секретный ключ"
              autoComplete="off"
            />
          </label>
          <motion.button
            type="button"
            className="btn"
            onClick={() => void refresh()}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Обновить список
          </motion.button>
        </div>
        {err && <p className="err">{err}</p>}
      </motion.section>

      <motion.section
        className="card admin-dash-list-card glass-surface"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="admin-dash-list-head">
          <h2 className="admin-dash-h2 admin-dash-h2--flush">Ваши опросы</h2>
          {surveys.length > 0 && (
            <motion.button
              type="button"
              className="btn"
              onClick={() => exportListCsv()}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Экспорт списка в файл
            </motion.button>
          )}
        </div>
        {loading ? (
          <PulseLoadingDashboard />
        ) : err ? (
          <p className="muted">Список не загружен — проверьте ключ выше.</p>
        ) : surveys.length === 0 ? (
          <div className="admin-dash-empty">
            <p className="muted">Пока нет опросов. Нажмите «Новый опрос» и выберите шаблон.</p>
            <Link to="/surveys/new" className="btn primary">
              Создать первый опрос
            </Link>
          </div>
        ) : (
          <motion.ul
            className="admin-dash-survey-list"
            variants={adminStagger}
            initial="hidden"
            animate="show"
          >
            {surveys.map((s) => (
              <motion.li key={s.id} className="admin-dash-survey-row" variants={adminStaggerItem} layout>
                <div className="admin-dash-survey-main">
                  <strong className="admin-dash-survey-title">{s.title || 'Без названия'}</strong>
                  <span className="muted admin-dash-survey-id">id {s.id}</span>
                </div>
                <span className={`badge ${s.status}`}>{SURVEY_STATUS_LABEL_RU[s.status]}</span>
                <div className="admin-dash-survey-link">
                  {s.status === 'published' ? (
                    <a href={publicFormUrl(s.access_link)} target="_blank" rel="noreferrer">
                      Открыть форму
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
                <div className="admin-dash-survey-actions">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <Link className="btn" to={`/surveys/${s.id}/edit`}>
                      Редактировать
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <Link className="btn" to={`/surveys/${s.id}/results`}>
                      Результаты
                    </Link>
                  </motion.div>
                  <motion.button
                    type="button"
                    className="btn danger"
                    onClick={() => void onDelete(s.id)}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    Удалить
                  </motion.button>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </motion.section>
    </div>
  );
}

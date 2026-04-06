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

  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

  return (
    <div className="page admin-dash-page">
      <motion.header
        className="card admin-dash-hero glass-surface"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="admin-dash-kicker">Пульс · админка</p>
        <h1 className="admin-dash-title">Рабочий стол</h1>
        <p className="muted admin-dash-lead">
          Карточки ниже — быстрый вход в разделы. Полный список опросов — внизу; остальные пункты меню остаются в шапке.
        </p>
      </motion.header>

      <motion.section
        className="card admin-dash-tiles glass-surface"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="admin-dash-h2 admin-dash-h2--flush">Быстрый доступ</h2>
        <p className="muted admin-dash-tiles-intro">Основные сценарии — одним кликом.</p>
        <div className="admin-dash-tile-grid">
          <Link to="/surveys/new" className="admin-dash-tile admin-dash-tile--primary">
            <span className="admin-dash-tile-kicker">Опросы</span>
            <h3 className="admin-dash-tile-title">Новый опрос</h3>
            <p className="admin-dash-tile-desc">Шаблон на русском или пустая форма, затем публикация и ссылка для респондентов.</p>
            <span className="admin-dash-tile-action">Создать →</span>
          </Link>
          <div className="admin-dash-tile admin-dash-tile--static">
            <span className="admin-dash-tile-kicker">Отдельно от опросов</span>
            <h3 className="admin-dash-tile-title">Фотостена</h3>
            <p className="admin-dash-tile-desc">
              Живая стена: участники отправляют один кадр, модератор одобряет, экран показывает мозаику и сам подгружает новые
              снимки (как у цифровых стен на мероприятиях). Для проектора откройте коллаж в режиме киоска без шапки сайта.
            </p>
            <div className="admin-dash-tile-links admin-dash-tile-links--stack">
              <span className="admin-dash-tile-links-row">
                <Link to="/photo-wall/results">Модерация и превью коллажа</Link>
              </span>
              <span className="admin-dash-tile-links-row">
                <a href={`${origin}/photo-wall/display`} target="_blank" rel="noreferrer">
                  Экран коллажа
                </a>
                <span className="admin-dash-tile-links-sep" aria-hidden>
                  ·
                </span>
                <a href={`${origin}/photo-wall/display?kiosk=1`} target="_blank" rel="noreferrer">
                  Киоск
                </a>
                <span className="admin-dash-tile-links-sep" aria-hidden>
                  ·
                </span>
                <a href={`${origin}/photo-wall`} target="_blank" rel="noreferrer">
                  Загрузка
                </a>
                <span className="admin-dash-tile-links-sep" aria-hidden>
                  ·
                </span>
                <a href={`${origin}/photo-wall/test`} target="_blank" rel="noreferrer">
                  Тестовая загрузка
                </a>
              </span>
            </div>
          </div>
          <Link to="/analytics/excel" className="admin-dash-tile">
            <span className="admin-dash-tile-kicker">Аналитика</span>
            <h3 className="admin-dash-tile-title">Модуль аналитики</h3>
            <p className="admin-dash-tile-desc">
              Наблюдения из Excel и сводка по нескольким действующим опросам: фильтры по разделам, графики и выводы (в том числе
              с нейросетью при настроенном API).
            </p>
            <span className="admin-dash-tile-action">Открыть →</span>
          </Link>
          <Link to="/surveys/groups" className="admin-dash-tile">
            <span className="admin-dash-tile-kicker">Структура</span>
            <h3 className="admin-dash-tile-title">Разделы опросов</h3>
            <p className="admin-dash-tile-desc">
              Распределите опросы по группам (стажировки, школьное отделение, доп.образование и др.) — удобнее для методистов и
              фильтра в аналитике.
            </p>
            <span className="admin-dash-tile-action">Назначить разделы →</span>
          </Link>
          <Link to="/surveys/quick" className="admin-dash-tile">
            <span className="admin-dash-tile-kicker">Коммуникации</span>
            <h3 className="admin-dash-tile-title">Письмо для гостей</h3>
            <p className="admin-dash-tile-desc">Быстрый сценарий подготовки текста приглашения или объявления.</p>
            <span className="admin-dash-tile-action">Начать →</span>
          </Link>
        </div>
      </motion.section>

      <motion.section
        className="card admin-dash-settings glass-surface"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
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
        transition={{ duration: 0.45, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
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
                  <div className="admin-dash-survey-subrow">
                    <span className={`badge ${s.status}`}>{SURVEY_STATUS_LABEL_RU[s.status]}</span>
                    <span className="muted admin-dash-survey-id">id {s.id}</span>
                  </div>
                </div>
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

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSurveyGroups, listSurveys, updateSurvey } from '../api/client';
import PulseLoadingDashboard from '../components/PulseLoadingDashboard';
import { adminStagger, adminStaggerItem } from '../motion/adminMotion';
import { SURVEY_STATUS_LABEL_RU } from '../lib/labels';
import type { Survey, SurveyGroup } from '../types';

export default function SurveyGroupsAdminPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [groups, setGroups] = useState<SurveyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, g] = await Promise.all([listSurveys(), getSurveyGroups()]);
      setSurveys(s);
      setGroups(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function assignGroup(surveyId: number, survey_group_id: number | null) {
    setSavingId(surveyId);
    setErr(null);
    try {
      await updateSurvey(surveyId, { survey_group_id });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить раздел');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page admin-dash-page survey-groups-admin-page">
      <motion.header
        className="card admin-dash-hero glass-surface"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="admin-dash-kicker">Пульс · админка</p>
        <h1 className="admin-dash-title">Разделы опросов</h1>
        <p className="muted admin-dash-lead">
          Распределите опросы по группам для удобства методистов и фильтрации в модуле аналитики. Раздел можно также выбрать при
          создании и редактировании опроса.
        </p>
        <div className="survey-groups-admin-hero-actions">
          <Link to="/" className="btn">
            На рабочий стол
          </Link>
          <Link to="/analytics/surveys" className="btn primary">
            Модуль аналитики
          </Link>
        </div>
      </motion.header>

      <motion.section
        className="card glass-surface survey-groups-admin-reference"
        variants={adminStagger}
        initial="hidden"
        animate="show"
      >
        <h2 className="admin-dash-h2 admin-dash-h2--flush">Справочник разделов</h2>
        <p className="muted">Фиксированный набор групп (меняется только на стороне базы данных при необходимости).</p>
        <ul className="survey-groups-admin-ref-list">
          {groups.map((g) => (
            <motion.li key={g.id} variants={adminStaggerItem}>
              <strong>{g.name}</strong>
              <span className="muted"> — куратор: {g.curator_name || '—'}</span>
            </motion.li>
          ))}
        </ul>
      </motion.section>

      <motion.section
        className="card glass-surface survey-groups-admin-table-card"
        variants={adminStagger}
        initial="hidden"
        animate="show"
      >
        <div className="survey-groups-admin-table-head">
          <h2 className="admin-dash-h2 admin-dash-h2--flush">Назначить раздел опросу</h2>
          <motion.button type="button" className="btn" onClick={() => void refresh()} whileTap={{ scale: 0.97 }}>
            Обновить
          </motion.button>
        </div>
        {err && <p className="err">{err}</p>}
        {loading ? (
          <PulseLoadingDashboard />
        ) : surveys.length === 0 ? (
          <p className="muted">Нет опросов.</p>
        ) : (
          <div className="survey-groups-admin-table-wrap">
            <table className="survey-groups-admin-table">
              <thead>
                <tr>
                  <th>Опрос</th>
                  <th>Статус</th>
                  <th>Раздел</th>
                </tr>
              </thead>
              <tbody>
                {surveys.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="survey-groups-admin-title-cell">
                        <strong>{s.title || 'Без названия'}</strong>
                        <span className="muted">id {s.id}</span>
                      </div>
                      <Link to={`/surveys/${s.id}/edit`} className="survey-groups-admin-edit-link">
                        Редактировать опрос
                      </Link>
                    </td>
                    <td>
                      <span className={`badge ${s.status}`}>{SURVEY_STATUS_LABEL_RU[s.status] ?? s.status}</span>
                    </td>
                    <td>
                      <select
                        className="excel-analytics-select survey-groups-admin-select"
                        value={s.survey_group_id ?? ''}
                        disabled={savingId === s.id}
                        onChange={(e) => {
                          const v = e.target.value;
                          void assignGroup(s.id, v === '' ? null : Number(v));
                        }}
                        aria-label={`Раздел для опроса ${s.id}`}
                      >
                        <option value="">Без раздела</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                            {g.curator_name ? ` (${g.curator_name})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>
    </div>
  );
}

import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createSurveyGroup, getSurveyGroups, listSurveys, updateSurvey } from '../api/client';
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
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCurator, setNewGroupCurator] = useState('');
  const [newGroupSort, setNewGroupSort] = useState('');
  const [addGroupBusy, setAddGroupBusy] = useState(false);

  const suggestedSortOrder = useMemo(() => {
    if (!groups.length) return 1;
    return Math.max(...groups.map((g) => g.sort_order)) + 1;
  }, [groups]);

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

  async function addSurveyGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setErr('Введите название раздела.');
      return;
    }
    let sort_order: number | undefined;
    if (newGroupSort.trim() !== '') {
      const n = Number(newGroupSort);
      if (!Number.isFinite(n)) {
        setErr('Порядок сортировки — целое число.');
        return;
      }
      sort_order = n;
    } else {
      sort_order = suggestedSortOrder;
    }
    setAddGroupBusy(true);
    setErr(null);
    try {
      await createSurveyGroup({
        name,
        curator_name: newGroupCurator.trim() || undefined,
        sort_order,
      });
      setNewGroupName('');
      setNewGroupCurator('');
      setNewGroupSort('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать раздел');
    } finally {
      setAddGroupBusy(false);
    }
  }

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
        <p className="muted">
          Разделы используются в фильтре «Модуль аналитики» и при создании опроса. Добавление — только у администратора
          или при входе по API-ключу с главной.
        </p>
        <div className="survey-groups-admin-add-form">
          <div className="survey-groups-admin-add-row">
            <label className="excel-analytics-field survey-groups-admin-add-field">
              Название раздела
              <input
                className="excel-analytics-input"
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Например: Стажировки"
                maxLength={500}
                disabled={addGroupBusy}
              />
            </label>
            <label className="excel-analytics-field survey-groups-admin-add-field">
              Куратор (необязательно)
              <input
                className="excel-analytics-input"
                type="text"
                value={newGroupCurator}
                onChange={(e) => setNewGroupCurator(e.target.value)}
                placeholder="ФИО"
                maxLength={500}
                disabled={addGroupBusy}
              />
            </label>
            <label className="excel-analytics-field survey-groups-admin-add-field survey-groups-admin-add-field--sort">
              Порядок в списке
              <input
                className="excel-analytics-input"
                type="number"
                value={newGroupSort}
                onChange={(e) => setNewGroupSort(e.target.value)}
                placeholder={String(suggestedSortOrder)}
                disabled={addGroupBusy}
              />
            </label>
            <div className="survey-groups-admin-add-actions">
              <button
                type="button"
                className="btn primary"
                disabled={addGroupBusy}
                onClick={() => void addSurveyGroup()}
              >
                {addGroupBusy ? 'Сохранение…' : 'Добавить раздел'}
              </button>
            </div>
          </div>
          <p className="muted survey-groups-admin-add-hint">
            Пустой порядок — в конец списка (сейчас это {suggestedSortOrder}). Идентификатор в БД (slug) создаётся
            автоматически.
          </p>
        </div>
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

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  deletePedagogicalSession,
  listPedagogicalSessions,
  savePedagogicalSession,
} from '../api/client';
import { defaultPedagogicalState } from '../lib/pedagogicalDefaultState';
import type { PedagogicalSessionListItem } from '../types';

export default function PedagogicalHubPage() {
  const nav = useNavigate();
  const [list, setList] = useState<PedagogicalSessionListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const rows = await listPedagogicalSessions();
      setList(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const st = defaultPedagogicalState();
      st.step = 'draft';
      st.job = { status: 'idle', done: 0, total: 0, error: null };
      const s = await savePedagogicalSession({ title: 'Новая педагогическая аналитика', state: st });
      nav(`/analytics/pedagogical/${s.id}/progress`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать сессию');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Удалить черновик?')) return;
    try {
      await deletePedagogicalSession(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось удалить');
    }
  };

  return (
    <div className="card glass-surface pedagogical-hub">
      <h2 className="pedagogical-hub-title">Педагогическая аналитика</h2>
      <p className="muted pedagogical-hub-lead">
        На шаге фактов можно <strong>загрузить .xlsx</strong> (строка = педагог) или вставить текст, в т.ч. блок{' '}
        <strong>«Исходные факты»</strong> из «Наблюдения Excel». Сохраните сессию, затем{' '}
        <strong>«Запустить анализ ИИ»</strong> — псевдонимизация на сервере (по каждому педагогу отдельно при загрузке
        таблицы), далее согласование и отчёт.
      </p>
      <p className="muted pedagogical-hub-note">
        Подготовка таблицы и срезов — в{' '}
        <Link to="/analytics/excel">Наблюдения Excel</Link>; здесь — отдельный контур для текстов с ПДн и рассылки.
      </p>
      {err && <p className="err">{err}</p>}
      <div className="pedagogical-hub-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Создаём…' : 'Новая сессия'}
        </button>
        <button type="button" className="btn secondary" onClick={() => void refresh()}>
          Обновить список
        </button>
      </div>
      {list.length === 0 ? (
        <p className="muted">Пока нет сохранённых сессий.</p>
      ) : (
        <ul className="pedagogical-hub-list">
          {list.map((row) => (
            <li key={row.id} className="pedagogical-hub-row">
              <div>
                <Link to={`/analytics/pedagogical/${row.id}/progress`} className="pedagogical-hub-link">
                  {row.title}
                </Link>
                <span className="muted pedagogical-hub-meta">
                  {' '}
                  · шаг: {row.step || '—'} · {new Date(row.updated_at).toLocaleString('ru-RU')}
                </span>
              </div>
              <button type="button" className="btn btn-small danger-outline" onClick={() => void remove(row.id)}>
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

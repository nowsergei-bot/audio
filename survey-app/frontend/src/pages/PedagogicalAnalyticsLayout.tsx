import { NavLink, Outlet, useMatch } from 'react-router-dom';

export default function PedagogicalAnalyticsLayout() {
  const m = useMatch({ path: '/analytics/pedagogical/:sessionId/*', end: false });
  const sessionId = m?.params.sessionId;

  return (
    <div className="pedagogical-analytics-root">
      {sessionId ? (
        <div className="card glass-surface pedagogical-analytics-stepbar">
          <p className="muted pedagogical-analytics-stepbar-lead">
            Сессия #{sessionId} — как в модуле Excel: факты → авто-псевдонимизация → ИИ → согласование → отчёт и
            уведомления.
          </p>
          <nav className="pedagogical-analytics-stepbar-nav" aria-label="Шаги педагогической аналитики">
            <NavLink
              to={`/analytics/pedagogical/${sessionId}/excel?linkPedSession=${sessionId}`}
              className={({ isActive }) => `pedagogical-step-link${isActive ? ' pedagogical-step-link--active' : ''}`}
            >
              Графики, выборки и ИИ
            </NavLink>
            <NavLink
              to={`/analytics/pedagogical/${sessionId}/progress`}
              className={({ isActive }) => `pedagogical-step-link${isActive ? ' pedagogical-step-link--active' : ''}`}
            >
              Факты и ИИ
            </NavLink>
            <NavLink
              to={`/analytics/pedagogical/${sessionId}/review`}
              className={({ isActive }) => `pedagogical-step-link${isActive ? ' pedagogical-step-link--active' : ''}`}
            >
              Согласование
            </NavLink>
            <NavLink
              to={`/analytics/pedagogical/${sessionId}/report`}
              className={({ isActive }) => `pedagogical-step-link${isActive ? ' pedagogical-step-link--active' : ''}`}
            >
              Отчёт и уведомления
            </NavLink>
            <NavLink
              to={`/analytics/excel?linkPedSession=${sessionId}`}
              className={({ isActive }) => `pedagogical-step-link${isActive ? ' pedagogical-step-link--active' : ''}`}
            >
              Открыть Excel-модуль отдельно
            </NavLink>
          </nav>
        </div>
      ) : null}
      <Outlet />
    </div>
  );
}

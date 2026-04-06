import { NavLink, Outlet } from 'react-router-dom';

export default function AnalyticsModuleLayout() {
  return (
    <div className="page analytics-module-page">
      <div className="card glass-surface analytics-module-tabs">
        <p className="admin-dash-kicker">Пульс · модуль аналитики</p>
        <h1 className="admin-dash-title">Аналитика</h1>
        <p className="muted admin-dash-lead">
          Наблюдения из Excel и сводки по действующим опросам — один вход для методистов и администраторов.
        </p>
        <nav className="analytics-module-tab-row" aria-label="Подразделы аналитики">
          <NavLink
            to="/analytics/excel"
            className={({ isActive }) => `analytics-module-tab${isActive ? ' analytics-module-tab--active' : ''}`}
          >
            Наблюдения Excel
          </NavLink>
          <NavLink
            to="/analytics/surveys"
            className={({ isActive }) => `analytics-module-tab${isActive ? ' analytics-module-tab--active' : ''}`}
          >
            Сводка по опросам
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

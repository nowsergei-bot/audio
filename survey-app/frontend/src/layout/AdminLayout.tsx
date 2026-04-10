import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import PulseEkg from '../components/PulseEkg';
import { adminPageTransition } from '../motion/adminMotion';

export default function AdminLayout() {
  const location = useLocation();
  /** Полный путь + query: при смене опроса/шаблона дочерние экраны гарантированно перемонтируются */
  const layoutKey = `${location.pathname}${location.search}`;
  const resultsWideLayout = /\/results\/?$/.test(location.pathname);
  const analyticsExcelWideLayout = /\/analytics\/excel\/?$/.test(location.pathname);
  const photoWallWideLayout = /\/photo-wall\/results\/?$/.test(location.pathname);
  const pedagogicalWideLayout = /\/analytics\/pedagogical(\/|$)/.test(location.pathname);
  const wideDashboardLayout =
    resultsWideLayout || analyticsExcelWideLayout || photoWallWideLayout || pedagogicalWideLayout;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [layoutKey]);

  return (
    <div
      className={`app-admin${wideDashboardLayout ? ' app-admin--results-wide' : ''}${analyticsExcelWideLayout ? ' app-admin--excel-canvas' : ''}${photoWallWideLayout ? ' app-admin--photo-wall-wide' : ''}`}
    >
      <header className="admin-header glass-header">
        <div className="admin-header-inner">
          <div className="admin-header-brands">
            <NavLink to="/" className="admin-brand admin-brand-glass" end aria-label="Пульс">
              <img src="/branding/primakov-mark.png" alt="" className="admin-brand-mark" />
              <span className="admin-brand-pulse-label">Пульс</span>
              <PulseEkg size="brand" />
            </NavLink>
          </div>
          <nav className="admin-nav">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
            >
              Администратор
            </NavLink>
            <NavLink
              to="/surveys/new"
              className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
            >
              Новый опрос
            </NavLink>
            <NavLink
              to="/surveys/quick"
              className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
            >
              Написать письмо для гостей
            </NavLink>
            <NavLink
              to="/analytics/excel"
              className={() =>
                `admin-nav-link${location.pathname.startsWith('/analytics') ? ' admin-nav-link--active' : ''}`
              }
            >
              Модуль аналитики
            </NavLink>
            <NavLink
              to="/surveys/groups"
              className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
            >
              Разделы опросов
            </NavLink>
            <NavLink
              to="/photo-wall/results"
              className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
            >
              Фотостена
            </NavLink>
          </nav>
        </div>
      </header>
      <main
        className={`admin-main${wideDashboardLayout ? ' admin-main--results-wide' : ''}${analyticsExcelWideLayout ? ' admin-main--excel-canvas' : ''}${photoWallWideLayout ? ' admin-main--photo-wall-wide' : ''}`}
      >
        {/*
          Без AnimatePresence mode="wait": при переходах между маршрутами exit иногда не завершался,
          и новая страница не монтировалась до полной перезагрузки (F5).
        */}
        <motion.div
          key={layoutKey}
          className="admin-outlet-wrap"
          initial={adminPageTransition.initial}
          animate={adminPageTransition.animate}
          transition={adminPageTransition.transition}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

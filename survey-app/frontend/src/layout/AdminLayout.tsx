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

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [layoutKey]);

  return (
    <div className={`app-admin${resultsWideLayout ? ' app-admin--results-wide' : ''}`}>
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
          </nav>
        </div>
      </header>
      <main className={`admin-main${resultsWideLayout ? ' admin-main--results-wide' : ''}`}>
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

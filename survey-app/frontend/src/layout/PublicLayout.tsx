import { Link, Outlet, useLocation } from 'react-router-dom';
import PulseEkg from '../components/PulseEkg';

export default function PublicLayout() {
  const { pathname, search } = useLocation();
  const wideCollage = /^\/photo-wall\/display\/?$/.test(pathname);
  const photoWallKiosk = wideCollage && new URLSearchParams(search).get('kiosk') === '1';
  const directorView = /^\/director\//.test(pathname);

  return (
    <div
      className={`app-public${wideCollage ? ' app-public--wide-collage' : ''}${
        directorView ? ' app-public--director' : ''
      }${photoWallKiosk ? ' app-public--photo-wall-kiosk' : ''}`}
    >
      {!photoWallKiosk && (
      <header className="public-header glass-header-public">
        <div className="public-header-inner">
          <div className="public-wordmark" aria-label="Пульс">
            <img src="/branding/primakov-mark.png" alt="" className="public-brand-mark" />
            <span className="public-pulse-word">Пульс</span>
            <PulseEkg size="brand" className="public-pulse-ekg-svg" />
          </div>
          {!directorView && (
            <nav className="public-header-nav" aria-label="Разделы сайта">
              <Link to="/photo-wall" className="public-header-nav-primary">
                Фотостена
              </Link>
            </nav>
          )}
          <div className="public-header-ekg">
            <p className="public-tagline">{directorView ? 'Сводка для руководителя' : 'Пульс · опрос'}</p>
          </div>
        </div>
      </header>
      )}
      <main className={`public-main${wideCollage ? ' public-main--wide-collage' : ''}`}>
        <Outlet />
      </main>
      {!directorView && !photoWallKiosk && <footer className="public-footer muted">Московская область</footer>}
    </div>
  );
}

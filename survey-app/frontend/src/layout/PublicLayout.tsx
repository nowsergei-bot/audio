import { Outlet } from 'react-router-dom';
import PulseEkg from '../components/PulseEkg';

export default function PublicLayout() {
  return (
    <div className="app-public">
      <header className="public-header glass-header-public">
        <div className="public-header-inner">
          <div className="public-wordmark" aria-label="Гимназия им. Е.М. Примакова">
            <span className="public-wordmark-accent" />
            <div className="public-wordmark-text">
              <span className="public-wordmark-line1">Гимназия</span>
              <span className="public-wordmark-line2">им. Е.М. Примакова</span>
            </div>
          </div>
          <div className="public-header-ekg glass-surface-public">
            <PulseEkg size="brand" className="public-pulse-ekg-svg" />
            <p className="public-tagline muted">Пульс · опрос</p>
          </div>
        </div>
      </header>
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer muted">Московская область</footer>
    </div>
  );
}

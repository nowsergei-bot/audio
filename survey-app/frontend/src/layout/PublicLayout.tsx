import { Outlet } from 'react-router-dom';
import PulseEkg from '../components/PulseEkg';

export default function PublicLayout() {
  return (
    <div className="app-public">
      <header className="public-header glass-header-public">
        <div className="public-header-inner">
          <div className="public-wordmark" aria-label="Пульс">
            <img src="/branding/primakov-mark.png" alt="" className="public-brand-mark" />
            <span className="public-pulse-word">Пульс</span>
            <PulseEkg size="brand" className="public-pulse-ekg-svg" />
          </div>
          <div className="public-header-ekg">
            <p className="public-tagline">Пульс · опрос</p>
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

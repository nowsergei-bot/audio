import { Link } from 'react-router-dom';
import PhotoWallUploadForm from '../components/PhotoWallUploadForm';

export default function PhotoWallTestPage() {
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

  return (
    <div className="page photo-wall-upload-page photo-wall-test-page">
      <PhotoWallUploadForm
        uidStorageKey="photo_wall_uid_test"
        heading="Тест фотостены"
        subline="Та же модерация, что у боевой загрузки. Отдельный участник в браузере. Пакет — до 120 снимков."
        compact
        allowMultiple
      />
      <div className="photo-wall-test-links muted">
        <a href={`${origin}/photo-wall`}>Боевая загрузка</a>
        <span aria-hidden> · </span>
        <a href={`${origin}/photo-wall/display`} target="_blank" rel="noreferrer">
          Экран коллажа
        </a>
        <span aria-hidden> · </span>
        <a href={`${origin}/photo-wall/display?kiosk=1`} target="_blank" rel="noreferrer">
          Киоск (без шапки)
        </a>
        <span aria-hidden> · </span>
        <Link to="/photo-wall/results">Модерация</Link>
      </div>
    </div>
  );
}

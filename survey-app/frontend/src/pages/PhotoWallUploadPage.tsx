import PhotoWallUploadForm from '../components/PhotoWallUploadForm';

export default function PhotoWallUploadPage() {
  return (
    <div className="page photo-wall-upload-page">
      <PhotoWallUploadForm uidStorageKey="photo_wall_uid" heading="Фотостена" subline={null} compact />
      <p className="muted photo-wall-upload-footnote">
        На экране коллажа фото появится после одобрения модератором.
      </p>
    </div>
  );
}

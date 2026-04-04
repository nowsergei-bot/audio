const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

function getBucket() {
  return String(
    process.env.PHOTO_WALL_BUCKET || process.env.S3_BUCKET || process.env.YC_BUCKET || '',
  ).trim();
}

function shouldUsePhotoWallStorage() {
  return (
    String(process.env.PHOTO_WALL_STORAGE || '').trim() === '1' &&
    Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) &&
    Boolean(getBucket())
  );
}

/** База публичных URL (хостинг бакета). Без слэша в конце. */
function getPublicBaseUrl() {
  const explicit = String(process.env.PHOTO_WALL_PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  const b = getBucket();
  return b ? `https://${b}.website.yandexcloud.net` : '';
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION || 'ru-central1',
    endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

function dataUrlToBuffer(dataUrl) {
  const s = String(dataUrl);
  const comma = s.indexOf(',');
  if (comma < 0 || !/^data:[^;]+;base64$/i.test(s.slice(0, comma).trim())) {
    throw new Error('Invalid data URL');
  }
  const head = s.slice(0, comma);
  const b64 = s.slice(comma + 1);
  const mt = /^data:([^;]+)/i.exec(head);
  const contentType = mt ? mt[1].trim() : 'image/jpeg';
  return { contentType, buffer: Buffer.from(b64, 'base64') };
}

async function putObject(client, key, buffer, contentType) {
  const useAcl =
    String(process.env.PHOTO_WALL_OBJECT_ACL_PUBLIC_READ || process.env.YC_OBJECT_ACL_PUBLIC_READ || '')
      .trim() === '1';
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType || 'image/jpeg',
      ...(useAcl ? { ACL: 'public-read' } : {}),
    }),
  );
}

/**
 * Загружает полный и превью JPEG в бакет, возвращает HTTPS URL для сайта.
 * @param {{ uploadId: string, fullDataUrl: string, thumbDataUrl: string | null }} opts
 */
async function uploadPhotoWallPair(opts) {
  const { uploadId, fullDataUrl, thumbDataUrl } = opts;
  const client = getS3Client();
  const full = dataUrlToBuffer(fullDataUrl);
  const fullKey = `photo-wall/${uploadId}.jpg`;
  const ct =
    /jpeg|jpg/i.test(full.contentType) ? 'image/jpeg' : full.contentType || 'image/jpeg';
  await putObject(client, fullKey, full.buffer, ct);

  const base = getPublicBaseUrl();
  const image_public_url = `${base}/${fullKey}`;

  let thumb_public_url = image_public_url;
  if (thumbDataUrl && String(thumbDataUrl).trim()) {
    const thumb = dataUrlToBuffer(thumbDataUrl);
    const thumbKey = `photo-wall/${uploadId}-t.jpg`;
    await putObject(client, thumbKey, thumb.buffer, 'image/jpeg');
    thumb_public_url = `${base}/${thumbKey}`;
  }

  return { image_public_url, thumb_public_url };
}

/** Удаляет все объекты с префиксом photo-wall/ (полный кадр и превью). */
async function purgePhotoWallObjectStorage() {
  if (!shouldUsePhotoWallStorage()) {
    return { deleted: 0, skipped: true };
  }
  const client = getS3Client();
  const bucket = getBucket();
  const prefix = 'photo-wall/';
  let deleted = 0;
  let continuationToken;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    const contents = list.Contents || [];
    for (let i = 0; i < contents.length; i += 1000) {
      const chunk = contents.slice(i, i + 1000).map((o) => ({ Key: o.Key }));
      if (chunk.length === 0) continue;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk, Quiet: true },
        }),
      );
      deleted += chunk.length;
    }
  } while (continuationToken);
  return { deleted, skipped: false };
}

module.exports = {
  shouldUsePhotoWallStorage,
  uploadPhotoWallPair,
  purgePhotoWallObjectStorage,
  dataUrlToBuffer,
  getPublicBaseUrl,
  getBucket,
};

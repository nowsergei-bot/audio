/** Витрина / коллаж: выше Full HD и качество JPEG — заметнее на больших экранах. */
export const PHOTO_WALL_FULL_MAX_W = 2560;
export const PHOTO_WALL_FULL_MAX_H = 1440;
/** Превью для модерации и легаси-JSON; для URL в бакете коллаж берёт полный файл. */
export const PHOTO_WALL_THUMB_MAX = 480;

export function bitmapToJpegDataUrl(
  bitmap: ImageBitmap,
  maxW: number,
  maxH: number,
  quality: number,
): string {
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas не поддерживается');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function fileToJpegPairForUpload(file: File): Promise<{ full: string; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const full = bitmapToJpegDataUrl(bitmap, PHOTO_WALL_FULL_MAX_W, PHOTO_WALL_FULL_MAX_H, 0.9);
    const thumb = bitmapToJpegDataUrl(bitmap, PHOTO_WALL_THUMB_MAX, PHOTO_WALL_THUMB_MAX, 0.82);
    return { full, thumb };
  } finally {
    bitmap.close?.();
  }
}

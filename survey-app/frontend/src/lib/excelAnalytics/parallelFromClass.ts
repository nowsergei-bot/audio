/**
 * Номер параллели из подписи класса: 7А, 7 B, 7B, 10 б → "7", "10";
 * «10 класс», «параллель 9» — тоже извлекаем.
 */
export function inferParallelFromClassLabel(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s === '(не указано)') return null;
  const low = s.toLowerCase();
  const klass = low.match(/^(\d{1,2})\s*класс\b/);
  if (klass) return klass[1];
  const par = low.match(/параллел[ьи]\D{0,8}(\d{1,2})\b/);
  if (par) return par[1];
  const lead = s.match(/^(\d{1,2})(?:[\s.\-–—]*[а-яёa-z])?/i);
  if (lead) return lead[1];
  return null;
}

/**
 * Подписи из Excel часто идут как «Русский // English». По умолчанию в UI — только русская часть;
 * режим «en» — только английская (если есть разделитель).
 */
export type ExcelLabelLocaleMode = 'ru' | 'en';

export function formatBilingualCellLabel(raw: string, mode: ExcelLabelLocaleMode): string {
  const s = String(raw ?? '').trim();
  if (!s) return s;
  const idx = s.indexOf('//');
  if (idx === -1) return s;
  const left = s.slice(0, idx).trim();
  const right = s.slice(idx + 2).trim();
  if (mode === 'en') return right || left || s;
  return left || right || s;
}

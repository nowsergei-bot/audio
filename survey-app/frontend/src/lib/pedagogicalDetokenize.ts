/** Соответствует backend/functions/lib/pii-tokenize.js — для превью на клиенте. */
export function detokenizePedagogicalText(text: string, map: Record<string, string>): string {
  if (!map || typeof map !== 'object') return String(text ?? '');
  let out = String(text ?? '');
  const tokens = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const t of tokens) {
    const val = map[t];
    if (val == null) continue;
    out = out.split(t).join(String(val));
  }
  return out;
}

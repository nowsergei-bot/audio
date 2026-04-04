/**
 * Разбор JSON из ответа LLM (Yandex/OpenAI): markdown-ограждения, лишний текст до/после.
 */
function tryParseLlmJsonObject(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const fence = /^```(?:json)?\s*([\s\S]*?)```/im.exec(s);
  if (fence) s = fence[1].trim();

  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch {
    /* fallthrough */
  }

  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = { tryParseLlmJsonObject };

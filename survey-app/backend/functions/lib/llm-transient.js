/**
 * Признаки временного сбоя (сеть, шлюз, обрыв TLS) — имеет смысл повторить запрос к LLM.
 * Не использовать для 401/403 по ключу — это не «починится» ретраем.
 */
function isTransientLlmDetail(detail) {
  const s = String(detail || '');
  return /fetch failed|Failed to fetch|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|network|502|503|504|Gateway|timeout|timed out|TLS|certificate/i.test(
    s,
  );
}

module.exports = { isTransientLlmDetail };

/**
 * Владелец сущности с user_id: при Bearer + X-Api-Key в приоритете сессия (иначе POST даёт user_id=null и 403).
 * @returns {{ ok: true, userId: number } | { ok: true, apiKey: true } | { ok: false }}
 */
function resolveProjectOwner(user, viaAdminKey, sessionUser) {
  if (sessionUser && sessionUser.id != null) {
    return { ok: true, userId: Number(sessionUser.id) };
  }
  if (user && user.id != null) return { ok: true, userId: Number(user.id) };
  if (viaAdminKey) return { ok: true, apiKey: true };
  return { ok: false };
}

module.exports = { resolveProjectOwner };

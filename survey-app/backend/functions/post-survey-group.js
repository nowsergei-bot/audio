const { json, parseBody } = require('./lib/http');
const { isSurveyGroupSchemaError } = require('./lib/survey-groups-schema');

/** Латиница, цифры и подчёркивание; из кириллического названия — пусто → позже подставим уникальный id. */
function slugFromExplicit(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return s;
}

function slugFromAsciiName(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  return s;
}

async function pickUniqueSlug(pool, base) {
  let root = (base || 'group').slice(0, 64) || 'group';
  for (let n = 0; n < 120; n++) {
    const candidate = n === 0 ? root : `${root.slice(0, 56)}_${n + 1}`;
    const r = await pool.query('SELECT 1 FROM survey_groups WHERE slug = $1', [candidate]);
    if (!r.rows.length) return candidate;
  }
  return `g_${Date.now()}`;
}

/**
 * Создание раздела (группы) опросов. Только администратор или X-Api-Key (как admin).
 */
async function handlePostSurveyGroup(pool, event, user) {
  if (!user || user.role !== 'admin') {
    return json(403, {
      error: 'Forbidden',
      message: 'Создание разделов доступно только администратору или при входе по API-ключу.',
    });
  }

  const body = parseBody(event) || {};
  const name = String(body.name || '').trim();
  if (!name) return json(400, { error: 'Укажите название раздела (name).' });

  const curator_name = String(body.curator_name ?? '').trim();
  let sort_order = 0;
  if (body.sort_order !== undefined && body.sort_order !== null && body.sort_order !== '') {
    const so = Number(body.sort_order);
    if (!Number.isFinite(so)) return json(400, { error: 'Некорректный sort_order.' });
    sort_order = so;
  }

  const explicit = slugFromExplicit(body.slug);
  let baseSlug = explicit || slugFromAsciiName(name);
  if (!baseSlug) baseSlug = `group_${Date.now()}`;

  try {
    const slug = await pickUniqueSlug(pool, baseSlug);
    const ins = await pool.query(
      `INSERT INTO survey_groups (slug, name, curator_name, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slug, name, curator_name, sort_order`,
      [slug, name.slice(0, 500), curator_name.slice(0, 500), sort_order],
    );
    return json(201, { group: ins.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return json(409, { error: 'Раздел с таким идентификатором уже существует.' });
    }
    if (isSurveyGroupSchemaError(e)) {
      return json(503, { error: 'Таблица survey_groups недоступна. Примените миграцию схемы.' });
    }
    throw e;
  }
}

module.exports = { handlePostSurveyGroup };

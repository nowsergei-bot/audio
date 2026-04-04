const { Pool } = require('pg');

let pool;

/** Если в URI нет sslmode=, добавляем require (Neon, многие облачные Postgres). */
function ensureSslModeRequire(connectionString) {
  if (!connectionString || /sslmode=/i.test(connectionString)) {
    return connectionString;
  }
  const hostNeedsDefaultSsl =
    /neon\.tech|supabase\.co|pooler\.supabase|yandexcloud\.net|amazonaws\.com/i.test(connectionString);
  if (!hostNeedsDefaultSsl) {
    return connectionString;
  }
  return connectionString.includes('?')
    ? `${connectionString}&sslmode=require`
    : `${connectionString}?sslmode=require`;
}

function logTarget(connectionString) {
  try {
    const u = new URL(connectionString.replace(/^postgresql:/i, 'http:'));
    const db = (u.pathname || '').replace(/^\//, '') || '(no db in path)';
    console.log(`[pg] target host=${u.hostname} database=${db}`);
  } catch {
    console.log('[pg] could not parse PG_CONNECTION_STRING (check format)');
  }
}

function getPool() {
  if (!pool) {
    let connectionString = process.env.PG_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('PG_CONNECTION_STRING is not set');
    }
    connectionString = ensureSslModeRequire(connectionString.trim());
    logTarget(connectionString);

    const useSsl =
      process.env.PG_SSL === 'false'
        ? false
        : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' };

    const maxConn = parseInt(String(process.env.PG_POOL_MAX || '4').trim(), 10);
    pool = new Pool({
      connectionString,
      max: Number.isFinite(maxConn) && maxConn >= 1 && maxConn <= 20 ? maxConn : 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      ssl: useSsl,
    });
  }
  return pool;
}

module.exports = { getPool };

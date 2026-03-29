const { Pool } = require('pg');

let pool;

/** Для Neon в URI должен быть sslmode=require; иначе подключение может не установиться. */
function ensureNeonSslMode(connectionString) {
  if (!connectionString || !/neon\.tech/i.test(connectionString)) {
    return connectionString;
  }
  if (/sslmode=/i.test(connectionString)) {
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
    connectionString = ensureNeonSslMode(connectionString.trim());
    logTarget(connectionString);

    const useSsl =
      process.env.PG_SSL === 'false'
        ? false
        : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' };

    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      ssl: useSsl,
    });
  }
  return pool;
}

module.exports = { getPool };

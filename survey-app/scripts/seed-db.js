#!/usr/bin/env node
/**
 * Создаёт демо-опрос (черновик).
 * Установите зависимости: cd survey-app/backend && npm install
 * Запуск из корня survey-app: PG_CONNECTION_STRING=... node scripts/seed-db.js
 */
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join(__dirname, '../backend/functions/package.json'));
const { Pool } = req('pg');
const { v4: uuidv4 } = req('uuid');

async function main() {
  const connectionString = process.env.PG_CONNECTION_STRING;
  if (!connectionString) {
    console.error('Set PG_CONNECTION_STRING');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  const access_link = uuidv4().replace(/-/g, '');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `INSERT INTO surveys (title, description, status, access_link)
       VALUES ($1, $2, 'draft', $3)
       RETURNING id`,
      [
        'Демо: удовлетворённость сервисом',
        'Пример для проверки дашборда после публикации и ответов.',
        access_link,
      ]
    );
    const sid = s.rows[0].id;
    const qs = [
      ['Насколько вы довольны?', 'rating', { min: 1, max: 5 }, 0],
      ['Что важнее всего?', 'radio', ['Скорость', 'Цена', 'Качество'], 1],
      ['Какие каналы использовать?', 'checkbox', ['Email', 'Чат', 'Телефон'], 2],
      ['Оценка от 1 до 10', 'scale', { min: 1, max: 10 }, 3],
      ['Комментарий', 'text', { maxLength: 2000 }, 4],
    ];
    for (const [text, type, options, sort_order] of qs) {
      await client.query(
        `INSERT INTO questions (survey_id, text, type, options, sort_order)
         VALUES ($1, $2, $3::question_type, $4::jsonb, $5)`,
        [sid, text, type, JSON.stringify(options), sort_order]
      );
    }
    await client.query('COMMIT');
    console.log('Seeded survey id=%s access_link=%s', sid, access_link);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

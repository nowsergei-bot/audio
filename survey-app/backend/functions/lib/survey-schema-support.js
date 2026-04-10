/**
 * Проверка колонки на каждый вызов — без долгоживущего кэша:
 * после миграции БД warm-инстанс функции сразу начнёт писать флаг, без холодного рестарта.
 * Запрос к information_schema с LIMIT 1 обычно очень дешёвый.
 */
async function surveysAllowMultipleResponsesSupported(pool) {
  const r = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'surveys' AND column_name = 'allow_multiple_responses'
     LIMIT 1`
  );
  return r.rows.length > 0;
}

module.exports = { surveysAllowMultipleResponsesSupported };

# Пульс: по шагам для новичков

Короткий маршрут «с нуля до работающего сайта». Подробности по отдельным темам — в [BACKEND_AND_API.md](../BACKEND_AND_API.md) и [OBJECT_STORAGE.md](../OBJECT_STORAGE.md).

---

## 0. Что у вас будет в итоге

| Часть | Где живёт |
|--------|-----------|
| Сайт (админка, формы опросов) | **Yandex Object Storage** — статика (HTML/JS/CSS) |
| API (логика, БД) | **Yandex Cloud Function** + при необходимости **API Gateway** |
| База данных | **Neon** (PostgreSQL в облаке) или Managed PostgreSQL в Yandex |

---

## 1. Код на компьютере

1. Установите [Git](https://git-scm.com/) и [Node.js](https://nodejs.org/) (LTS).
2. Склонируйте репозиторий с проектом `survey-app`.
3. В терминале:
   ```bash
   cd survey-app/frontend && npm install
   cd ../backend/functions && npm install
   ```

---

## 2. База данных (Neon)

1. Зайдите на [neon.tech](https://neon.tech), зарегистрируйтесь, создайте **проект** и базу (часто имя `neondb`).
2. В разделе **Connection** скопируйте строку подключения **PostgreSQL** (с паролем). Она понадобится как **`PG_CONNECTION_STRING`**.
3. Откройте **SQL Editor** в Neon и по очереди выполните файлы из папки **`backend/db/migrations/`** — по номеру: `001`, `002`, … до последнего (или один раз примените **`backend/db/schema.sql`**, если так сказано в вашей инструкции к проекту).  
   Если ошибка «таблица уже есть» на повторном запуске — часто это нормально (`IF NOT EXISTS`).

Сохраните строку подключения в надёжном месте; **не выкладывайте** её в публичный git.

---

## 3. Проверка API локально (по желанию)

```bash
cd survey-app/backend/functions
export PG_CONNECTION_STRING='postgresql://…ваша строка Neon…?sslmode=require'
export ADMIN_API_KEY='придумайте-длинный-секрет'
export PG_SSL_REJECT_UNAUTHORIZED=false
node local-server.js
```

В другом окне:

```bash
cd survey-app/frontend
echo 'VITE_DEV_PROXY=http://127.0.0.1:8787' > .env.development.local
npm run dev
```

Откройте в браузере адрес, который покажет Vite (часто `http://localhost:5173`). Если админка открывается — цепочка «фронт → локальный API → Neon» работает.

---

## 4. Yandex Cloud Function (боевой API)

1. В [консоли Yandex Cloud](https://console.cloud.yandex.ru) создайте **Cloud Function** (среда **Node.js 18+**, точка входа **`index.handler`**).
2. Соберите архив из папки `backend/functions` (как в [README](../README.md) или скриптом `./scripts/deploy-functions.sh` — получится `backend/function-bundle.zip`).
3. Загрузите архив в новую **версию** функции.
4. В **переменных окружения** функции задайте минимум:
   - **`PG_CONNECTION_STRING`** — строка Neon;
   - **`ADMIN_API_KEY`** — тот же секрет, что и в админке (поле для API-ключа);
   - **`CORS_ORIGIN`** — URL сайта на Object Storage, например `https://ваш-бакет.website.yandexcloud.net` (**без** `/` в конце).

   Дополнительно (по необходимости): ключи ИИ, фотостена и S3 — см. [BACKEND_AND_API.md](../BACKEND_AND_API.md).

5. Подключите к функции **HTTP**: отдельный **триггер HTTP** или **API Gateway** с проксированием на функцию. Скопируйте **базовый HTTPS-URL** API (без хвостового `/`).

Проверка: в браузере откройте `https://ВАШ-API/api/ping` или `https://ВАШ-API/api/surveys` — должен прийти JSON (для `/api/surveys` без ключа часто **401** — это нормально).

---

## 5. Сборка фронта и заливка в бакет

1. В корне `survey-app` создайте **`deploy.config.json`** (его нет в git) по образцу из документации: укажите **`apiBase`** — тот самый URL API из шага 4, **`bucket`** — имя бакета.
2. Сборка и синхронизация (нужны ключи S3 для бакета):
   ```bash
   cd survey-app
   export AWS_ACCESS_KEY_ID='…'
   export AWS_SECRET_ACCESS_KEY='…'
   export AWS_DEFAULT_REGION=ru-central1
   ./scripts/deploy-static-site.sh quick
   ```
   Подробнее: [OBJECT_STORAGE.md](../OBJECT_STORAGE.md).

3. Убедитесь, что **`CORS_ORIGIN`** на функции **совпадает** с URL сайта из браузера (обычно `https://имя-бакета.website.yandexcloud.net`).

---

## 6. Первый вход в админку

1. Откройте сайт из бакета в браузере.
2. На странице входа введите **тот же** `ADMIN_API_KEY`, что в переменных функции (или зарегистрируйте пользователя, если у вас включена регистрация по домену).

---

## 7. Фотостена (если нужна)

- Миграции **009–012** (и при необходимости дальше) — в Neon через SQL Editor.
- В функции: **`PHOTO_WALL_STORAGE=1`**, ключи к **Object Storage**, имя бакета — см. [BACKEND_AND_API.md](../BACKEND_AND_API.md) и [NEON_TRAFFIC_AND_MIGRATION.md](NEON_TRAFFIC_AND_MIGRATION.md).

---

## 8. Как не перегружать Neon (кратко)

- Храните **фото в бакете**, в БД — **только URL** (`PHOTO_WALL_STORAGE=1`).
- Не коммитьте **`deploy.config.json`** и секреты; используйте `.env` только локально.

---

## Если что-то сломалось

| Симптом | Куда смотреть |
|--------|----------------|
| Сайт грузится, но «Network error» / CORS | `CORS_ORIGIN` на функции = точный URL сайта |
| 502 / HTML вместо JSON | Неверный `VITE_API_BASE` при сборке или шлюз не на ту функцию |
| Не входит в админку | Несовпадение `ADMIN_API_KEY` |
| Ошибки БД | Строка `PG_CONNECTION_STRING`, миграции применены |

Логи функции — в консоли Yandex Cloud → ваша функция → **Логи**.

---

## Полезные скрипты в `scripts/`

- `deploy-functions.sh` — ZIP для Cloud Function.
- `publish-function-yandex.sh` — сборка + подсказка выката через `yc`.
- `pg-neon-to-neon-migrate.sh` — перенос БД между проектами Neon.
- Подробнее про трафик и миграции: [NEON_TRAFFIC_AND_MIGRATION.md](NEON_TRAFFIC_AND_MIGRATION.md).

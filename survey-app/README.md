# Пульс — веб-опросник (Яндекс Облако)

**Пульс** — название продукта: админка с шаблонами опросов на русском, публичные формы, страница результатов с графиками и блоком умной аналитики. Стек: React (Vite), Node.js в Yandex Cloud Functions, PostgreSQL.

## Структура

- `frontend/` — React + TypeScript + Recharts + React Router
- `backend/functions/` — единая HTTP-функция с маршрутизацией (`index.handler`)
- `backend/db/schema.sql` — DDL
- `scripts/` — деплой-скрипт и сид БД
- `infra/superset/` — опционально: **Apache Superset** (Docker) для BI по PostgreSQL; подключение к данным опросов и заметки про AI/MCP — [infra/superset/README.md](infra/superset/README.md)

## Оформление и бренд

- Шрифт: **Lato** (`frontend/src/fonts/lato.css`, подключение в `main.tsx`).
- **Пульс**: в шапке админки и на публичной форме — `pulse-logo.png` с лёгкой **пульсацией свечения** (CSS `drop-shadow`); иконка вкладки — тот же файл.
- Корпоративные акценты гимназии: белый / красный `#e30613`; админка — тёмная панель с плавными переходами страниц и интерактивными графиками (Recharts).
- Ассеты в `frontend/public/branding/` и `frontend/public/icons/`:
  - `icons/favicon.ico`, `favicon-*.png`, `manifest.json`, `browserconfig.xml` — фавикон и PWA-метаданные (подключены в `index.html`);
  - `pulse-logo.png` — логотип «ПУЛЬС» (актуальный макет; в шапке — с пульсирующим красным свечением через CSS);
  - `logo-horizontal-dark-bg.png` — шапка рядом с Пульсом;
  - `campus/campus-1.png` … `campus-6.png` — фото кампуса в слайдшоу на публичной форме опроса;
  - `logo-mark-dark.png` — при необходимости в других блоках.

## Умная аналитика (блок на странице результатов)

- Эндпоинт (с заголовком `X-Api-Key`): `POST /api/surveys/:id/ai-insights`.
- **Без ключа нейросети** на функции: ответ содержит только **автоматическую** сводку по формулам (показатели, выводы по вопросам, мини-диаграммы) — всё считается на сервере из тех же данных, что и обычные результаты.
- **С переменной `OPENAI_API_KEY`** (и при желании `OPENAI_MODEL`): к автосводке добавляется **текстовая записка на русском**, сгенерированная моделью по сжатому JSON с цифрами. Ключ задаётся только в окружении Cloud Function, во фронт не передаётся.
- Реализация: `backend/functions/post-ai-insights.js`, эвристика — `lib/insight-dashboard.js`.

## Импорт из Excel

- **Новый опрос из файла** — пункт **«Дашборд из Excel»** в шапке: `POST /api/surveys/from-workbook` с **multipart** (поле `file`, `.xlsx`) или JSON `{ filename, sheets }` для небольших книг; черновик с первого листа, редирект в редактор.
- Пакетный импорт строк в **уже существующий** опрос на фронте **не выводится**; при необходимости интеграции API остаётся: `POST /api/surveys/:id/import-rows` (см. `post-import-rows.js`).

## Статический сайт в Object Storage (Яндекс Облако)

**Пошаговая инструкция для новичков:** [OBJECT_STORAGE.md](OBJECT_STORAGE.md) (аккаунт → бакет → хостинг SPA → публичное чтение → ключи → `aws s3 sync`).

Кратко:

1. Бакет + **хостинг**: главная и страница ошибки = `index.html`.
2. Публичное **чтение** (политика бакета или ACL при заливке).
3. Заливка: скрипт `scripts/sync-object-storage.sh` (нужны `awscli` и статические ключи сервисного аккаунта).
4. `VITE_API_BASE` и `CORS_ORIGIN` на функции — если API на другом домене.

Ключи доступа храните только у себя; в чат и в git не отправляйте.

**Бэкенд (PostgreSQL + Cloud Function + связка с сайтом) по шагам для новичков:** [BACKEND_AND_API.md](BACKEND_AND_API.md).  
**Без платного кластера в Яндексе:** бесплатный PostgreSQL у Neon/Supabase и т.п. — тот же `PG_CONNECTION_STRING`, см. начало того же файла.

## База данных

1. Создайте кластер Managed PostgreSQL в Яндекс Облаке.
2. Примените DDL:

```bash
psql "$PG_CONNECTION_STRING" -f backend/db/schema.sql
```

3. (Опционально) демо-опрос:

```bash
cd survey-app/backend/functions && npm install
cd ../..
PG_CONNECTION_STRING="postgresql://..." node survey-app/scripts/seed-db.js
```

Для облачного Postgres часто нужен SSL; в функции по умолчанию включён `ssl` у пула. Для локального Postgres без SSL задайте `PG_SSL=false`.

## Локальный API

```bash
cd survey-app/backend/functions && npm install
export PG_CONNECTION_STRING="postgresql://..."
export ADMIN_API_KEY="dev-secret"
export PG_SSL=false   # если локальный Postgres без SSL
node local-server.js
```

По умолчанию слушает порт `8787`.

## Локальный фронтенд

```bash
cd survey-app/frontend && npm install && npm run dev
```

Запросы на `/api/*` проксируются на `http://127.0.0.1:8787` (см. `vite.config.ts`, переменная `VITE_DEV_PROXY`).

В интерфейсе на главной странице введите тот же `ADMIN_API_KEY`, что на бэкенде — он сохраняется в `localStorage` как `X-Api-Key`.

## Переменные окружения функции

| Переменная | Назначение |
|------------|------------|
| `PG_CONNECTION_STRING` | Строка подключения к PostgreSQL |
| `ADMIN_API_KEY` | Ключ для админских маршрутов (`X-Api-Key`) |
| `CORS_ORIGIN` | Заголовок CORS (по умолчанию `*`) |
| `PG_SSL` | `false` — отключить SSL у клиента `pg` |
| `PG_SSL_REJECT_UNAUTHORIZED` | `false` — не проверять сертификат (только если осознанно) |

## API (кратко)

**Публично (без ключа):**

- `GET /api/public/surveys/:accessLink` — опубликованный опрос
- `POST /api/public/surveys/:accessLink/responses` — тело `{ respondent_id, answers: [{ question_id, value }] }`
- `POST /api/surveys/:id/responses` — то же для опубликованного опроса по числовому id (как в ТЗ)

**Админка (заголовок `X-Api-Key`):**

- `GET/POST /api/surveys`, `GET/PUT/DELETE /api/surveys/:id`
- `GET /api/surveys/:id/results` (в т.ч. `text_word_cloud`, выборка `samples_highlight` по текстовым вопросам), `GET /api/surveys/:id/export-rows`, `GET /api/surveys/:id/text-answers?question_id=&q=&offset=&limit=` (полные текстовые ответы с пагинацией и поиском), `GET/POST /api/surveys/:id/comments`, `POST /api/surveys/:id/ai-insights`, `POST /api/surveys/:id/text-question-insights` (тело `{ "question_id": N }` — компиляция и вывод по одному текстовому вопросу; нейросеть при `OPENAI_API_KEY`)
- `POST /api/surveys/from-workbook` — **предпочтительно** `multipart/form-data`, поле **`file`** (бинарный `.xlsx`); иначе JSON `{ filename, sheets }`. **Черновик** опроса, книга в `survey_workbooks`; редактор `/surveys/:id/edit`
- `POST /api/surveys/:id/import-rows` — пакетный импорт ответов (без UI в текущем фронте)
- `POST /api/surveys/:id/workbooks`, `DELETE …`, `POST …/workbooks/:wid/ai` — серверные маршруты для книг Excel (в UI не используются)

## Деплой функции

```bash
chmod +x survey-app/scripts/deploy-functions.sh
./survey-app/scripts/deploy-functions.sh
```

Архив создаётся в `backend/function-bundle.zip`. Дальше — `yc serverless function version create ...` (подсказка в конце скрипта).

## Деплой статики (YouWare)

В корне `survey-app` лежит **`deploy.config.json`** (имя бакета, `apiBase` для сборки). Расширение YouWare по-прежнему может использовать **`.youware.json`** — скрипт читает сначала `deploy.config.json`, при его отсутствии — `.youware.json`.

**Быстрая повторная выкладка** (без `npm ci` каждый раз — только сборка и sync):

```bash
cd survey-app && ./scripts/deploy-static-site.sh quick
# или короче: ./scripts/deploy-static-site.sh q
```

Нужны те же ключи AWS/Yandex в окружении или в `aws configure`. Полный цикл с чистой установкой зависимостей: `./scripts/deploy-static-site.sh all`.

Загрузку по отдельности можно выполнить скриптом `scripts/sync-object-storage.sh`, расширением YouWare или вручную (см. [OBJECT_STORAGE.md](OBJECT_STORAGE.md)).

Для SPA настроьте в бакете редирект ошибок 404 на `index.html`.

## Продакшен-сборка фронта

Без **`VITE_API_BASE`** запросы с сайта в бакете уходят на тот же домен и получают HTML вместо JSON.

Удобнее всего открыть в редакторе **`survey-app/deploy.config.json`** и в поле **`apiBase`** вставить URL шлюза или функции (HTTPS, без слэша в конце, без `/api`). Тогда `./scripts/deploy-static-site.sh build` подставит его сам.

Либо файл **`frontend/.env.production`** (не в git): скопируйте из **`frontend/.env.production.example`**.

Либо одноразово:

```bash
VITE_API_BASE="https://<ваш-api-gateway-домен>" npm run build
```

## Ограничения скелета

- Нет полноценной авторизации кроме API-ключа.
- Сводка в CSV с страницы результатов убрана; сырые ответы — `GET /api/surveys/:id/export-rows` и кнопка в редакторе опроса.
- Путь запроса в API Gateway должен совпадать с тем, что ожидает `normalizePath` в `backend/functions/lib/http.js` (при необходимости донастройте шлюз или код).

# Меньше трафика Neon ↔ Cloud Function и переезд в новый аккаунт Neon

## Что выкатить

1. **SQL 014 в Neon** — если используете Storage и в таблице фотостены есть **`image_public_url`**: выполнить `backend/db/migrations/014_photo_wall_drop_redundant_base64.sql` (очистка избыточного `image_data`).
2. **Новая версия функции** — ZIP из `backend/functions` + деплой в Yandex Cloud Function.
3. **Сборка и заливка фронта** — если менялись, например, `PhotoWallDisplayPage`, `client.ts` или env сборки (`VITE_PHOTO_WALL_POLL_MS` и т.п.).

Ниже — детали, почему так и как настроить фотостену и пул.

## Снижение нагрузки на Neon (уже в коде)

1. **Фотостена в Object Storage** — `PHOTO_WALL_STORAGE=1` и ключи к бакету: в БД только URL, не base64. Миграции **009–012**, при необходимости **014** — убрать лишний `image_data`, если есть `image_public_url`.
2. **Пул к БД** — в Cloud Function можно задать `PG_POOL_MAX` (по умолчанию **4** соединения на инстанс функции).
3. **Публичный коллаж** — реже опрос (по умолчанию **45 с**), в `.env` сборки: `VITE_PHOTO_WALL_POLL_MS=60000` при необходимости.
4. **GET `/api/public/photo-wall/approved`** — если все снимки отдаются как **URL**, ответ кэшируется в браузере ~25 с (меньше повторных запросов к Neon).
5. **Страница модерации фотостены** — фоновое обновление списка раз в **25 с** (вкладка открыта).

После изменений бэкенда — новая версия функции; после изменений фронта — сборка и выкладка статики.

---


## Почему «съедается» сеть

Исходящий трафик Neon считает **всё, что уходит из БД в клиента** (в т.ч. в Yandex Cloud Function). Самое тяжёлое:

- **Фотостена**: строки с **base64 / data URL** в `image_data` — каждый `SELECT` тянет мегабайты через Neon.
- Любые **большие JSON** ответы (результаты, Excel и т.д.).

## 1. Настроить фотостену так, чтобы в Postgres почти не лежали картинки

Уже поддержано в коде: при **Object Storage** в БД пишутся **URL**, а не base64.

1. **Миграции** в новой/текущей БД (по порядку из `backend/db/migrations/`): минимум **009**, **011**, **012** для фотостены с URL.
2. В **Cloud Function** задать (как в `BACKEND_AND_API.md` / консоли):
   - `PHOTO_WALL_STORAGE=1`
   - `YC_BUCKET` или `PHOTO_WALL_BUCKET` / `S3_BUCKET`
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` (часто `ru-central1`), при необходимости `S3_ENDPOINT`
   - при публичном чтении с бакета — `PHOTO_WALL_PUBLIC_BASE_URL` или ACL, как у вас принято
3. После деплоя **новые загрузки** идут в бакет, в Postgres — только URL → **резко меньше egress**.

**Старые строки**, где уже лежит base64 в `image_data`, сами по себе не исчезнут: их можно позже вынести в S3 отдельной задачей или оставить (они продолжают раздувать ответы, пока есть в выборке).

## Перенос старый Neon → новый Neon (новый аккаунт)

Скрипт: `scripts/pg-neon-to-neon-migrate.sh` (нужны `pg_dump` и `pg_restore` локально).

```bash
cd /path/to/audio/survey-app
export PG_SOURCE='postgresql://USER:PASS@ep-СТАРЫЙ.neon.tech/neondb?sslmode=require'
export PG_TARGET='postgresql://USER:PASS@ep-НОВЫЙ.neon.tech/neondb?sslmode=require'
./scripts/pg-neon-to-neon-migrate.sh
```

Без фотостены: `EXCLUDE_PHOTO_WALL=1 ./scripts/pg-neon-to-neon-migrate.sh`

## 2. Переезд в новый аккаунт Neon с выгрузкой базы

### 2a. Нужны опросы, фотостена не важна (меньше трафика при дампе)

Таблица **`photo_wall_uploads`** часто на порядки тяжелее остального (base64). Её можно **не включать** в дамп — все опросы, ответы, пользователи, workbook, приглашения останутся.

```bash
cd /path/to/audio/survey-app
export PG_SOURCE='postgresql://USER:PASSWORD@ep-xxx.neon.tech/neondb?sslmode=require'
./scripts/pg-dump-without-photo-wall.sh
```

Восстановление в **новую** пустую БД Neon:

```bash
export PG_TARGET='postgresql://...новый Neon...'
pg_restore --verbose --no-owner --no-acl --clean --if-exists --dbname="$PG_TARGET" pg-migrate-no-photo.dump
```

Потом в новой БД при необходимости создайте пустую фотостену миграциями **009–012** (или выполните `schema.sql` целиком — таблица `photo_wall_uploads` появится пустой).

### 2b. Полный дамп (всё, включая фотостену)

Да, **можно полностью выгрузить** Postgres и поднять копию в новом проекте Neon.

Локально нужны `pg_dump` / `pg_restore` / `psql` (клиент PostgreSQL).

```bash
cd survey-app

# Экспорт из старого Neon (строку возьмите в консоли Neon → Connection)
export PG_SOURCE='postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require'
./scripts/pg-dump-restore-migrate.sh dump
```

В **новом** аккаунте Neon создайте проект и БД, скопируйте **новую** строку подключения.

```bash
export PG_TARGET='postgresql://USER:PASSWORD@ep-yyy.region.aws.neon.tech/neondb?sslmode=require'
./scripts/pg-dump-restore-migrate.sh restore
```

Затем в **Yandex Cloud Function** обновите переменную **`PG_CONNECTION_STRING`** на `PG_TARGET` и создайте новую версию функции.

## 3. Если Neon пишет «exceeded the data transfer quota» и `pg_dump` не подключается

Пока лимит исходящего трафика исчерпан, **внешний** `pg_dump` с вашего компьютера Neon может блокировать.

Варианты:

1. **Дождаться сброса** лимита в новом месяце или **временно повысить** план — и сразу сделать дамп (лучше сразу **без фотостены**, см. §2a).
2. В **Neon Console** проверить, есть ли **встроенный бэкап / выгрузка** (зависит от тарифа).
3. **Ручной перенос**: в SQL Editor выполнить `COPY` / экспорт в **CSV** по таблицам (surveys, questions, responses, answer_values, users, …) и импорт в новую БД — труднее, но не требует одного большого `pg_dump`, если интерфейс Neon пускает запросы.

## Импорт Neon → Yandex Managed PostgreSQL

Скрипт (нужны локально `pg_dump` и `pg_restore`):

```bash
cd /path/to/audio/survey-app
export PG_SOURCE='postgresql://…Neon…?sslmode=require'
export PG_TARGET='postgresql://…Yandex_Managed…?sslmode=require'
./scripts/pg-neon-to-yandex-import.sh
```

Без таблицы фотостены (меньше объём и трафик при дампе с Neon):

```bash
EXCLUDE_PHOTO_WALL=1 ./scripts/pg-neon-to-yandex-import.sh
```

Строку **`PG_TARGET`** потом вставьте в переменную **`PG_CONNECTION_STRING`** у Cloud Function.  
Если функция не подключается к Yandex PG по SSL — см. **`PG_SSL_REJECT_UNAUTHORIZED`** в `BACKEND_AND_API.md`.

## 4. Мелочи

- **`PG_SSL_REJECT_UNAUTHORIZED`**: для Neon обычно не нужен `false`; если SSL ругается — см. `BACKEND_AND_API.md`.
- **Пул** в `pool.js` уже добавляет `sslmode=require` для типичных облачных хостов.
- Новый Neon = **новый лимит** egress на старте, но без пункта 1 снова быстро упрётесь, если тянуть base64 из БД.

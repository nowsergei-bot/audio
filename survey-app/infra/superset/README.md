# Apache Superset рядом с «Пульсом»

Здесь — **отдельный** стек Superset (свой Postgres только для **метаданных** Superset: дашборды, пользователи BI).  
Данные опросов остаются в **вашей** PostgreSQL (Yandex Managed, Neon и т.д.) — подключаются в Superset как **вторая база** (только чтение).

## Быстрый старт (Docker)

```bash
cd infra/superset
cp .env.example .env
# Задайте SUPERSET_SECRET_KEY (например: openssl rand -hex 32) и пароли

docker compose up -d
```

Откройте **http://localhost:8088** (или порт из `SUPERSET_PORT`), войдите под учёткой из `.env`.

Остановка: `docker compose down`. Данные метаданных Superset лежат в volume `superset_meta_data`.

## Подключить базу с опросами (Yandex Cloud / любая Postgres)

1. В БД приложения создайте **отдельного пользователя только на чтение** и выдайте `SELECT` на нужные таблицы/представления (пароль храните вне репозитория).

   Пример (подставьте имя БД и пользователя):

   ```sql
   CREATE ROLE superset_ro LOGIN PASSWORD '***';
   GRANT CONNECT ON DATABASE your_db TO superset_ro;
   GRANT USAGE ON SCHEMA public TO superset_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO superset_ro;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO superset_ro;
   ```

2. Опционально выполните `backend/db/optional_superset_views.sql` — появятся представления `superset_v_*` для более простых чартов.

3. В Superset: **Settings → Database connections → + Database**  
   - **SQLAlchemy URI**:  
     `postgresql+psycopg2://superset_ro:ПАРОЛЬ@ХОСТ:5432/ИМЯ_БД`  
   - Для Yandex Managed PostgreSQL включите **SSL** в дополнительных параметрах (в UI Superset есть поле для extra, например `{"connect_args":{"sslmode":"require"}}` — версии UI могут отличаться; при ошибке подключения смотрите логи контейнера Superset и документацию вашего провайдера).

4. **Data → Upload / SQL Lab** — выберите подключённую БД, создайте датасеты и дашборды.

Сеть: если Superset в Docker на вашем ПК, а Postgres только во внутренней сети Yandex — нужен **доступ по сети** (VPN, SSH-туннель, или Superset на ВМ в том же VPC, что и Managed PostgreSQL).

## «AI-расширения» в Superset — что реально

| Возможность | Где живёт |
|-------------|-----------|
| **MCP (Model Context Protocol)** — взаимодействие с данными/дашбордами через AI-клиенты | Документация Apache: *Using AI with Superset*, обычно **Superset 5.x+**, отдельная настройка сервера MCP и ключей к моделям |
| **Preset AI Assist** (text-to-SQL и т.п.) | Продукт **Preset** (коммерческий), не входит в чистый OSS-образ `apache/superset` |
| **Сообщество** (например, расширения к SQL Lab) | Отдельные проекты; проверяйте совместимость с вашей версией Superset |

То есть **поднять контейнер** — это только BI. «Умный» слой в духе готового text-to-SQL в коробке чаще всего требует **отдельного продукта** (Preset) или **ручной** настройки MCP / внешнего LLM по официальным гайдам Superset.

Ваше приложение уже использует **эвристики + опционально OpenAI** в Cloud Functions — это можно **параллельно** оставить для текстовой аналитики внутри «Пульса», а Superset — для классических SQL-дашбордов по тем же таблицам.

## Безопасность

- Не используйте учётку приложения с правами `INSERT/UPDATE` для Superset.
- `SUPERSET_SECRET_KEY` и пароли — только в `.env` или секретах оркестратора, не в git.
- Продакшен Superset лучше выносить за reverse-proxy с HTTPS и ограничением доступа.

## Образ и entrypoint

Используется `apache/superset:4.1.0`. Если при старте контейнер пишет, что нет `/usr/bin/run-server.sh`, откройте issue в Apache или смените тег образа на актуальный из [Docker Hub](https://hub.docker.com/r/apache/superset) и подправьте `entrypoint-local.sh` под новый образ.

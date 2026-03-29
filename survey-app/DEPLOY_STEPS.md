# Пульс: выкладка сайта по шагам

Делайте по порядку. После каждого шага можно написать ассистенту: **«Шаг N сделан»** — подскажем следующий.

Технические команды из корня **`survey-app`**:

```bash
chmod +x scripts/deploy-static-site.sh scripts/sync-object-storage.sh
./scripts/deploy-static-site.sh status   # проверка без ключей
./scripts/deploy-static-site.sh build    # только сборка
./scripts/deploy-static-site.sh sync     # только заливка (после export ключей)
./scripts/deploy-static-site.sh all        # сборка + заливка
./scripts/deploy-static-site.sh url        # URL сайта по имени бакета
```

Имя бакета по умолчанию читается из **`deploy.config.json`** (поле `bucket`), при отсутствии файла — из **`.youware.json`**. Либо задайте **`export YC_BUCKET=...`** перед `sync` / `all`.

Подробности и JSON политики бакета: **[OBJECT_STORAGE.md](OBJECT_STORAGE.md)**.

---

## Шаг 1. Консоль Яндекс.Облака

Войти в [console.yandex.cloud](https://console.yandex.cloud), выбрать **облако** и **каталог**, где будет бакет.

**Готово, если:** видите каталог без ошибок доступа.

---

## Шаг 2. Бакет Object Storage

**Object Storage** → создать бакет. Имя — латиница, глобально уникально (в `.youware.json` сейчас пример: `statisticsprimakov2` — можно своё).

**Готово, если:** бакет в списке.

---

## Шаг 3. Хостинг SPA

В настройках бакета: **хостинг статического сайта** — включить.  
Главная: **`index.html`**. Страница ошибки: **`index.html`** (важно для React Router).

**Готово, если:** консоль показывает URL вида `https://<бакет>.website.yandexcloud.net/`.

---

## Шаг 4. Публичное чтение

Политика бакета: разрешить всем **`s3:GetObject`** на `arn:aws:s3:::<имя-бакета>/*` (пример JSON в [OBJECT_STORAGE.md](OBJECT_STORAGE.md)).  
Либо при заливке использовать `export YC_OBJECT_ACL_PUBLIC_READ=1`.

**Готово, если:** понимаете, какой вариант выбрали (политика или ACL).

---

## Шаг 5. Сервисный аккаунт и ключи

Создать **сервисный аккаунт**, роль вроде **`storage.editor`** на каталог. Создать **статический ключ** (Access key ID + Secret). Секрет сохранить у себя, **не в git**.

**Готово, если:** есть `AWS_ACCESS_KEY_ID` и `AWS_SECRET_ACCESS_KEY`.

---

## Шаг 6. AWS CLI на компьютере

Установить AWS CLI (Mac: `brew install awscli`), проверить `aws --version`.

**Готово, если:** в терминале команда `aws` отвечает версией 2.x.

---

## Шаг 7. Проверка доступа к бакету

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION=ru-central1
aws s3 ls s3://ИМЯ_ВАШЕГО_БАКЕТА/ --endpoint-url https://storage.yandexcloud.net --region ru-central1
```

**Готово, если:** команда выполнилась без ошибки (пустой список или список объектов).

---

## Шаг 8. API URL для сборки (если нужно)

Если фронт на `*.website.yandexcloud.net`, а API на другом домене — при сборке задать базовый URL API:

```bash
export VITE_API_BASE='https://ваш-шлюз-или-функция...'
```

Если позже смените API — пересоберите (`build`) и снова `sync`.

**Готово, если:** знаете URL API или у вас один домен / прокси.

---

## Шаг 9. Сборка фронтенда

Из корня `survey-app`:

```bash
./scripts/deploy-static-site.sh build
```

(или вручную: `cd frontend && npm install && npm run build`)

**Готово, если:** есть папка `frontend/dist` с `index.html`.

---

## Шаг 10. Заливка в бакет

```bash
cd /путь/к/survey-app
export YC_BUCKET=имя-вашего-бакета   # если не совпадает с deploy.config.json
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION=ru-central1
# при необходимости: export YC_OBJECT_ACL_PUBLIC_READ=1
./scripts/deploy-static-site.sh sync
```

**Готово, если:** скрипт написал «Готово» и URL сайта.

---

## Шаг 11. Открыть сайт

В браузере: **`https://<бакет>.website.yandexcloud.net/`**  
Или: `./scripts/deploy-static-site.sh url` (при заданном `YC_BUCKET` или корректном `deploy.config.json`).

**Готово, если:** открывается админка / форма (см. ключ API на главной).

---

## Шаг 12. CORS (если API на другом домене)

На Cloud Function / API Gateway разрешить origin вашего сайта; в переменных функции — **`CORS_ORIGIN`** = URL сайта с `https://`.

**Готово, если:** запросы из браузера к API не падают на CORS.

---

## Повторные обновления сайта

После правок кода:

```bash
./scripts/deploy-static-site.sh all
```

(или `build` и `sync` отдельно, если ключи уже в текущей сессии терминала.)

# Запуск через Docker Compose

Проверка для жюри описана в [README](../../README.md). Эта страница — состав контейнеров.

Команды выполняются из корня репозитория. Сначала запусти Docker Desktop/Engine и проверь `docker info` и `docker compose version`. Для Compose локальная установка Node.js, Go и Python не требуется.

В корневом `.env` укажи `DEEPSEEK_API_KEY`. Модель и адрес берутся из `.env.example`: `deepseek-flash` и `https://api.deepseek.com`. Файл `ai-agent/.env` в Compose не подставляется. Не публикуй вывод `docker compose config` с настоящим ключом.

```bash
sh ops/docker/start-local.sh
```

Скрипт `ops/docker/start-local.sh` собирает сервисы последовательно и затем выполняет `up --no-build --wait`. Это позволяет запускать проект при выделенных Docker 4 ГБ памяти: в Compose 5 лимит `COMPOSE_PARALLEL_LIMIT` не ограничивает параллельные сборки Bake. При ошибке сборки скрипт останавливается, не запуская старые образы. Флаг `--parallel` включает общую параллельную сборку: `sh ops/docker/start-local.sh --parallel`. На Docker с 4 ГБ памяти она завершилась сбоем; для этого режима рекомендуются 16 ГБ выделенной памяти (не измеренный минимум). Ориентир первого запуска — 10–20 минут, в зависимости от сети и оборудования. Повторный последовательный запуск с готовым кэшем на проверенном Docker с 4 ГБ памяти занял 63 секунды.

Веб: http://127.0.0.1:5173/. В этой сборке чат ходит в Go и DeepSeek. Без ключа ответ модели не подменяется; агент возвращает 503 на `/health/ready`, поэтому `up --wait` завершится ошибкой. После заполнения ключа повтори команду запуска. Readiness не проверяет баланс и не вызывает LLM.

PostgreSQL поднимается первым. `migrate` применяет миграции и сиды. Обычный `down` сохраняет том, `down -v` удаляет данные.

Flask слушает в контейнере `agent` на порту 8001. MCP в режиме `go_http` слушает loopback:8002 и читает `http://go:8080`. На хост порты Python и PostgreSQL не публикуются. Секреты Go→Flask, MCP→Go и подписи делегаций разделены в `.env.example`.

## Проверка

```bash
docker compose ps
curl -fsS http://127.0.0.1:5173/
```

`sh ops/docker/check-agent.sh` делает платный запрос Go → Flask → DeepSeek → MCP → Go от профиля `olga`. Для маршрута жюри достаточно интерфейса.

## Сервисы

Профиль `hr` поднимает учебные HR-сайты и их API. Профиль `jira` добавляет Jira со своей базой. UI Jira — http://127.0.0.1:5189/. Портал доступов — 5190, Confluence — 5191. Остальные учебные инструменты — с 5192. Карта адресов: [corporate-services](corporate-services.md), [jira](jira.md), [доступы](access-portal.md), [Confluence](confluence.md).

Агент читает эти API и готовит черновик. Подтверждение в вебе описано в [service-actions](service-actions.md).

Остановка:

```bash
docker compose --profile hr --profile jira down
```

Публикация на сервере с паролем nginx описана в [server-deployment](server-deployment.md). Jira в этом же запуске открывается на http://127.0.0.1:5189/, портал доступов — на 5190, Confluence — на 5191.

`just external-check` запускает 24 сервиса на временном стенде и проверяет демовход, HTTP и доступ к базам при выключенном Buddy. Затем проверяет HTTP-вызовы из Buddy.

`PUBLIC_HR_ORIGIN` задаёт корпоративные ссылки в обеих сборках (web и hr-web). `PUBLIC_WEB_ORIGIN` становится `VITE_BUDDY_URL` в hr-web: относительные источники панели пояснения возвращают в Buddy, а не на одноимённый путь HR-сайта. Цели Docker web/hr-web и команды запуска сохранены.

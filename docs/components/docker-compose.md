# Запуск через Docker Compose

Проверка для жюри описана в [README](../../README.md). Эта страница — состав контейнеров.

Основные команды выполняются из корня репозитория через Docker Compose: подходят PowerShell и терминалы Linux/macOS, `sh` не требуется. Docker использует Linux-контейнеры. Сначала запусти Docker Desktop/Engine и проверь `docker info` и `docker compose version`. Для Compose локальная установка Node.js, Go и Python не требуется.

В корневом `.env` укажи `DEEPSEEK_API_KEY`. Модель и адрес берутся из `.env.example`: `deepseek-flash` и `https://api.deepseek.com`. Файл `ai-agent/.env` в Compose не подставляется. Не публикуй вывод `docker compose config` с настоящим ключом.

Сначала собери сервисы:

```bash
docker compose --profile hr --profile jira build
```

Только после успешной сборки запусти стенд:

```bash
docker compose --profile hr --profile jira up -d --no-build --wait --wait-timeout 900
```

Общая сборка может выполняться параллельно и требует достаточно памяти Docker. На 4 ГБ она завершилась ошибкой; для этого режима рекомендуются 16 ГБ выделенной памяти (не измеренный минимум).

При небольшом объёме памяти используется отдельный сборщик `ai-buddy-low-memory`
с `max-parallelism = 1` из `ops/docker/buildkitd-low-memory.toml`. Полная сборка
и запуск проверены с 4 ГБ памяти Docker, Compose 5.3.1 и Buildx 0.35.0.
[Создание и команды сборки](../../README.md#запуск-при-небольшом-объёме-памяти).
Он создаётся с драйвером `docker-container` и `default-load=true`, поэтому образы
попадают в локальный Docker Engine для `up --no-build`. Флаг `--builder` выбирает
его только для этой сборки, глобальные настройки не меняются. После сборки его
можно остановить через `docker buildx stop ai-buddy-low-memory`, сохранив кэш.
Этот путь не зависит от `sh` и от поддержки ограничений Compose в старом Buildx.
Настройка ограничивает одновременно выполняемые шаги BuildKit, а не задаёт
жёсткий лимит памяти отдельного компилятора. [Настройка BuildKit](https://docs.docker.com/build/buildkit/configure/#max-parallelism).

Ориентир первой сборки — 10–20 минут, в зависимости от сети и оборудования.
Отдельный сборщик использует собственный кэш; первые загрузки выполняются заново.

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

Внешние сайты используют gzip для JavaScript, CSS и SVG в `hr-web.conf`.
Файлы `/assets/` с восьмизначным хешем Vite кешируются на год; HTML,
неверсионированные файлы и API этот срок не получают. Парольная защита
наследуется и для кешируемых ресурсов. `TEST_NGINX=1 uv run --locked pytest tests/test_static_assets.py` из `ai-agent/` проверяет настоящий nginx в
одноразовом контейнере с тестовыми файлами; Python CI включает этот тест.
Проверка не запускает Buddy и не обращается к модели.

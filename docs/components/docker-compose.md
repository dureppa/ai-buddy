# Локальный запуск через Docker Compose

Compose использует DeepSeek API. Ollama, контейнер загрузки модели и том весов
удалены. Локальная LLM не скачивается. Docker скачивает обычные образы приложения,
Python, Go, nginx и PostgreSQL.

В корневом `.env` укажите DEEPSEEK_API_KEY, DEEPSEEK_MODEL=deepseek-flash и
DEEPSEEK_BASE_URL=https://api.deepseek.com; пример — `.env.example`. Файл
`services/ai-python/.env` сам по себе не подставляет значения в Compose.
Не публикуйте вывод `docker compose config` с реальным ключом.

```bash
docker compose --profile hr up -d --build --remove-orphans --wait --wait-timeout 900
```

Веб: http://127.0.0.1:5173/. Go API доступен через `/api/v1/`.
Чат, учебная оценка знаний и review согласий используют сервер. Остальные
baseline-экраны пока используют браузерное демо.

PostgreSQL поднимается первым. `migrate` применяет миграции и сиды с журналом
`schema_migrations`. Данные БД сохраняются в томе postgres. Обычный `down` их
сохраняет; `down -v` удаляет данные и не нужен для смены LLM.

Flask работает в контейнере agent; MCP использует его сетевой namespace и
слушает loopback:8002. Go вызывает `http://agent:8001`, MCP читает `http://go:8080`.
Python и PostgreSQL не публикуют порты на хосте. Секреты Go→Flask, MCP→Go и
подписи делегаций разделены в `.env.example`.

## Проверка

```bash
docker compose ps
curl -fsS http://127.0.0.1:5173/
sh docker/check-agent.sh
```

Последняя команда делает платный запрос через Go→Flask→DeepSeek→MCP→Go на
синтетическом профиле olga. Локального прогрева и скачивания модели нет.
Отсутствующий/неверный API-ключ даёт ошибку вместо demo-ответа.

## Внешние корпоративные сервисы

Профиль `hr` включает сайты 5181–5188 и Go API 8181–8188. Каждый HR API использует
отдельную БД. Согласия, документы и мероприятия подключены к серверу; остальные
пять сайтов пока работают на браузерных данных. [Подробности](corporate-services.md).

Для учебного маршрута выберите один профиль в Buddy и на сайте согласий,
предоставьте учебное согласие, спросите о подтверждении consent-news, отправьте
ответ в блоке проверки знаний на странице чата. Затем войдите наставником,
одобрите оценку и обновите статус стажёра. Глобальный этап стажировки не меняется.

```bash
docker compose --profile hr down
```

[Публикация на сервере](server-deployment.md) использует отдельный overlay с
паролем nginx; PUBLIC_HR_ORIGIN/PUBLIC_WEB_ORIGIN задают внешние ссылки при сборке.

## Jira

`docker compose --profile hr --profile jira up --build -d` добавляет самостоятельную БД, миграции и API Jira. UI на 5189, API внутри сети на 8189. [Настройки и ограничения CD](jira.md).

Статический фронт «Управление доступами» входит в hr-web на 5190. Своего API/БД пока нет; демозаявки хранятся в браузере. [Запуск и будущий контракт](access-portal.md).

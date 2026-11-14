# Серверное демо

Сценарий: Ubuntu/Docker Compose, DeepSeek API, публичный веб на порту 80 и
HR-сайты на 5181–5186. Приватные Go/Python/PostgreSQL API не публикуются.
Старый проект останавливается после резервного копирования и сохраняется для
отката; удаление его файлов и томов не требуется.

До сборки в корневом .env задаются DEEPSEEK_API_KEY, отдельные случайные DB/session/
AI/MCP/delegation secrets, PUBLIC_HR_ORIGIN=http://<server>,
PUBLIC_WEB_ORIGIN=http://<server>. Docker собирает ссылки для браузера по этим
origins. Веса локальной LLM не используются. Сборки на сервере 4 ГБ выполняются
последовательно: COMPOSE_PARALLEL_LIMIT=1.

`docker-compose.server.yml` открывает только веб-сайты и монтирует подготовленные
конфигурации nginx из `.deploy/`: web.conf, hr-web.conf, auth-map.conf, auth.conf,
htpasswd. Генерация секретов выполняется при развёртывании, эти файлы и .env
не входят в Git. Nginx сначала требует HTTP Basic, затем выдаёт HttpOnly-cookie
с отдельным случайным gate-токеном. Cookie позволяет API использовать собственный
Bearer в Authorization. Без Basic/cookie закрыты и страницы, и API всех сайтов.
При HTTP пароль/cookie не шифруются в сети; для постоянной публикации нужен
домен с HTTPS, либо SSH-туннель.

Запуск:

```bash
COMPOSE_PARALLEL_LIMIT=1 docker compose -f docker-compose.yml -f docker-compose.server.yml --profile hr up --build -d --wait --wait-timeout 900
```

Приёмка: `config --quiet` не выводит секреты; nginx config test; без авторизации
страницы и demo/session API возвращают 401; с Basic страница даёт 200 и cookie;
cookie вместе с API bearer позволяет получить данные согласий. Проверяются
health всех сервисов, URL возврата, отсутствие ссылок браузера на loopback.
Перезапуск сохраняет данные PostgreSQL. Платная генерация LLM не является
частью проверки публикации.

Ссылки на команду и чек-лист в источниках Go относительные. Публичный URL
согласий задаётся HR_CONSENTS_PUBLIC_URL из PUBLIC_HR_ORIGIN, поэтому ответы
агента и ссылки заданий не направляют браузер пользователя на localhost сервера.

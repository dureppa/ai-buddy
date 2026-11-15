# Серверное демо

Сценарий: Ubuntu/Docker Compose, DeepSeek API, публичный веб на порту 80 и
HR-сайты на 5181–5191. Приватные Go/Python/PostgreSQL API не публикуются.
Старый проект останавливается после резервного копирования и сохраняется для
отката; удаление его файлов и томов не требуется.

До сборки в корневом .env задаются DEEPSEEK_API_KEY, отдельные случайные DB/session/
AI/MCP/delegation secrets, PUBLIC_HR_ORIGIN=http://<server>,
PUBLIC_WEB_ORIGIN=http://<server>. Docker собирает ссылки для браузера по этим
origins. Веса локальной LLM не используются. Сборки на сервере 4 ГБ выполняются
строго по одному сервису скриптом ops/docker/build-server.sh: BuildKit Bake может
игнорировать COMPOSE_PARALLEL_LIMIT для независимых целей сборки.

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
sh ops/docker/build-server.sh
```

Приёмка: `config --quiet` не выводит секреты; nginx config test; без авторизации
страницы и demo/session API возвращают 401; с Basic страница даёт 200 и cookie;
cookie вместе с API bearer позволяет получить данные согласий. Проверяются
health всех сервисов, URL возврата, отсутствие ссылок браузера на loopback.
Перезапуск сохраняет данные PostgreSQL. Платная генерация LLM не является
частью проверки публикации.

Ссылки на команду и чек-лист в источниках Go относительные. Публичные URL
согласий, документов и мероприятий задаются HR_CONSENTS_PUBLIC_URL,
HR_DOCUMENTS_PUBLIC_URL и HR_EVENTS_PUBLIC_URL из PUBLIC_HR_ORIGIN, поэтому ответы
агента и ссылки заданий не направляют браузер пользователя на localhost сервера.

Серверный overlay задаёт restart=unless-stopped для долгоживущих контейнеров;
одноразовый migrate не перезапускается. После подготовки .deploy/ и .env
повторный запуск не меняет пароль или данные БД.

Для длинного случайного gate-токена nginx auth-map требует
`map_hash_bucket_size 128;` в http-контексте. Без авторизации ответ 401 не должен
выдавать gate-cookie. После входа проверяются и Basic, и последующие запросы API
с cookie + Bearer. `.deploy`, резервные копии и архив исходников исключены из
Docker build context, чтобы не передавать их сборщику вместе с кодом.

[Continuous delivery](continuous-delivery.md) обновляет отдельные source releases;
текущий код доступен через current. .env и nginx-пароль остаются постоянными.

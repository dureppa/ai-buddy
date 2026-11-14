# Локальный запуск через Docker Compose

## Живой агент и DeepSeek

Compose передаёт Go адрес Flask, MCP работает с Go HTTP backend. Flask слушает
контейнерный интерфейс, наружу порт AI не публикуется. Секреты разделены в
корневом .env.example. Для DeepSeek используйте корневой .env (или переменные shell):
AI_LLM_PROVIDER=deepseek, DEEPSEEK_API_KEY, DEEPSEEK_MODEL=deepseek-flash,
DEEPSEEK_BASE_URL=https://api.deepseek.com. Не публикуйте вывод compose config
с реальным ключом. Model-init пропускает загрузку весов при deepseek.

`docker compose --profile hr up --build -d` включает сервис согласий и сайт.
Веб-чат и сайт согласий собираются с VITE_API_ENABLED=true. Остальные экраны и
пять HR-сайтов остаются локальными демо. Для проверки: выбрать olga в Buddy и
на сайте согласий, дать учебное согласие, спросить о подтверждении consent-news,
отправить ответ в блоке проверки знаний на странице чата, войти наставником и
одобрить оценку, затем обновить статус стажёра. Глобальный этап не меняется.


Из корня репозитория, с запущенным Docker Desktop или Docker Engine с Compose v2:

```bash
docker compose up -d --build --wait --wait-timeout 900
docker compose ps
```

Откройте AI Buddy на `http://127.0.0.1:5173/`. Чат и учебный review используют Go/Flask/MCP, остальные baseline-экраны пока используют браузерное демо. По тому же адресу доступен Go API под `/api/v1/`. Прямой запрос к Flask ниже нужен только для отдельной диагностики.

PostgreSQL поднимается первым. Контейнер `migrate` применяет SQL-миграции Go и загружает синтетические данные, затем завершается. Каждая миграция и загрузка данных выполняются в транзакции и записываются в `schema_migrations`. `model` заканчивает работу после проверки или загрузки модели. Состояние PostgreSQL и модель Ollama сохраняются в именованных томах при остановке и обычном `docker compose down`. Удаление томов через `down -v` удалит эти данные.

На первом запуске Docker скачивает образы, а Ollama — веса модели. По умолчанию это Qwen3 4B на CPU, около 2,6 ГБ весов. Веб и Go доступны, пока модель загружается. Прогресс виден в `docker compose logs --tail=10 model`.

## Проверка

```bash
curl -fsS http://127.0.0.1:5173/
docker compose exec -T db psql -U aibuddy -d aibuddy -c 'SELECT id, display_name FROM profiles ORDER BY id'
sh docker/check-agent.sh
```

Последняя команда прогревает модель через Ollama, затем вызывает существующий Flask `/internal/v1/turns` с вопросом о наставнике. По умолчанию Python MCP отвечает из синтетического профиля `alex`; в JSON видны текст и ссылки. На медленном CPU после прогрева всё ещё возможен `AI_TIMEOUT`: у агента 25 секунд на весь ход, включая вызов инструмента и генерацию. Модель можно переопределить в `.env` через `OLLAMA_MODEL`.

Flask, MCP и Ollama используют один сетевой namespace Compose и слушают loopback внутри него. Для доступа к Flask используйте `docker compose exec`, как в проверочном скрипте. Порты PostgreSQL и Python на хосте не публикуются. [Сетевой режим в Compose](https://docs.docker.com/reference/compose-file/services/#network_mode)

## Внешние корпоративные сервисы

```bash
docker compose --profile hr up -d --build --wait --wait-timeout 900
```

Профиль включает шесть сайтов на портах `5181–5186` и существующие Go API на `8181–8186`. Каждое API создаёт отдельную БД в экземпляре PostgreSQL Compose и проверяет JWT основного Go API. Сайты пока используют собственные демонстрационные данные браузера. [Адреса и будущая интеграция](corporate-services.md)

Остановить весь проект вместе с профилем:

```bash
docker compose --profile hr down
```

Для локального запуска подходят значения по умолчанию. Чтобы переопределить порт веба, модель и параметры демо, скопируйте корневой `.env.example` в `.env`. При смене порта используйте тот же порт в адресе веба. Если пароль PostgreSQL меняется на уже созданном томе, поменяйте пароль роли и переменную согласованно. Для проверки конфигурации запустите `just compose-check`. CI проверяет обе конфигурации в job `repository`.

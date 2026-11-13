# Python-сервис AI Buddy

## Статус первого среза

Реализованы application factory Flask, внутренний HTTP-вход, проверка схем, ограниченный MCP-клиент и автоматические тесты. Production-подключение LLM и агентного цикла, оценка знаний, корпоративные prepare-tools и подключение Go ещё не реализованы. Сравнение двух циклов с локальной моделью вынесено в отдельный эксперимент ниже. Fake runner существует только в тестах; без реального runner readiness и валидный turn возвращают 503. Go, фронтенд и публичный contracts/openapi.yaml этим срезом не изменены.

Flask принимает будущие внутренние вызовы Go. Python управляет LLM/MCP; Go остаётся владельцем личности, прав, сохранённых фактов и переходов. Контракт ниже пока не подключён коллегами и не является публичным API браузера.

## Запуск

Из services/ai-python:

```bash
uv sync --locked
AI_SERVICE_TOKEN=local-service-token MCP_URL=http://127.0.0.1:8080/mcp uv run --locked flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Это локальный development-server. WSGI-развёртывание требует отдельной настройки до production; его здесь нет. `.env.example` содержит только пример без секретов; не использовать его значения для общей среды.

GET /health/live возвращает 200, если процесс работает. GET /health/ready возвращает 503 без конфигурации и production runner. Проверка не делает сетевых/платных вызовов и не гарантирует доступность внешнего MCP.

## Внутренний HTTP

POST /internal/v1/turns, Authorization: Bearer AI_SERVICE_TOKEN. Закрытый JSON: request_id/conversation_id — UUID; message — 1–4000 непустых символов; delegation_token — отдельный токен Go для MCP; history — до 20 user/assistant сообщений; optional page_context.url — http/https без query/fragment. Максимум тела 64 KiB. Сервисный токен и делегированный токен имеют разные назначения. SecretStr скрывает делегацию в стандартной сериализации, поэтому Go отправляет исходный токен отдельным полем доверенного запроса, не дампом Python-модели.

Ответ будущего runner: request_id, conversation_id, reply{text,references}. Идентификаторы задаются HTTP-обвязкой из проверенного входа. 400 — схема/JSON, 401 — авторизация, 413 — размер, 415 — тип содержимого, 503 — отсутствие runner/конфигурации, сбой или лимит. Детали исключений, токены и body провайдера не публикуются и не логируются. Существующий Go ChatReply не подменяется этой внутренней схемой.

## MCP

Официальный SDK 1.30.0, Streamable HTTP, отдельные клиенты на ход. Поддержаны search_knowledge и get_team_context с локальными закрытыми схемами. Другие имена, включая новые progress/evidence/prepare, не публикуются до согласования их контрактов. Вызов содержит доверенный request-id в _meta и bearer делегации в заголовке; модель их не выбирает.

Discovery ограничен четырьмя страницами. Результат до 32 KiB, тело транспорта до 1 MiB; редиректы запрещены. Локальная схема discovery сравнивается с удалённой без незначимых title/description. Результат проверяется Pydantic, двойное текстовое JSON-представление должно совпадать. Доменные FORBIDDEN/NOT_FOUND/CONTEXT_EXPIRED/TEMPORARILY_UNAVAILABLE сохраняются как безопасные коды; чужое message не показывается.

Лимиты Settings: 25 с на ход, 5 с на MCP-операцию, до 6 вызовов инструмента; автоматических повторов нет. Новые Settings можно передать application factory для теста/внутренней конфигурации. Сессии не переносятся между asyncio.run и не делят bearer между запросами. Входящий URL страницы не загружается.

## Файлы

- services/ai-python/ai_buddy/app.py — application factory, auth, health, HTTP и deadline.
- ai_buddy/config.py и schemas.py — конфигурация и проверяемые контракты.
- ai_buddy/mcp_client.py — SDK transport, discovery, каталог, проверка результатов, лимиты.
- ai_buddy/errors.py — безопасные коды.
- tests/test_app.py — HTTP-контракт и cleanup.
- tests/test_mcp.py — аргументы, результаты, ACL-коды, лимиты и transport.
- tests/test_mcp_integration.py — настоящий SDK client/server через Streamable HTTP в ASGITransport без сетевых сокетов и изменения Go; concurrent bearer/meta проверяются отдельно.

## Проверка

```bash
uv sync --locked
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy .
uv run --locked pytest --cov=. --cov-report=term-missing --cov-report=xml:coverage.xml --cov-fail-under=85
```

Существующая Python job CI и just python-check запускают эти тесты при наличии .py. Покрытие измеряется по прикладному ai_buddy, тесты/зависимости исключены, локальный gate 85%. Отчёт coverage.xml игнорируется Git. Это покрытие текущего каркаса, не качества LLM или всей системы.

[OpenSpec](../../openspec/README.md), [контракт первого среза](../../openspec/changes/implement-python-agent/foundation-scope.md), [план](../../openspec/changes/implement-python-agent/tasks.md). Следующий срез требует выбора LLM, согласования реальных API шести сервисов и полноценного agent runner; нынешние тесты не доказывают Go/UI/e2e интеграцию.

[Документация MCP-клиента](https://github.com/modelcontextprotocol/python-sdk/blob/v1.x/docs/client.md), [тестирование Flask](https://flask.palletsprojects.com/en/stable/testing/).

## Эксперимент LangChain / прямого цикла

Из services/ai-python: `uv sync --locked`, затем при уже работающем локальном Ollama с моделью `qwen3:4b-q4_K_M` выполнить `uv run --locked python -m experiments.compare`. Команда не скачивает модель и использует только 127.0.0.1:11434. Тестовые данные синтетические, tracing отключён. Файл experiments/comparison-guarded.json сохраняется по мере прогресса; исходный comparison-results.json сохраняется и переоценивается оценщиком 2.1. При следующем запуске итоговый guarded-отчёт будет перезаписан.

LangChain 1.5.0 и langchain-ollama 1.1.0 добавлены в dev-группу для запрошенного сравнения create_agent с обычным HTTP-циклом. Совместимость проверена на Python 3.13; manifest и lock обновлены вместе. Они не импортируются ai_buddy и не нужны production-каркасу. Это добавило 29 пакетов в dev-окружение, включая LangGraph транзитивно; отдельный LangGraph workflow не разрабатывался. Существующая Python job CI выполняет tests/test_agent_loops.py без весов и сети.

Оба цикла используют общий Gateway и его схемы. Адаптер create_agent через middleware исполняет MCP-вызовы; автоматическое подключение произвольного серверного каталога отсутствует. Лимиты эксперимента: 3 модельных вызова, 6 попыток инструментов, 90 с на ход. Рабочий deadline Flask остаётся 25 с; production runner не подключён. Локальная 4B-модель пока не рекомендована для готового пользовательского сценария.

[Условия эксперимента](../../openspec/changes/implement-python-agent/agent-loop-experiment.md), [результаты и решение](../../services/ai-python/experiments/README.md).

### Контроль ответов и источников

ai_buddy/answer_policy.py содержит общую per-turn политику для обоих экспериментальных циклов: реестр полученных id/URL, исключение подозрительных документов до передачи модели, проверка итоговых ссылок и безопасные ответы. Пустой поиск, подозрительный документ и конфликт источника имеют разные причины. Допускается одна попытка исправить цитату в рамках прежних 3 модельных вызовов; неудачный ответ не публикуется. В отчёте остаются raw_answer, draft_answers, итоговый answer и guard_events. Исключённые документы и ошибочные вызовы не создают права на цитирование.

Контроль подключён к экспериментальным циклам, production runner Flask по-прежнему отсутствует. Публичные контракты и MCP-схемы не изменены. [Повторное сравнение и ограничения защиты](../../services/ai-python/experiments/safety-fix.md). Обнаружение инструкций эвристическое; наличие полученного источника не доказывает правильность каждого утверждения модели. tests/test_answer_policy.py проверяет политику, обе оркестрации и оценщик; дополнительных зависимостей нет.

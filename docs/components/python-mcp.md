# Python MCP: demo и Go HTTP

Актуальный go_http поддерживает максимум 13 tools, включая get_service_context и prepare_service_action. Последний сохраняет только черновик: confirm отсутствует в MCP. Jira patch передаётся с exclude_unset на всех трёх границах; явный null очищает только исполнителя/срок. [Подключение](service-actions.md).

## Что читает Go

Go проверяет делегацию и отдаёт чтения из [SDD 004](../specs/004-agent-service-integration.md), [SDD 008](../specs/008-remaining-agent-services.md) и [SDD 009](../specs/009-agent-role-tools.md): прогресс, контекст задачи, свидетельство согласия, команда, знания, найм, увольнения, бенефиты, Jira и рабочие инструменты направления. Модель не получает профиль или токены аргументами. В Compose `GO_API_URL=http://go:8080`. Учебный корпус `demo` не подменяет ответ, если Go недоступен.


В Compose MCP запущен в режиме `go_http` и читает Go. Flask остаётся отдельным входом агента. SDK 1.30.0, stateless Streamable HTTP. Режим `demo` с учебным корпусом нужен только для изолированной проверки инструментов без Go. [Инструкция для Go](../integrations/go-python-mcp.md).

## Запуск

Рабочий запуск — [Docker Compose](docker-compose.md): `MCP_BACKEND=go_http`, `GO_API_URL=http://go:8080`.

Локально из `ai-agent` после `uv sync --locked`:

```bash
MCP_BACKEND=go_http GO_API_URL=http://127.0.0.1:8080 MCP_ADAPTER_SERVICE_TOKEN=replace-with-shared-adapter-secret uv run --locked python -m ai_buddy.mcp_server
```

Слушает только `127.0.0.1:8002`. Flask рядом запускается командой из [ai-python](ai-python.md) с `MCP_URL=http://127.0.0.1:8002/mcp`. В ход передаётся делегация Go, а не демотокен. `AI_SERVICE_TOKEN` и `MCP_ADAPTER_SERVICE_TOKEN` — разные секреты.

## Данные и ограничения

`ai_buddy/demo_corpus.json` — версионированный учебный корпус: шесть инструкций и два профиля команды. Все имена, контакты, кнопки и правила синтетические, источники is_demo=true. Поиск — простой лексический по основам слов с приоритетом заголовка/ключевых слов, не семантический RAG. Он не оценивает личный прогресс, не создаёт операции и не завершает этапы.

`mcp_server.py` — фабрика приложения, точные схемы из CONTRACTS, backend-интерфейс, demo backend, авторизация и CLI. `mcp_client.py` сохраняет безопасные MCP_TIMEOUT/RESULT_TOO_LARGE/INVALID_RESULT из сервера. Backend может быть явно заменён тестовой dependency; runtime не импортирует evals/experiments.

## Режим Go HTTP

`get_service_context` поддерживает `service=calendar`, относительный период либо
обе календарные даты. `prepare_service_action` поддерживает `create_calendar_event`.
Это те же внутренние POST-маршруты, с прежней делегацией, read_only и лимитами.
Само создание через MCP недоступно: нужен confirm владельца на сайте.
[Календарь и контракты](calendar.md).

`GO_API_URL` — только фиксированный origin. HTTP допускается для localhost/127.0.0.1/::1, для других адресов нужен HTTPS; запрещены userinfo, пути, query и fragment. Новых библиотек нет. Настройки считываются из окружения; .env.example — образец, файл .env автоматически не загружается. MCP слушает только 127.0.0.1:8002; контейнерное/удалённое развёртывание и полноценный OAuth остаются отдельной задачей.

Flask запускается командой из [ai-python](ai-python.md) с `MCP_URL=http://127.0.0.1:8002/mcp`. В `delegation_token` передаётся короткоживущая делегация Go. `AI_SERVICE_TOKEN` и `MCP_ADAPTER_SERVICE_TOKEN` — разные секреты.

Каждый MCP HTTP-запрос проверяет делегацию через POST /internal/v1/ai/context/resolve. Активный контекст содержит subject, UUID запроса/диалога, allowed_tools, UTC-срок и отдельный api_token; исходный bearer не пересылается в ресурсные API. Discovery учитывает разрешения, tools/call дополнительно проверяет request-id из _meta, TTL и аргументы. ContextVar изолирует параллельных пользователей и сбрасывается при завершении/отмене. Кеширования делегаций нет; Go отвечает за привязки и актуальные ACL на каждом чтении.

Поиск вызывает POST /internal/v1/ai/knowledge/search, команда — GET /internal/v1/ai/team-context без тела/query. Каждый исходящий HTTP-запрос имеет отдельный ограниченный client/stream, без cookie persistence, retries, redirects и env proxies. Resolve ограничен 1 с/16 KiB, чтение — 2,5 с/32 KiB и остатком TTL; deadline включает всё чтение тела. Сжатие не принимается. Итоговый MCP-result по-прежнему ≤32 KiB, неверный JSON/схема/дубли ключей/сочетание status-code не становятся пустыми данными.

HTTP timeout/сеть дают TEMPORARILY_UNAVAILABLE, истечение TTL — CONTEXT_EXPIRED, формат — INVALID_RESULT, размер — RESULT_TOO_LARGE. Redirect/неожиданный статус/500 — TOOL_ERROR. Согласованные доменные ошибки сохраняются, исходные тексты Go не передаются. Resolve inactive/expired даёт HTTP 401 MCP, неисправный resolve — 503; клиентский boundary классифицирует их как MCP_UNAVAILABLE.

GET /health/live в go_http отвечает mode=go_http, go_connected=null: проверяется жизнь процесса, доступность Go не опрашивается и не обещается. Недоступность Go не включает demo.

Bearer проверяется до handshake/discovery/данных; Host/Origin ограничены loopback, access log выключен. Тело ≤64 KiB, полный tool result ≤32 KiB, backend timeout ≤4 с при клиентском budget ≤5 с. Ошибки не раскрывают exception/body/token. Подключение к Go не подменяется demo автоматически.

Прямые зависимости Starlette 1.10.0 и Uvicorn 0.54.0 объявлены явно, поскольку этот код импортирует ASGI routing/server; эти версии уже были в lock как зависимости MCP SDK. Flask не заменён.

## Проверки

`uv run --locked pytest tests/test_mcp_server.py`: настоящий SDK handshake/list/call через ASGITransport, обе функции/пустой поиск, auth/Host/Origin, неверные args, ошибки/таймаут/размер и параллельная изоляция профилей. Это не Go integration и не оценка правильности LLM. Общие проверки: Ruff, mypy, pytest-cov. Живой запуск по TCP и LLM-eval фиксируются отдельно.

[Границы OpenSpec](../../openspec/changes/implement-python-agent/mcp-demo-scope.md).

HTTP-адаптер: `uv run --locked pytest tests/test_go_http.py` проверяет оба HTTP-read, реальные SDK initialize/list/call, Flask → SDK → Go HTTP mock, изоляцию/отзыв/TTL/метаданные, раздельные credentials, формат/размер/status/таймауты/chunks/cancellation. Внешний Go, БД, LLM и holdout этим набором не запускаются. [Границы HTTP-адаптера](../../openspec/changes/implement-python-agent/go-http-adapter-scope.md).

## Серверные доступы и Confluence (следующий реализованный срез)

[SDD 007](../specs/007-agent-access-confluence.md) расширяет прежние пять Go/MCP-чтений:
get_access_catalog, get_access_requests, get_knowledge_page и submit_access_request.
Максимум — 13 tools. В рабочем Go-контуре `submit_access_request` не выдаётся
модели: доступ подготавливается через `prepare_service_action(request_access)`,
а отправляется на странице подтверждения. Старая схема submit сохранена для
совместимости тестовых adapters. Ответ с параметрами повторно читает каталог;
разрешение на прямую запись текущего turn не требуется.
Два новых инструмента чтения/подготовки доступны при настройке serviceactions.
Маршруты Go: GET /internal/v1/ai/access/catalog, GET/POST /internal/v1/ai/access/requests,
POST /internal/v1/ai/knowledge/page. Используются прежние resource-token,
X-Request-ID, TTL и ACL. local_demo остаётся с двумя read tools.
Поиск включает сохранённые Confluence-страницы продукта и общие гайды; заявки
портала/чата общие в PostgreSQL. Повторы идемпотентны; receipt из БД, approved
не является granted. Исторические ограничения выше относятся к предыдущим срезам.

SDD 009 добавляет get_work_tools и get_work_tool_context; максимум grants — 13.
Каталог соответствует текущему профилю, контекст читает один самостоятельный
рабочий сервис и возвращает записи с якорями. Новых выполняющих tools нет.
Длинные данные ограничены и маркируются has_more/truncated. local_demo прежний.

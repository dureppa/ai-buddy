# Python MCP: demo и Go HTTP

Актуальный go_http поддерживает максимум 13 tools, включая get_service_context и prepare_service_action. Последний сохраняет только черновик: confirm отсутствует в MCP. Jira patch передаётся с exclude_unset на всех трёх границах; явный null очищает только исполнителя/срок. [Подключение](service-actions.md).

## Дополнение: живой Go и личный прогресс

Go реализует resolve и пять чтений из [SDD 004](../specs/004-agent-service-integration.md).
Go HTTP backend дополнен get_onboarding_progress, get_task_context(task_id),
get_task_evidence(task_id); последняя функция читает актуальные согласия из HR API.
GET /internal/v1/ai/onboarding/progress, POST task-context/task-evidence находятся
под /internal/v1/ai/onboarding/. Все результаты содержат references.
Модель не получает профиль или токены как аргументы tools.
ActiveContext допускает до 13 grants. В локальном demo выдаются только два исходных
инструмента; новые данные не подменяются фикстурами. Для Compose GO_API_URL может
быть http://go:8080 — это единственное дополнение к прежним HTTP loopback origins.


Реализован отдельный сервер с двумя инструментами search_knowledge/get_team_context. SDK 1.30.0, stateless Streamable HTTP, JSON-ответы; Flask остаётся отдельным HTTP-входом агента. Доступны явные backend-режимы demo и go_http. Python HTTP-адаптер проверен на моках; настоящие Go endpoints и сквозной Go/UI-маршрут здесь не проверены. Шесть бизнес-интеграций не добавлены этими двумя чтениями. [Инструкция для Go](../integrations/go-python-mcp.md).

## Запуск

В [Docker Compose](docker-compose.md) MCP запускается в режиме demo и использует синтетический корпус.

Из `ai-agent`, после `uv sync --locked`:

```bash
MCP_DEMO_ENABLED=true MCP_DEMO_TOKEN=local-demo-token MCP_DEMO_PROFILE=alex uv run --locked python -m ai_buddy.mcp_server
```

Слушает только `127.0.0.1:8002`. Проверка: GET `http://127.0.0.1:8002/health/live` → mode=local_demo, go_connected=false. Для MCP нужен `Authorization: Bearer local-demo-token`. Другой профиль demo — nina; профиль выбирается при запуске, не аргументом LLM. Токен примера локальный, не использовать его в общей среде. Сервер не запускается без явного включения/непустого секрета.

Для Flask в другом терминале:

```bash
AI_AGENT_ENABLED=true AI_SERVICE_TOKEN=local-flask-token OLLAMA_MODEL=qwen3:4b-q4_K_M MCP_URL=http://127.0.0.1:8002/mcp uv run --locked flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Ollama и установленная модель нужны отдельно. В TurnRequest передать delegation_token, равный выбранному локальному MCP_DEMO_TOKEN; bearer вызова Flask — AI_SERVICE_TOKEN. Это **demo-привязка**, не реализация будущей делегации Go с TTL/audience. Запросы двух клиентов могут выполняться параллельно; контекст не хранится в глобальном mutable user field. Сервер не требует установленной LLM для прямых вызовов инструментов.

## Данные и ограничения

`ai_buddy/demo_corpus.json` — версионированный учебный корпус: шесть инструкций и два профиля команды. Все имена, контакты, кнопки и правила синтетические, источники is_demo=true. Поиск — простой лексический по основам слов с приоритетом заголовка/ключевых слов, не семантический RAG. Он не оценивает личный прогресс, не создаёт операции и не завершает этапы.

`mcp_server.py` — фабрика приложения, точные схемы из CONTRACTS, backend-интерфейс, demo backend, авторизация и CLI. `mcp_client.py` сохраняет безопасные MCP_TIMEOUT/RESULT_TOO_LARGE/INVALID_RESULT из сервера. Backend может быть явно заменён тестовой dependency; runtime не импортирует evals/experiments.

## Режим Go HTTP

После реализации Go API по инструкции запусти MCP из ai-agent:

```bash
MCP_BACKEND=go_http GO_API_URL=http://127.0.0.1:8080 MCP_ADAPTER_SERVICE_TOKEN=replace-with-shared-adapter-secret uv run --locked python -m ai_buddy.mcp_server
```

GO_API_URL — только фиксированный origin. HTTP допускается для localhost/127.0.0.1/::1, для других адресов нужен HTTPS; запрещены userinfo, пути, query и fragment. Новых библиотек нет. Настройки считываются из окружения; .env.example — образец, файл .env автоматически не загружается. MCP слушает только 127.0.0.1:8002; контейнерное/удалённое развёртывание и полноценный OAuth остаются отдельной задачей.

Flask запускается прежней командой с MCP_URL=http://127.0.0.1:8002/mcp. В delegation_token передаётся выпущенная Go короткоживущая делегация, а не MCP_DEMO_TOKEN. AI_SERVICE_TOKEN (Go → Flask) и MCP_ADAPTER_SERVICE_TOKEN (MCP → Go resolve) — разные секреты.

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
Максимум — 13 tools; submit_access_request объявляется только при AccessIntent текущего turn.
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

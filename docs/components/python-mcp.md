# Python MCP: локальный demo

Реализован отдельный сервер с двумя инструментами search_knowledge/get_team_context. SDK 1.30.0, stateless Streamable HTTP, JSON-ответы; Flask остаётся отдельным HTTP-входом агента. Go HTTP-адаптер, resolve-контекст и шесть бизнес-интеграций пока не реализованы. [Инструкция для Go](../integrations/go-python-mcp.md) описывает их будущий HTTP-контракт.

## Запуск

Из `services/ai-python`, после `uv sync --locked`:

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

Bearer проверяется до handshake/discovery/данных; Host/Origin ограничены loopback, access log выключен. Тело ≤64 KiB, полный tool result ≤32 KiB, backend timeout ≤4 с при клиентском budget ≤5 с. Ошибки не раскрывают exception/body/token. Подключение к Go не подменяется demo автоматически.

Прямые зависимости Starlette 1.10.0 и Uvicorn 0.54.0 объявлены явно, поскольку этот код импортирует ASGI routing/server; эти версии уже были в lock как зависимости MCP SDK. Flask не заменён.

## Проверки

`uv run --locked pytest tests/test_mcp_server.py`: настоящий SDK handshake/list/call через ASGITransport, обе функции/пустой поиск, auth/Host/Origin, неверные args, ошибки/таймаут/размер и параллельная изоляция профилей. Это не Go integration и не оценка правильности LLM. Общие проверки: Ruff, mypy, pytest-cov. Живой запуск по TCP и LLM-eval фиксируются отдельно.

[Границы OpenSpec](../../openspec/changes/implement-python-agent/mcp-demo-scope.md).

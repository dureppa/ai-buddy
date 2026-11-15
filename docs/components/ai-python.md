# Python-сервис AI Buddy

Flask принимает ход от Go, вызывает DeepSeek и инструменты MCP, возвращает текст и ссылки. Модель не выполняет запись в корпоративный сервис. Черновик готовит `prepare_service_action`, человек подтверждает его в вебе. Контракты: [service-actions](service-actions.md), [SDD 004](../specs/004-agent-service-integration.md), [SDD 008](../specs/008-remaining-agent-services.md).

## Запуск

В Compose сервис `agent` стартует с `AI_LLM_PROVIDER=deepseek`, моделью `deepseek-flash` и `MCP_URL=http://127.0.0.1:8002/mcp`. Ключ берётся из `DEEPSEEK_API_KEY`. Без ключа или при ошибке провайдера ход завершается безопасной ошибкой, учебный ответ не подставляется.

Локально из `ai-agent` после `uv sync --locked`:

```bash
AI_AGENT_ENABLED=true \
AI_LLM_PROVIDER=deepseek \
DEEPSEEK_API_KEY=ключ \
DEEPSEEK_MODEL=deepseek-flash \
DEEPSEEK_BASE_URL=https://api.deepseek.com \
AI_SERVICE_TOKEN=local-service-token \
MCP_URL=http://127.0.0.1:8002/mcp \
uv run --locked flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Рядом должен работать MCP в режиме `go_http`, как в [python-mcp](python-mcp.md). Это development server.

`GET /health/live` проверяет процесс. `GET /health/ready` проверяет настройки выбранного провайдера и наличие runner, без сетевого вызова модели.

## Ход

`POST /internal/v1/turns`, `Authorization: Bearer AI_SERVICE_TOKEN`. Go до этого вызова проверяет пользователя и владельца диалога. В модель не передаются служебный bearer и токен делегации.

Ответ 200 содержит `reply.text` и ссылки, собранные из реально полученных источников. Сырой ответ модели, цепочка рассуждений и вывод инструментов наружу не отдаются.

После начала обработки сбой возвращается как 503 с безопасным кодом: `NOT_READY`, `AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_INVALID_RESPONSE`, `MCP_UNAVAILABLE`, `MCP_TIMEOUT`, `AGENT_LIMIT_REACHED` и другие коды границы MCP. Автоматических сетевых повторов нет. Общий бюджет хода — до 25 секунд, до 3 генераций и 6 попыток инструментов.

## Файлы

- `app.py` — Flask, авторизация, выбор runner.
- `agent.py`, `runner.py` — цикл, лимиты, карточки источников.
- `deepseek.py`, `provider.py` — вызов DeepSeek.
- `mcp_client.py`, `mcp_server.py`, `go_http.py` — MCP и HTTP к Go.
- `answer_policy.py` — проверка источников.
- `service_schemas.py` — схемы чтений и черновиков.
- `assessment.py` — отдельная оценка учебного ответа, не шаг основного чата.

Каталог инструментов направления читается через `get_work_tools` и `get_work_tool_context`. Эти вызовы только читают данные. [SDD 009](../specs/009-agent-role-tools.md).

Проверки: `just python-check` из корня или команды Ruff, mypy и pytest из [engineering](../engineering.md). Покрытие этого контура — в [coverage](../coverage.md).

## Пояснение выделенного текста

Режим пояснения получает PageContext.selection, читает конкретный материал через прежние MCP tools и отвечает краткими пунктами. Write-tools исключены, неподдерживаемый вызов отвергается. Пустой поиск допускает явно общее объяснение термина; правила обычного чата и проверки цитат сохраняются.

[Сценарий и ограничения](../specs/010-selection-explanation.md).

## Development и уточнение

[Agent-v2](../../ai-agent/evals/agent-v2/README.md) сохраняет 25 development-кейсов с 11 контрактами исходного snapshot. Новые get_work_tools/get_work_tool_context из SDD 009 не объявляются покрытыми этим историческим набором. Manifest фиксирует свой набор схем, отчёт отдельно фиксирует весь текущий runtime-каталог.

Runtime onboarding-v5.1-clarify прямо просит значения недостающих параметров, сохраняет уточнение после recovery и исправляет только цитаты при repair. На сайте изменение доступно после успешного деплоя Python; fixtures не подключают данные Go/UI. [Сохранённые trials](../../ai-agent/evals/reports/development-v2-20261115.md) относятся к snapshots до реорганизации; их hashes/ответы не переписываются.

[Спецификация уточнения и development](../specs/010-agent-clarification-and-development.md).

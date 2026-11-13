# Python-сервис AI Buddy

## Текущее состояние

Flask умеет выполнять реальный прямой цикл через локальную Ollama и SDK MCP: получить контекст команды/инструкции, сформировать ответ и проверить ссылки. Включается явно, фиктивный runner не активируется. Код сервиса не импортирует LangChain/LangGraph/experiments; эти зависимости остались только для сравнения двух подходов.

Поддержаны MCP search_knowledge и get_team_context, а также отдельный POST /internal/v1/assessments для оценки знаний с версиями, критериями и обязательным review наставника. Контракт и отказы assessment проверены; локальная Qwen3 4B не прошла смысловую development-приёмку. Go → Python, Go MCP, сохранение assessment/progress/evidence, шесть корпоративных tools и переходы этапов пока не реализованы. [Готовность пользовательского сценария](../../openspec/changes/implement-python-agent/scenario-status.md).

## Локальный запуск

Из services/ai-python:

```bash
uv sync --locked
# В отдельном терминале, если Ollama ещё не работает:
OLLAMA_NO_CLOUD=1 ollama serve
```

Проверь `ollama list`: модель qwen3:4b-q4_K_M должна быть уже установлена. Сервис не скачивает веса. Ollama требуется запускать с отключённым облаком; Python обращается только к настроенному loopback origin. Контекст 4096, thinking=false, температура 0, seed 42, максимум ответа 384 токена для чата и 768 для assessment. Холодная загрузка может занять существенную часть бюджета: readiness её не запускает.

Нужен отдельный совместимый MCP-сервер с закрытыми схемами [первого среза](../../openspec/changes/implement-python-agent/foundation-scope.md). Адрес ниже — пример будущего Go MCP; наличие Go HTTP API само по себе не означает наличие MCP.

```bash
AI_AGENT_ENABLED=true OLLAMA_MODEL=qwen3:4b-q4_K_M AI_SERVICE_TOKEN=local-service-token MCP_URL=http://127.0.0.1:8080/mcp uv run --locked flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Это development server. Production WSGI-развёртывание ещё не настроено. Настройки перечислены в [.env.example](../../services/ai-python/.env.example); значения токенов там примерные. uv создаёт .venv; команда `uv sync --locked --no-dev` достаточна для runtime без LangChain.

Без AI_AGENT_ENABLED=true сохраняется 503/AI_UNAVAILABLE. При включении без OLLAMA_MODEL — 503/NOT_READY. GET /health/live проверяет процесс; GET /health/ready проверяет локальную конфигурацию и наличие runner, без сетевых вызовов. Даже ready=true не обещает, что модель установлена или MCP доступен: это проверяется запросом/smoke.

## Внутренний HTTP

POST /internal/v1/turns, Authorization: Bearer AI_SERVICE_TOKEN. Закрытый JSON: request_id/conversation_id — UUID; message — 1–4000 непустых символов; delegation_token — отдельный токен Go для MCP; history — до 20 сообщений user/assistant по 4000 символов; optional page_context.url — http/https без query/fragment. Тело ≤64 KiB. Пользователь и владение диалогом проверяются Go до этого вызова. Публичный Go ChatReply не менялся.

История передаётся модели без system-ролей и без переноса реестра источников из прошлого хода. URL передаётся как непроверенный контекст: сайт не загружается, DOM агент не видит. MCP bearer и request_id не передаются модели.

Ответ 200: request_id, conversation_id из входа и reply{text,references}. Ссылки строятся кодом из реально процитированных допущенных id/URL, максимум 5 карточек. Сырые ответы, черновики, chain-of-thought, токены и tool output не публикуются. Пустая база знаний и исключённый документ дают безопасный содержательный ответ 200 без выдуманного успеха.

400 — схема/JSON, 401 — сервисная авторизация, 413 — размер тела, 415 — Content-Type. После начала обработки 503 с безопасным code:

| Причина | code |
| --- | --- |
| Нет обязательной конфигурации | NOT_READY |
| Выключен runner, сеть Ollama/HTTP-сбой/нет модели | AI_UNAVAILABLE |
| Таймаут LLM либо общего хода | AI_TIMEOUT |
| Ollama вернула 429 | AI_RATE_LIMITED |
| Неверная структура/роль, пустой/слишком большой или незавершённый ответ | AI_INVALID_RESPONSE |
| MCP недоступен/просрочен/несовместим/отказ ACL | MCP_UNAVAILABLE, MCP_TIMEOUT, INCOMPATIBLE_SCHEMA, FORBIDDEN и другие безопасные коды SDK boundary |
| Исчерпан бюджет | AGENT_LIMIT_REACHED |

Технический/ACL-сбой MCP прекращает runtime до следующей генерации. Автоматических сетевых повторов нет. Общий deadline включает соединение, discovery, генерацию, инструменты и cleanup. Параметры: AI_TURN_TIMEOUT ≤25 с, AI_MODEL_TIMEOUT ≤25 с (по умолчанию 20); MCP — 5 с. До 3 генераций и 6 tool-попыток; одна корректировка цитаты в том же бюджете. Пакет выше остатка бюджета не исполняется частично.

Запрос и ответ Ollama ограничены 64 KiB; превышение запроса даёт INVALID_REQUEST до отправки. Код не обрезает историю/последний вопрос. Это ограничение байтов, не подсчёт токенов: внутреннее усечение длинного контекста Ollama не контролируется токенизатором в этом срезе. Длинные диалоги требуют отдельного управления контекстом.

## MCP и контроль источников

Официальный SDK 1.30.0, Streamable HTTP, отдельные MCP/LLM-клиенты на ход и один event loop. MCP получает только свой делегированный bearer и request-id в _meta. Discovery ≤4 страниц, tool result ≤32 KiB, тело MCP-транспорта ≤1 MiB, редиректы запрещены. Схемы проверяются локально, текстовое JSON-представление не должно расходиться со structuredContent. Другие инструменты не включаются автоматически.

Обнаруженные метаинструкции в документах и метаданных исключаются до передачи LLM. Пустой поиск, подозрительный документ и конфликт id имеют разные безопасные ответы. Реестр id/URL изолирован на ход; ошибочный/исключённый результат не даёт источника. Неизвестная ссылка либо отсутствие цитаты при полученных источниках допускает одну корректировку; повторная ошибка заменяет весь ответ безопасным сообщением. Проверка эвристическая и не гарантирует защиту от всех перефразировок или правильность каждого утверждения по полученной ссылке.

Диагностика содержит только request-id, имя модели, версию prompt, счётчики, длительность и безопасный исход. История, токены, документы и provider body по умолчанию не логируются. Сырые ответы сохраняются только явными синтетическими экспериментами, не runtime endpoint.

## Файлы и проверки

- ai_buddy/app.py — Flask/auth/HTTP/deadline и выбор runner.
- assessment.py — закрытые snapshot/результат, отдельный prompt, проверка критериев/цитат и рекомендация для наставника; tests/test_assessment.py — контракт и необходимые отказы.
- evals/knowledge-v1.json — черновая разметка оценивания; experiments/assessment_eval.py — отдельный live CLI, не часть pytest.
- agent.py — общий прямой цикл, prompt, per-turn state, лимиты и финализация; experiments переиспользует этот код.
- ollama.py — native HTTP, проверка ответов и безопасные коды провайдера.
- runner.py — связь контракта TurnRequest с циклом, карточки источников и безопасная диагностика.
- mcp_client.py — SDK/Gateway; answer_policy.py — контроль источников/инструкций; config.py/schemas.py — настройки и контракты.
- tests/test_runtime.py — необходимые runtime-регрессии: вход Flask → runner, история/изоляция, провайдер/MCP/таймауты, cleanup, отсутствие частичного пакета tools и настоящий MCP-протокол. Старые тесты auth/схем/политики не дублировались.

```bash
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy .
uv run --locked pytest --cov=. --cov-report=term-missing --cov-report=xml:coverage.xml --cov-fail-under=85
```

Существующая Python job CI подхватывает тесты. Coverage считается по Python-коду, включая experiments и ручной smoke CLI; тесты/зависимости исключены. Локальный gate 85% сохраняет запас к требованию >80%. Пустые функции и косметические проверки ради процента не добавлялись. Отчёт coverage.xml игнорируется Git. Полный just check локально не запускался, Go/UI проверит CI.

## Живая проверка

`uv run --locked python -m experiments.flask_smoke` требует установленную локальную модель и работающий Ollama. Используются настоящий Flask test client, native Ollama и SDK Streamable HTTP на синтетическом ASGI MCP; внешний Go MCP для этой команды не нужен. Сервер-мок активируется только в CLI, не подставляется приложением автоматически. Команда сохраняет [flask-smoke.json](../../services/ai-python/experiments/flask-smoke.json): наставник 9,233 с, пустые знания 4,658 с, исключение заражённого документа 3,406 с; везде 200. Прогрев 19,637 с вынесен отдельно. Это не Go/UI/e2e и не доказательство готовности полного онбординга.

[OpenSpec runtime-среза](../../openspec/changes/implement-python-agent/flask-runner-scope.md), [сравнение оркестрации и ограничения](../../services/ai-python/experiments/safety-fix.md), [Ollama chat API](https://docs.ollama.com/api/chat), [таймауты HTTPX](https://www.python-httpx.org/advanced/timeouts/).

Для подключения коллегой: [Go → Python и два MCP-инструмента](../integrations/go-python-mcp.md), [схемы и примеры JSON](../integrations/go-python-mcp.examples.json).

## Оценка знаний и качество

[Контракт assessment для Go](../integrations/knowledge-assessment.md), [JSON Schema и примеры](../integrations/knowledge-assessment.examples.json). GET /health/ready/assessments проверяет конфигурацию этого режима без зависимости от MCP_URL; результат оценки не завершает этап.

[Черновой эталонный набор](../../services/ai-python/evals/README.md): 6 development и 2 candidate holdout. Разметка требует проверки команды. [Live-прогон](../../services/ai-python/experiments/assessment-quality.md) v3: 0/4 модельных случаев прошли, два rule guards прошли отдельно. При ошибке нужен ручной review. Полный общий набор 20/10 и выбор модели ещё не завершены; coverage не доказывает смысловую точность.

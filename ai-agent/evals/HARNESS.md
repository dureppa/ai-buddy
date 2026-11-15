# Общий development eval-harness

Реализованы `evals.harness` и `evals.review`. Две явно выбираемые версии development: agent-v1 (20 кейсов, 18 исполнимы и 2 blocked) и [agent-v2](agent-v2/README.md) (25 текущих кейсов). CLI не имеет параметра holdout и не загружает его. Исходный agent-v1 и holdout не меняются; миграция ожиданий документирована в agent-v2. Human approval набора по-прежнему не выполнен.

## Запуск

Из `ai-agent`. Живые запросы требуют явного `--allow-live-llm`.
DeepSeek использует существующий production transport; Ollama для него не нужна.
Секретный DEEPSEEK_API_KEY задаётся в окружении, а не аргументом команды.
API-ключ и реальные service/MCP-настройки в отчёт не записываются; service/MCP
внутри harness всегда синтетические. `.env` автоматически не загружается.

```bash
uv run --locked python -m evals.harness --provider deepseek --model deepseek-flash --dataset agent-v2 --allow-live-llm
```

Это реальные запросы к выбранной LLM, возможна тарификация. В этом блоке они
не запускались. Для локальной модели нужна работающая Ollama (`OLLAMA_NO_CLOUD=1`):

```bash
uv run --locked python -m evals.harness --provider ollama --model qwen3:4b-q4_K_M --allow-live-llm
```

Используются настоящий Flask test client, текущий DirectRunner/provider и production-фабрика MCP в режиме go_http с синтетическим authenticator/backend. MCP SDK работает через ASGITransport внутри процесса; настоящий Go/MCP HTTP и БД не вызываются. Каталог — все 13 CONTRACTS, кроме submit_access_request без явного permission `access:submit` в fixture context. Это тестовая выдача разрешений, не проверка Go AccessIntent/ACL. Поля личности и ожидаемые calls/facts не передаются LLM.

Backend harness выдаёт синтетические fixtures соответствующего кейса, сохраняет реально вызванные tools/args/results и явно инъецирует предусмотренные отказы. Он **не измеряет качество реального поиска Go или demo-поиска**: документы сценария заданы заранее. Он не вызывает инструменты по эталонному плану вместо модели. Смысл запроса query проверяется отдельно assisted/human review, совпадение имени tool само по себе не означает правильный выбор данных.

Повторяющиеся non-search fixtures выбираются по нормализованным аргументам;
две fixtures одного инструмента с одинаковыми аргументами отвергаются, как и
несколько search fixtures (поиск остаётся scripted, не retrieval benchmark).
Схемы ready-fixtures проверяются до первого запроса к LLM. При неизвестном
инструменте/аргументах нет успешного fallback.

`current-tools.json` содержит синтетические контрактные примеры всех 13 tools.
`tests/test_current_harness.py` проводит их через Flask/DeepSeek wire format/SDK
с mock LLM. Это не новый размеченный golden-набор и не результат живой LLM.
CLI по умолчанию сохраняет agent-v1 для совместимости; --dataset agent-v2 выбирает текущие fixtures и дополнительные действия.
В agent-v1 dev-17/18 остаются blocked. В agent-v2 они явно заменены проверками текущих progress/task/evidence схем, без объявления полного stage-контракта реализованным.
Новые routing/действия могут давать расхождения со старой разметкой: их надо
анализировать, а не ослаблять эталоны. Нельзя выдавать 18 кейсов за приёмку всех tools.

Gold verdicts/ограничения не передаются агенту. Assessment получает свою рубрику знаний, но не ожидаемые pass/fail. Сервисные токены/делегация не сохраняются в model trace; данные в отчёте синтетические. Thinking/скрытые рассуждения исключаются. Полные model requests сохраняются только этим явным локальным экспериментом; production-логи не расширены.

## Результат

Каждый запуск пишет отдельный `reports/development-<UTC timestamp>.json`, complete=false до конца, прогресс — после каждого кейса. Первичное создание exclusive: существующий файл не перезаписывается. Ошибка в ходе прогона оставляет неполный файл; ошибка preflight/прогрева до начала не считается прогоном и может завершиться без отчёта. Прогрев Ollama вне 25-секундного turn budget; DeepSeek не делает дополнительный платный preflight. Метаданные: provider, endpoint, requested model, SHA исходников/dataset/prompts, budgets, полный runtime tool-schema hash и отдельный legacy dataset hash. Digest берётся из Ollama; DeepSeek alias не считается закреплённым snapshot. Returned model/usage сохраняются из ответов, но это сведения провайдера, не доказательство неизменности весов. SHA исходников важны при запуске до коммита.

Recorder понимает оба формата, ограничивает тело 64 KiB, корректно обрабатывает
сжатие и закрывает response при отмене/ошибке. Headers, provider error body и
reasoning/thinking не сохраняются. HTTP capture подменяется только на время
одного последовательного case и сбрасывается в finally; параллельные прогоны
внутри одного Python-процесса не поддерживаются. Общие runtime limits сохранены.

Автоматически проверяются HTTP/code, реальные names/counts/args/order, фактически возвращённые источники и URL, ID/версии/хеш assessment и обязательность review. SDK context cleanup классифицирует вложенные ошибки так же, как production boundary, сохраняя FORBIDDEN/MCP_TIMEOUT. Перечисление источника в fixture без реального tool call не даёт права цитировать его.

`structural_pass` — только структурная часть; `semantic=unassessed`, `passed=null` до предметной проверки. Обычный 503 не является правильным ответом. Dev-06/16 — ожидаемые инъецированные отказы, их нужно показывать отдельно. Blocked-кейсы agent-v1 не исполняются и остаются в полном знаменателе 20. В agent-v2 все 25 используют реализованные схемы, что не означает модельного успеха.

## Проверка фактов и ограничений

```bash
uv run --locked python -m evals.review evals/reports/development-<timestamp>.json evals/reports/review-<name>.json
```

Отчёт сохраняет dataset_version и SHA выбранного development. Review загружает только ту же версию development и отвергает несовпадение hash; старые отчёты без версии считаются agent-v1. Review связан с SHA всего raw-отчёта и каждого ответа. Для каждого факта: supported/missing/contradicted/unclear, дословная quote и основание из реально наблюдённого tool result либо применимого project rule. Ответ не может служить доказательством собственного корпоративного утверждения. Для error/assessment отдельно разрешены наблюдённые структурные поля результата. Неверные цитаты/указатели/неполные списки критериев отвергаются.

Все ограничения и каждый реальный search query получают отдельную оценку; дополнительные неподтверждённые утверждения фиксируются дословно. Отчёт не перезаписывается: создаётся reviewed-копия с hash review. Для `reviewer=codex_assisted` поле assisted_passed отделено от человеческого passed; human_reviewed=0, release_accepted=false. Это явный LLM-assisted разбор, **не независимый откалиброванный judge и не одобрение наставника**. Даже правильные цитаты и assisted-review не гарантируют отсутствие остальных ошибок.

[Результаты и оставшиеся проблемы](reports/README.md). Полный Go/UI-путь, реальные бизнес-записи и прохождение этапов здесь не проверяются. [Границы OpenSpec](../../openspec/changes/implement-python-agent/eval-harness-scope.md).

Пользовательский текст не содержит внутренних citation id. Структурная проверка
учитывает references: URL должен происходить из фактически вызванного tool.
Fixtures без вызова не дают права ссылаться на них. Это проверка происхождения
источников, а не доказательство смысловой поддержки каждого утверждения.

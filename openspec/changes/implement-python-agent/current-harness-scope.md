# Актуальный development harness

15.11.2026. Итоговый CI main5c5775b: frontend/python/go/repository и deploy успешны. Обновляем только Python evaluation и документацию; runtime, Go и UI не меняются.

Harness MUST выбирать ollama/deepseek через существующие Settings/provider runtime, без альтернативной реализации агента. DeepSeek не требует Ollama preflight. Реальные LLM-запросы CLI MUST требовать явного --allow-live-llm; автоматические тесты используют HTTP fixtures без настоящего ключа/сети. Настройки service/MCP в harness всегда синтетические; реальный Go URL не используется, записи/подтверждения корпоративных операций невозможны.

SDK MCP MUST объявлять текущий каталог из 11 CONTRACTS с request-local synthetic principal. submit_access_request доступен только при явном fixture permission access:submit, остальные десять инструментов доступны; это модель разрешения, не проверка алгоритма AccessIntent Go. Discovery/args/results/request-id проходят production SDK/server. Backend фиксирует вызовы, выбирает fixture по аргументам для повторяющихся non-search tools и не заменяет неизвестный запрос успешной записью. Неоднозначные/невалидные fixtures отвергаются до обращения к LLM.

Recorder MUST поддерживать оба wire format, сохранять только конечные content/tool calls, безопасные token usage/finish reason/returned model; запрещено сохранять headers, credentials, provider error body и reasoning/thinking. Сам recorder ограничивает чтение тела 64 KiB, закрывает response при cancellation/error; не снимает runtime deadlines. Приватные transport exception strings в отчёт не попадают. Набор должен сохранять неполный отчёт при прерывании, без перезаписи существующих файлов.

Отчёт MUST содержать provider/requested и returned model, endpoint без credentials, полный runtime tool-schema hash/catalog, отдельный legacy dataset contract hash, hash фактически исполняемого development, prompt/code hashes, budgets, фактически наблюдённые tools и отсутствие живых corporate effects. Контрактные scripted тесты всех 11 инструментов не являются 11 успешными модельными сценариями.

agent-v1 development20/holdout10 и метки MUST оставаться неизменными. CLI исполняет только development; не вызывает audit(), читающий оба split. Старые stage/evidence fixtures остаются blocked до отдельного согласования, а новые возможности действий не объявляются покрытыми legacy golden. Семантический review и human approval по-прежнему отдельны; structural pass не равен качеству. В этом блоке live LLM/holdout не запускаются, API ключи не читаются из .env автоматически.

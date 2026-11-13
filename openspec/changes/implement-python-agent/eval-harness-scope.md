# Общий development eval-harness

Авторизован 13.11.2026. Только development agent-v1; загрузки/запуска holdout в live harness нет. Gold dataset/ожидания не меняются по результатам модели.

Harness MUST выполнять реальные Flask chat/assessment пути с локальной Ollama. Chat использует настоящий SDK MCP client/server и production Python server factory с явно внедрённым fixture backend. Предзаданные tool names не заменяют решения LLM. Actual tool calls/args/results и fault injection фиксируются. Fixture mode проверяет работу с заданными результатами, не качество реального retrieval Go; семантическое соответствие query оценивается отдельно и не засчитывается автоматически.

Недоступные progress/evidence кейсы MUST оставаться blocked в полном знаменателе. Ожидаемые ошибки MCP/LLM инъецируются явно и отделяются от случайных отказов. Нет LLM/MCP в ordinary CI. Реальные API/Go, сохранение/переход, скрытые рассуждения и секреты не логируются.

Структурный оценщик MUST проверять HTTP/code, фактические tools/args/count/order, допустимые источники/цитаты, версии результата assessment и обязательность review. Он MUST NOT называть совпадение ключевых слов фактологической точностью. Смысловые факты, дополнительные утверждения, ограничения и query intent требуют отдельной размеченной проверки, связанной с SHA ответа и конкретным trial. Пока её нет — semantic unassessed и общего pass нет.

Для проверки фактов допускается явный Codex-assisted review сохранённых синтетических ответов, с per-fact verdict/дословной цитатой/основанием и проверкой всех ограничений/query intents. Это не утверждение человеком или независимый откалиброванный judge. Reports MUST показывать, кто размечал, и не выдавать assisted-reviewed pass за окончательную человеческую приёмку.

Отчёт MUST иметь уникальное имя, complete flag, git/model digest/prompt/dataset/schema versions, budgets, реальные ответы/ошибки, длительность и счётчики. Прерванный отчёт остаётся incomplete. Повтор после исправлений сохраняет baseline и использует те же development inputs/labels. Holdout не используется для настройки.

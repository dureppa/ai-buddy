# Документация AI Buddy

Актуальная сдача:

- [Запуск](../README.md)
- [Ответы на критерии кейса](criteria.md)
- [Маршрут проверки](demo.md)
- [Продуктовая презентация, PDF](ai-buddy-presentation.pdf)
- [Видеодемонстрация](https://disk.yandex.ru/d/QYaiOk9O1Q7iig)
- [Покрытие](coverage.md)
- [Архитектура](architecture.md)
- [Стек](stack.md)

Компоненты:

- [Веб](components/web.md), [расширение](components/extension.md), [Go](components/backend-go.md), [Python](components/ai-python.md), [MCP](components/python-mcp.md)
- [Docker Compose](components/docker-compose.md), [сервер](components/server-deployment.md), [поставка](components/continuous-delivery.md)
- [Действия агента](components/service-actions.md)
- [Личный календарь](components/calendar.md)
- [Корпоративные сайты](components/corporate-services.md), [доступы](components/access-portal.md), [Jira](components/jira.md), [Confluence](components/confluence.md)

Спецификации:

- [Опросы стажировки и уведомления](specs/internship-surveys.md)
- [Заявка на доступ](specs/001-access-request.md), [онбординг](specs/002-onboarding-and-context.md), [HR-сервисы](specs/003-hr-services.md)
- [Агент и сервисы](specs/004-agent-service-integration.md), [Jira](specs/005-jira.md), [портал доступов](specs/006-access-portal.md)
- [Доступы и Confluence](specs/007-agent-access-confluence.md), [остальные действия](specs/008-remaining-agent-services.md)
- [Демосессия](specs/demo-session.md), [кабинет](specs/staff-workspace.md), [инструменты стажёра](specs/intern-tools.md)
- [Путеводитель](specs/product-guide.md), [расписание](specs/schedule-hr.md), [рабочие инструменты](specs/work-tools-services.md)
- [Календарь в агенте](specs/agent-calendar.md): чтение периода и создание с подтверждением.
- [Проверка подготовки действия](specs/action-result-proof.md): результат инструмента и ссылка на карточку вместо неподтверждённого «готово».

Контракты и проверка:

- [OpenAPI](../contracts/openapi.yaml), [схемы MCP](../contracts/agent-tools.json)
- [Go → Python и MCP](integrations/go-python-mcp.md)
- [Оценка знаний](integrations/knowledge-assessment.md)
- [Стандарты разработки](engineering.md), [материалы Авито](avito-sources.md)
- [Чек-лист сдачи](submission-checklist.md)
- [Пробелы ответов](ai/answer-gaps.md), [контроль качества](ai/quality-control.md)
- [Инструменты направлений](specs/009-agent-role-tools.md), [проверка прогона](ai/role-tools-check.md)

- [Контракт контекста пояснения](specs/010-selection-explanation.md): selection, чтение источников и границы доступа.

- [Проверка панели Buddy](ai/selection-explanation-check.md): общий диалог, контекст пункта и границы проверки.

- [Ссылки и действия чата](specs/011-chat-navigation.md), [проверка переходов](ai/chat-navigation-audit.md).

- [Стартовые ресурсы профилей](specs/profile-resource-kits.md): чаты, доступы и материалы.

Все 15 инструментов видны каждому профилю и ранжируются по специальности.
[Порядок и границы](specs/role-tool-ranking.md).

- [Разбор пункта адаптации](specs/ask-agent-checklist.md): общая панель Buddy, контекст, шаги и материалы.

- [Приветствия](specs/conversational-messages.md): короткие разговорные реплики без поиска корпоративных источников.

- [Текущая задача и общение](specs/current-checklist-and-dialogue.md): единый выбор пункта в UI/чате, поддержка и границы.

- [Проверка текущей задачи и диалога](ai/current-task-dialogue-check.md): тесты, браузер и разрешённый LLM-прогон.
- [Проверка календаря](ai/calendar-check.md): автотесты и разрешённый синтетический LLM-прогон.

- [Противоречащие инструкции](specs/conflicting-knowledge.md).
- [Замер отзывчивости интерфейса](ui-responsiveness.md).
- [Регрессия карточки подтверждения](ai/action-proof-check.md): ложное сообщение о готовности и восстановление с LLM.

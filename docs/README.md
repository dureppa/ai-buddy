# Документация AI Buddy

Актуальная сдача:

- [Запуск](../README.md)
- [Ответы на критерии кейса](criteria.md)
- [Маршрут проверки](demo.md)
- [Покрытие](coverage.md)
- [Архитектура](architecture.md)
- [Стек](stack.md)

Компоненты:

- [Веб](components/web.md), [расширение](components/extension.md), [Go](components/backend-go.md), [Python](components/ai-python.md), [MCP](components/python-mcp.md)
- [Docker Compose](components/docker-compose.md), [сервер](components/server-deployment.md), [поставка](components/continuous-delivery.md)
- [Действия агента](components/service-actions.md)
- [Корпоративные сайты](components/corporate-services.md), [доступы](components/access-portal.md), [Jira](components/jira.md), [Confluence](components/confluence.md)

Спецификации:

- [Заявка на доступ](specs/001-access-request.md), [онбординг](specs/002-onboarding-and-context.md), [HR-сервисы](specs/003-hr-services.md)
- [Агент и сервисы](specs/004-agent-service-integration.md), [Jira](specs/005-jira.md), [портал доступов](specs/006-access-portal.md)
- [Доступы и Confluence](specs/007-agent-access-confluence.md), [остальные действия](specs/008-remaining-agent-services.md)
- [Демосессия](specs/demo-session.md), [кабинет](specs/staff-workspace.md), [инструменты стажёра](specs/intern-tools.md)
- [Путеводитель](specs/product-guide.md), [расписание](specs/schedule-hr.md), [рабочие инструменты](specs/work-tools-services.md)

Контракты и проверка:

- [OpenAPI](../contracts/openapi.yaml), [схемы MCP](../contracts/agent-tools.json)
- [Go → Python и MCP](integrations/go-python-mcp.md)
- [Оценка знаний](integrations/knowledge-assessment.md)
- [Стандарты разработки](engineering.md), [материалы Авито](avito-sources.md)
- [Чек-лист сдачи](submission-checklist.md)
- [Пробелы ответов](ai/answer-gaps.md), [контроль качества](ai/quality-control.md)
- [Инструменты направлений](specs/009-agent-role-tools.md), [проверка прогона](ai/role-tools-check.md)

- [Уточнить у агента по выделению](specs/010-selection-explanation.md): боковая панель, контекст задачи/сервиса и чтение источников.

- [Проверка пояснений выделения](ai/selection-explanation-check.md): UI, контракты, LLM и границы измерения.

- [Ссылки и действия чата](specs/011-chat-navigation.md), [проверка переходов](ai/chat-navigation-audit.md).

- [Стартовые ресурсы профилей](specs/profile-resource-kits.md): чаты, доступы и материалы.

Все 15 инструментов видны каждому профилю и ранжируются по специальности.
[Порядок и границы](specs/role-tool-ranking.md).

- [Вопрос агенту из чек-листа](specs/ask-agent-checklist.md): основной чат, контекст пункта и помощь.

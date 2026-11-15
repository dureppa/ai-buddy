- [Jira](components/jira.md): самостоятельные доски и задачи, PostgreSQL и API.
# Документация AI Buddy

- [Continuous delivery](components/continuous-delivery.md): проверенный main → SSH → server release, backup, health и rollback.

- [Развёртывание серверного демо](components/server-deployment.md): адреса браузера, пароль nginx и откат старого проекта.

- [DeepSeek и живые сервисы](specs/004-agent-service-integration.md): чат, MCP-прогресс и учебный маршрут согласий с review.

- [OpenSpec: Python-агент и MCP](../openspec/README.md) содержит предложенные спецификации, внутренние контракты, план реализации и проверки; подключён Flask/LLM/MCP runner и учебный Go/HR маршрут согласий; глобальный онбординг ещё не завершён.
- [Инструкция Go → Python и MCP](integrations/go-python-mcp.md) содержит текущие HTTP/MCP-контракты, JSON-примеры, ошибки, сроки ожидания и порядок приёмки.
- [Оценка знаний: контракт для Go](integrations/knowledge-assessment.md), [размеченные примеры](../services/ai-python/evals/README.md) и [фактическое качество локальной модели](../services/ai-python/experiments/assessment-quality.md).
- [Development harness и результаты](../services/ai-python/evals/HARNESS.md): реальные локальные LLM/MCP прогоны и раздельный разбор фактов.
- [Общий golden dataset 20/10](../services/ai-python/evals/agent-v1/README.md) и [исследование контроля качества](ai/quality-control.md): ожидаемые факты/инструменты/ограничения, runbook и границы проверок.
- [Python MCP](components/python-mcp.md): demo с учебными данными либо Go HTTP-адаптер, два инструмента, настройки и проверки на моках.
- [Архитектура](architecture.md) описывает ответственность компонентов и обмен данными.
- [План MVP](mvp.md) описывает сценарии, интерфейсы и очередность работы.
- [Заявка на доступ](specs/001-access-request.md) и [онбординг](specs/002-onboarding-and-context.md) задают ожидаемое поведение Buddy.
- [Демосессия AI Buddy](specs/demo-session.md) описывает вход, выход и переходы между вкладками.
- [Черновик HTTP API](../contracts/openapi.yaml) описывает форматы для веба и расширения.
- [Маршрут демонстрации](demo.md) и [чек-лист технической сдачи](submission-checklist.md) помогут проверить готовый прототип.
- [Docker Compose](components/docker-compose.md) описывает запуск, проверку агента и профиль HR.
- [Стек и локальная среда](stack.md) фиксируют версии, зависимости и команды установки.
- [Материалы Авито](avito-sources.md) связывают требования кейса и технические решения с источниками.
- [Стандарты разработки](engineering.md) описывают требования к тестам, Python и Go.
- [Демонстрационные HR-сервисы](specs/003-hr-services.md) описывают действия, проверки и хранение данных.
- [Корпоративные демосайты](components/corporate-services.md) описывают адреса, запуск и интеграцию.
- [Веб-приложение](components/web.md), [расширение](components/extension.md), [Go-бэкенд](components/backend-go.md) и [Python-сервис](components/ai-python.md) описывают состояние и назначение каждого компонента.
- [Кабинет наставника и руководителя](specs/staff-workspace.md) описывает доступ к прогрессу и публикацию материалов.

Описание компонента обновляется вместе с реализацией. По мере появления кода в нём фиксируются точки входа, назначение ключевых файлов, используемые зависимости, интерфейсы и воспроизводимые команды запуска и тестов.

- [Описание команды в путеводителе](specs/product-guide.md).

- [Управление доступами](components/access-portal.md): каталог, демозаявки и проект интеграции агента.

- [Confluence](components/confluence.md): страницы продуктов, команд, специальностей и гайды; чтение агентом.
- [Серверные заявки агента](specs/007-agent-access-confluence.md): полномочия текущего turn, единая БД, ошибки и границы.

- [Ограничения ответов и недостающие источники](ai/answer-gaps.md).

- [Подключение остальных сервисов и подтверждение действий](specs/008-remaining-agent-services.md).

- [Действия корпоративных сервисов](components/service-actions.md): чтение, черновики, ручное подтверждение и гарантии повторов.

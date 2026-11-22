# Go-бэкенд

Go API проверяет сессии и права, хранит данные Buddy в PostgreSQL, связывает
веб с Python AI/MCP и выполняет подтверждённые человеком операции.

**[Подробное руководство по реализации Go-бэкенда](../backend-go/README.md)**
содержит карту пакетов, схемы запросов и БД, описание транзакций, авторизации,
чата, подтверждений и справочник HTTP API.

- [Запуск, переменные окружения, миграции, тестирование и диагностика](../backend-go/operations.md).
- [Технологии и направления развития с приоритетами и ограничениями](../backend-go/roadmap.md).

## Стек и точки входа

Go 1.26.11, `net/http`, pgx/v5, PostgreSQL 17 в Compose,
`golang-jwt/jwt/v5`, `log/slog`, стандартные Go-тесты и Testify.
Версии: [go.mod](../../web/backend/go.mod), [стек](../stack.md).

| Точка входа | Назначение |
| --- | --- |
| [cmd/server/main.go](../../web/backend/cmd/server/main.go) | Конфигурация, пул, адаптеры, HTTP и остановка |
| [internal/httpapi/api.go](../../web/backend/internal/httpapi/api.go) | Публичные маршруты |
| [internal/buddy](../../web/backend/internal/buddy) | Типы, правила и интерфейсы хранилищ |
| [internal/store](../../web/backend/internal/store) | SQL, история, прогресс, review |
| [internal/ai/bridge.go](../../web/backend/internal/ai/bridge.go) | Flask и внутренние MCP-маршруты |
| [internal/serviceactions](../../web/backend/internal/serviceactions) | Черновики и однократная попытка после confirm |
| [internal/portal](../../web/backend/internal/portal) | Каталог доступов и Confluence |
| [internal/calendar](../../web/backend/internal/calendar) | Общий календарь веба и агента |
| [internal/worktools](../../web/backend/internal/worktools) | Рабочие инструменты и чтение данных команды |
| [migrations](../../web/backend/migrations) | Схема до `17_team_interns`, включая два файла с номером 08 |

## Основные границы

`httpapi → buddy ← store` — основная зависимость бизнес-правил от интерфейсов.
Дополнительные домены имеют собственные пакеты и HTTP-регистрацию;
`cmd/server` собирает реализации явно.

При непустом `AI_SERVICE_URL` чат использует Go → Flask → Python MCP → Go.
Без URL возвращается unavailable, локальный ответ вместо модели не подставляется.
Delegation/resource JWT отделены от пользовательских сессий; selection имеет
read-only режим. [Контракт интеграции](../integrations/go-python-mcp.md).

`serviceactions` сохраняет immutable payload и отправляет действие после
ручного подтверждения. После неизвестного сетевого результата — uncertain,
без автоматического повторного POST. [Гарантии](service-actions.md).

Ролевой чек-лист, дополнительные задания, анкеты, календарь, диалоги
и подтверждения хранятся на сервере. Публикации наставника и привязки материалов
имеют отдельный браузерный адаптер. Данные внешних API принадлежат их собственным
базам. [Календарь](calendar.md), [сценарии](../specs/staff-workspace.md),
[внешние сервисы](corporate-services.md).

## Проверки и запуск

Из `web/backend`: `go mod download`, `go run ./cmd/server` после настройки
окружения и применения миграций. Для изучения без модели запускай с
`AI_SERVICE_URL=`. Нужны доступная PostgreSQL и `SESSION_SECRET` минимум
32 байта. [Полная локальная инструкция](../backend-go/operations.md).

`just go-check` проверяет основной модуль, `just service-go-check` — внешние.
SQL-интеграции требуют тестовых `TEST_DATABASE_URL` и для Jira
`JIRA_TEST_DATABASE_URL`; без них часть тестов пропускается. CI предоставляет
PostgreSQL. [Покрытие](../coverage.md), [стандарты](../engineering.md).

# Jira demo

[Компонент и запуск](../../docs/components/jira.md) · [Спецификация](../../docs/specs/005-jira.md) · [OpenAPI](../../contracts/jira.openapi.yaml).

```sh
# Из корня репозитория
docker compose --profile hr --profile jira up --build -d
```

UI http://localhost:5189/, собственная PostgreSQL, API :8189 внутри Compose.
Локальный frontend: `npm run dev --workspace=@ai-buddy/corporate-services -- jira`.
Локальный API: экспортировать `.env.example`, применить SQL миграцию/сид к
отдельной PostgreSQL, `go run .` из этого каталога.

```sh
# Из этого каталога, с временной тестовой PostgreSQL
JIRA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/jira_test?sslmode=disable go test -race ./...
```

Без JIRA_TEST_DATABASE_URL интеграционные тесты пропускаются. CI задаёт её.

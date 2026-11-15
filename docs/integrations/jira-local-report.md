# Проверка Jira, 14.11.2026

Локально использованы PostgreSQL 17.12, Go 1.27.4 и Node 24.22.3; CI использует
закреплённые в репозитории версии (.nvmrc и web/backend/go.mod).
Новые runtime-зависимости не добавлены: pgx/JWT/React/Zod уже использовались.

- `go vet ./...` и `JIRA_TEST_DATABASE_URL=… go test -race -coverprofile=… ./...`
  в tools/jira: успешно, покрытие 83,1% операторов. Тесты разворачивают схему
  в отдельной тестовой PostgreSQL и удаляют её после прогона.
- Frontend часть `just check`: Prettier, ESLint, tsc всех workspace, 65 Vitest
  тестов, сборки веба, расширения и всех девяти сервисов — успешно.
- `just python-check`: Ruff, mypy, 406 pytest теста — успешно; покрытие 89,68%.
- `TEST_DATABASE_URL=… just go-check` с миграциями и сидом в отдельной тестовой
  БД: vet, обычные/race-тесты и отчёт покрытия — успешно, store-тесты не пропущены.
- `just hr-consents-check repository-check`: успешно.
- Ответы живого Jira API `/spaces`, `/spaces/travel/boards`,
  `/boards/travel-team`, `/me/issues` проверены по contracts/jira.openapi.yaml
  через jsonschema с преобразованием OpenAPI nullable — успешно.
- В браузере: вход Александра открывает «Путешествия», видны две его доски,
  закрытая доска наставников отсутствует; создание TRV-4 с исполнителем,
  редактирование статуса и перезагрузка сохраняют данные (version 2).

Первый `just check` выявил устаревшее ожидание единственного тома в Compose-тесте;
тест обновлён для отдельной БД Jira и повторно прошёл. Остальные части полного
набора выполнены отдельно. `compose-check` не выполнен: Docker CLI отсутствует.
Docker-сборки и Compose runtime остаются для CI/среды с Docker. Локальная проверка
использовала временную PostgreSQL и Go/Vite напрямую, без изменения рабочих БД.
CD расширен для Jira; его backup и HTTP-smoke проверяются на моках. Живой серверный деплой в локальном прогоне не выполнялся.

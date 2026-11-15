# Покрытие и проверки

Дата измерения: 16 ноября 2026, ветка `fix/agent-access-request-actions` поверх
main `42ed2ab`. Порог прикладного контура — больше 80%. Проценты не усредняются.
Go считает операторы, Python и веб — строки. Зависимости, сгенерированный код
и тесты исключены. Сырые отчёты не коммитятся.

## Веб Buddy

Из корня: `npm run test:coverage --workspace=@ai-buddy/web`.
Vitest/V8 измеряет `web/frontend/src`, исключая `*.test.*` и `*.d.ts`.
Node 24.22.2, порог команды — 85% строк.

| Показатель | Результат |
| --- | --- |
| Тесты | 246, все прошли |
| Строки | 91,62% (1532 из 1672) |
| Операторы | 89,50% (1714 из 1915) |

Проверены карточка доступа, обязательное ручное подтверждение и показ номера
сохранённой заявки. Полный frontend-check также проверяет расширение
(10 тестов) и сайты сервисов (58 тестов), типы, формат, lint и сборки.
Эти два набора не включены в процент веба Buddy.

## Python-агент

Из `ai-agent`:

```bash
uv run --locked pytest --cov=. --cov=../ops/deploy --cov-report=term-missing --cov-fail-under=80
```

pytest-cov измеряет `ai_buddy`, `evals`, `experiments` и `ops/deploy`, исключая
тесты. Это общий контур Python, не отдельный замер runtime-пакета.

| Показатель | Результат |
| --- | --- |
| Тесты | 726, все прошли |
| Строки | 91,49% (3119 из 3409; 290 без покрытия) |

Ruff и mypy прошли. Новые регрессии проверяют свежий каталог после уточнения,
выбор доступа вместо контекста Jira/инструментов, закрытую схему аргументов,
подготовку ручного действия и путь Gateway → SDK → MCP → GoHTTP.
Сохранённый agent-v2 snapshot проверяется по прежнему SHA; fixtures отдельно
валидируются текущими runtime-контрактами. Архивные отчёты не переписывались.
HTTP модели заменён тестовым transport; живой DeepSeek в этом прогоне не вызывался.

## Go API

На отдельной PostgreSQL 16.15 применены все `migrations/*.up.sql`, включая 13,
и `seeds/demo.sql`. Go 1.26.11. Пользовательские базы не использовались.
CI использует PostgreSQL 17. Из `web/backend`:

```bash
TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/aibuddy_test?sslmode=disable go test -race -count=1 ./...
TEST_DATABASE_URL=postgres://USER@127.0.0.1:5432/aibuddy_test?sslmode=disable go test -coverprofile=coverage.out -covermode=atomic ./...
go tool cover -func=coverage.out
```

| Пакет | Покрытие операторов |
| --- | --- |
| Весь `web/backend` | **90,7% (2701 из 2978)** |
| `internal/store` | 91,6% |
| `internal/serviceactions` | 92,1% |
| `internal/ai` | 89,4% |
| `internal/httpapi` | 95,7% |
| `internal/portal` | 89,0% |
| `internal/worktools` | 85,6% |
| `internal/config` | 95,1% |
| `internal/buddy` | 93,9% |
| `cmd/server` | 88,2% |
| `accessapi` | 72,7% |

482 теста/подтеста прошли без пропусков. Проверены все девять шаблонов через
HTTP-клиент, разрешённые каталоги четырёх профилей и BI `delivery-bi`.
Подготовка/открытие ничего не отправляют; чужой профиль и отозванный ресурс
отклоняются. Реальный PostgreSQL проверяет подтверждение BI, шесть параллельных
подтверждений, один сохранённый номер, повтор и отмену.

## Общий прогон

`just check` прошёл полностью: service-go-check, frontend-check, python-check,
go-check (gofmt, vet, тесты, race и atomic coverage), repository-check и
compose-check. Внешние Go-модули проверены с PostgreSQL и race; их имитации
в `corporate-services/` и `tools/` не входят в порог прикладного Go API.
`just external-check` с запуском всех 24 API в этом изменении не выполнялся.
Браузерная приёмка с живой моделью остаётся отдельной проверкой пользователя.

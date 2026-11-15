# Отчёт о покрытии

Дата прогона: 15 ноября 2026.

Порог кейса — больше 80% строк прикладного кода, написанного командой. Зависимости, сгенерированный код и сами тесты в измерение не входят. Проценты контуров не складываются и не усредняются. Имитации корпоративных систем в `corporate-services/` и `tools/` в этот порог не входят: так организаторы ответили на вопрос о моках. Расширение собирается и тестируется в `just frontend-check`, в таблицу ниже не включено.

Go встроенным инструментом считает покрытие операторов, не строк. В отчёте это названо прямо.

Сырые `web/coverage/`, `coverage.out` и `.coverage` в git не коммитятся. Повтори команды ниже, чтобы получить те же отчёты локально.

## Веб Buddy

Команда из корня:

```bash
npm run test:coverage --workspace=@ai-buddy/web
```

Инструмент: Vitest и Istanbul, покрытие строк файлов `web/frontend/src`, без `*.test.*` и `*.d.ts`. Порог скрипта — 85% строк.

| | |
| --- | --- |
| Тесты | 159, все прошли |
| Строки | 89,07% (1280 из 1437) |
| Операторы | 86,75% (1435 из 1654) |

Локально команда выполнена на Node 25.2.1. CI берёт Node 24.22.2 из `.nvmrc` и ту же команду. Отчёт LCOV пишется в `web/coverage/lcov.info`, в CI он сохраняется артефактом `web-coverage`.

## Python-агент

Команда из `ai-agent`:

```bash
uv run --locked python -m pytest --cov=. --cov=../ops/deploy --cov-report=term-missing --cov-fail-under=80
```

Инструмент: pytest-cov, строки. В измерение входят пакет `ai_buddy`, каталоги `evals` и `experiments` и скрипты `ops/deploy`. Тесты исключены. Порог команды — 80%.

| | |
| --- | --- |
| Тесты | 621, все прошли (актуальный main + уточнение/development) |
| Строки | 91,28% по полному Python/ops gate |

`just python-check` добавляет к этой команде Ruff и mypy.

Из данных того же прогона отдельно выделен прикладной пакет `ai_buddy`: **97,12% строк (1924 из 1981)**. Тесты, evals/experiments, ops и зависимости в это частное число не входят. После измерения добавлен один offline guard manifest (проверен отдельно); окончательное число тестов повторно фиксирует PR CI. Остальные контуры в таблицах ниже этим Python-блоком не переизмерялись.

## Go API

Команда из `web/backend` после применения `migrations/*.up.sql` и `seeds/demo.sql` к пустой базе, как в CI:

```bash
TEST_DATABASE_URL=postgres://$USER@127.0.0.1:5432/aibuddy_test?sslmode=disable \
  go test -coverprofile=coverage.out -covermode=atomic ./...
go tool cover -func=coverage.out
```

Инструмент: `go test -covermode=atomic`, покрытие операторов. Версия Go — 1.26.11. Локальная база этого прогона — PostgreSQL 14.20. Compose использует PostgreSQL 17. Интеграционные тесты без `TEST_DATABASE_URL` пропускаются, и тогда итог заметно ниже.

| | |
| --- | --- |
| Итог по `web/backend` | 76,3% операторов |
| `internal/store` | 82,2% |
| `internal/serviceactions` | 84,0% |
| `internal/ai` | 77,6% |
| `internal/httpapi` | 71,5% |
| `internal/portal` | 74,2% |
| `internal/worktools` | 75,0% |
| `internal/buddy` | 67,5% |
| `cmd/server` | 55,6% |
| `accessapi` | 0% |

Итог ниже 80%. Усреднять его с вебом или Python нельзя.

На этом прогоне не прошёл `TestAIKnowledgeSearchNaturalQuestions`: поиск «Как оформить отпуск?» не вернул ожидаемую статью `timeoff`, а «Как проверить микрофон?» вернул `consents` вместо `equipment`. Покрытие `internal/store` посчитано по выполненным проверкам, включая эту неуспешную. Порог Go этим прогоном не закрыт.

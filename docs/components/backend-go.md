# Go-бэкенд

`internal/serviceactions` подключает четыре API, сохраняет подтверждения в PostgreSQL (миграция 11) и выполняет одну попытку после ручного confirm. Два внутренних POST-маршрута: /internal/v1/ai/service-context и /internal/v1/ai/service-actions/prepare. [Настройки и публичные маршруты](service-actions.md).

## Интеграция с агентом

`internal/calendar` хранит личный календарь веба и агента (миграция 14).
HTTP CRUD/импорт требуют сессию владельца; MCP чтение периода и
`create_calendar_event` используют существующий serviceactions с ручным
подтверждением. [Контракты и ограничения](calendar.md).

При AI_SERVICE_URL включается Go → Flask → Python MCP → Go. Обязательны отдельные
AI_SERVICE_TOKEN, MCP_ADAPTER_SERVICE_TOKEN и AI_DELEGATION_SECRET (32+ символа).
HR_CONSENTS_URL, HR_DOCUMENTS_URL и HR_EVENTS_URL задают API согласий, документов
и мероприятий. Локальные адреса HTTP и фиксированные DNS
`agent`/`hr-consents`/`hr-documents`/`hr-events` поддержаны для Compose; другие origins требуют HTTPS.
При отсутствии AI_SERVICE_URL сохраняется прежний отказ unavailable.

`internal/ai` отвечает за Flask HTTP, короткие JWT с разными audience,
MCP resolve/read и учебный assessment/review. `internal/store/chat.go` сохраняет
диалоги, проверяет владельца и сериализует генерации блокировкой строки.
`internal/store/ai.go` читает знания/команду/прогресс, `review.go` сохраняет оценки
и применяет решение наставника транзакционно. Новые миграции 06/07/08 обязательны.
WriteTimeout увеличен до 35 с. История читается владельцем через
GET /api/v1/chat/conversations/{conversation_id}.

Для consent-news: GET/POST /api/v1/onboarding/consent-review. POST принимает
только answer. DEMO_MODE открывает POST /api/v1/demo/staff-sessions с
staff_id=mentor|lead; GET/POST /api/v1/staff/reviews/{profile_id} проверяют
отдельный staff JWT и закреплённых стажёров. POST решения принимает
evaluation_id, approve, note. Одобрение проверяет актуальные evidence/version,
сохраняет решение и completion вместе. Обход через обычный completion запрещён.
Это переход учебного задания, не глобальная модель этапов стажировки.


## Статус

Go хранит профили, сессии, диалоги и черновики действий в PostgreSQL и отдаёт их вебу. При `AI_SERVICE_URL` чат идёт в Flask. Без адреса AI-сервиса ход возвращает `503` и не подменяется локальным текстом.

Чтения для агента включают команду, знания, прогресс, каталог доступов и страницы Confluence. `internal/serviceactions` читает найм, увольнения, бенефиты и Jira и сохраняет черновик до ручного подтверждения. Контракты: [OpenAPI](../../contracts/openapi.yaml), [SDD 001](../specs/001-access-request.md), [SDD 004](../specs/004-agent-service-integration.md), [SDD 008](../specs/008-remaining-agent-services.md).

## Назначение

Для [запуска через Docker Compose](docker-compose.md) PostgreSQL, миграции и Go API настраиваются одной конфигурацией.

Go API проверяет права, выполняет операции и хранит диалоги и черновики. Корпоративные сервисы имитируются отдельными процессами. Ответственность компонентов описана в [архитектуре](../architecture.md).

## Стек и требования

- PostgreSQL **13+** — используется встроенный `gen_random_uuid()`.
- Файлы миграций, сидов и кода в **UTF-8** (в номере заявки кириллическая `Д`).
- Версии Go и библиотек зафиксированы в [go.mod](../../web/backend/go.mod),
  [go.sum](../../web/backend/go.sum) и [стеке проекта](../stack.md):
  `pgx/v5 v5.12.0` (драйвер БД), `golang-jwt/jwt/v5 v5.3.1` (аутентификация),
  `testify v1.11.1` (тесты). MCP реализован на Python, Go MCP SDK в модуль не входит.
- Отдельный CLI для миграций не используется: файлы применяются через `psql` или GUI-клиент.

## Архитектура

Код разделён на три пакета с чёткой ответственностью:
- **`buddy`** — доменная логика: типы, ошибки, use cases. Объявляет интерфейсы хранилищ.
- **`store`** — доступ к данным: SQL-запросы, транзакции, мок корпоративного сервиса. Реализует интерфейсы из `buddy`.
- **`httpapi`** — HTTP-транспорт: роутинг, DTO, middleware аутентификации, маппинг ошибок.

Правило зависимостей: `httpapi` → `buddy` ← `store`.

## Карта файлов

```text
web/backend/
├── migrations/    # 01–11, актуальная схема — эти файлы
└── seeds/
    └── demo.sql
```

Миграции 06–11 добавляют учебное согласие, оценку наставника, команды четырёх продуктов, доступы и Confluence, черновики действий. Таблица ниже описывает исходные объекты 01–05. Для полного состава смотри файлы миграций.

Создание схемы и наполнение разделены: `migrations/` — только DDL, `seeds/` — только данные.

## Схема

| Миграция | Объекты | Назначение |
| --- | --- | --- |
| `000001_identity` | `teams`, `profiles`, `team_members`, `services`, `service_request_permissions`, `sessions` | Профили стажёров, команда, каталог сервисов, права на запрос доступа, сессии |
| `000002_onboarding` | `onboarding_tasks`, `onboarding_progress` | Каталог шагов адаптации и отметки выполнения |
| `000003_access_requests` | `access_request_number_seq`, `next_access_request_number()`, `access_request_drafts`, `access_requests`, `mock_service_operations` | Черновики, сохранённые заявки, имитация корпоративного сервиса |
| `000004_chat` | `conversations`, `messages` | Диалоги и сообщения Buddy |
| `000005_notifications_and_guides` | `notifications`, `page_guides`, `knowledge_articles` | Системные карточки, справочник страниц, демонстрационные инструкции |

### Ключевые решения

- **Идентификаторы.** Справочники (`profiles`, `teams`, `services`, `onboarding_tasks`,
  `knowledge_articles`) используют текстовые slug-ID, совпадающие с `data.ts` веба.
  Операционные сущности — `uuid`.
- **Права — модель присутствия.** Строка в `service_request_permissions` означает право
  запросить доступ к сервису. Отзыв права — удаление строки. Проверка выполняется и при
  подготовке черновика, и при подтверждении.
- **Сессии.** `sessions.token_hash` — SHA-256 (hex, 64 символа) от bearer-токена,
  `UNIQUE`. Сырой токен не хранится. Истечение — по `expires_at`.
- **Прогресс адаптации.** Статус `completed` выводится из наличия строки в
  `onboarding_progress`, отдельной колонки статуса нет. `PRIMARY KEY (profile_id, task_id)`
  делает повторную отметку идемпотентной (`ON CONFLICT DO NOTHING`). Ближайший шаг —
  первый незавершённый по `onboarding_tasks.sort_order`; если все завершены, `next_task_id`
  равен `null`.
-Одна заявка на черновик.** `access_requests.draft_id UNIQUE` — идемпотентность
  подтверждения на уровне БД. Составной внешний ключ
  `(draft_id, profile_id, service_id) → access_request_drafts` не даёт заявке разойтись
  с черновиком по владельцу и сервису.
- **Срок черновика.** `expires_at` по умолчанию `now() + 15 минут`, `CHECK (expires_at > created_at)`.
  Истечение проверяется только при первом подтверждении: уже сохранённая заявка
  возвращается независимо от срока.
- **Ключ операции.** `mock_service_operations.operation_key` равен ID черновика. Успех
  фиксируется строкой, повтор с тем же ключом не выполняет операцию заново. Сбой не
  фиксируется, поэтому повтор возможен.
- **Номер заявки.** PL/pgSQL-функция `next_access_request_number()` возвращает
  `Д-001`, `Д-002`, … Формат совпадает с демо веба. Пропуски в нумерации допустимы:
  `nextval` не откатывается при `ON CONFLICT`.
- **Сообщения.** `CHECK`-ограничения повторяют контракт `ChatReply`: `kind` обязателен
  только для ответов Buddy, `draft_id` допустим только при
  `kind = access_confirmation_required`, `page_url` — только у сообщения пользователя
  и без query-параметров и фрагмента. `refs` — JSON-массив `Reference`.
- **Уведомления.** `UNIQUE (profile_id, kind)` — одна системная карточка каждого типа
  на стажёра, карточка экватора не задваивается.
- **Справочник страниц.** `page_guides.url` — первичный ключ с проверкой схемы `http(s)`
  и отсутствием `?` и `#`.

## Демонстрационные данные

`seeds/demo.sql` идемпотентен (`ON CONFLICT DO NOTHING`), выполняется в одной транзакции
и согласован с `web/frontend/src/data.ts`.

### Профили и права

| Профиль | Имя | День / этап | grafana | jira |
| --- | --- | --- | --- | --- |
| `olga` | Ольга Соколова | 1 / Первый день | разрешено | разрешено |
| `sasha` | Александр Ким | 90 / Экватор | **запрещено** | разрешено |
| `maria` | Мария Лебедева | 180 / Финал | разрешено | разрешено |

Все трое — стажёры-продуктовые дизайнеры команды `product-design` («Дизайн продукта»),
лид Алексей Морозов, наставник Анна Ким. Различие прав `sasha` на `grafana` покрывает
приёмку SDD 001 «у стажёра нет разрешения на запрос» и «право отозвано после подготовки».

### Состав сидов

- 1 команда, 3 профиля, 5 участников команды.
- 6 сервисов: `figma`, `confluence`, `grafana`, `jira`, `mattermost`, `drive`.
- 5 записей прав (только на `grafana` и `jira` — сервисы, доступные к запросу).
- 12 шагов чек-листа, `guidance` совпадает с `details` из `data.ts`.
- 25 отметок прогресса: `olga` — 3, `sasha` — первые 10, `maria` — все 12.
- 1 черновик и 1 сохранённая заявка `maria` на `grafana` с номером `Д-001`.
- 1 уведомление об экваторе для `sasha`.
- 1 запись справочника страниц: `http://localhost:5173/tools`.
- 7 демонстрационных инструкций (`documents`, `product`, `learning`, `timeoff`,
  `equipment`, `contacts`, `meetups`).

После сида последовательность номеров установлена в `1`, следующая заявка получит `Д-002`.
Сброс счётчика защищён от отката:

```sql
SELECT setval('access_request_number_seq',
    GREATEST((SELECT last_value FROM access_request_number_seq), 1), true);
```

URL справочника страниц нужно синхронизировать с `VITE_WEB_URL` расширения: питомец
сравнивает origin и путь `/tools`.

## Применение

Роль и базы создаются один раз:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aibuddy') THEN
    CREATE ROLE aibuddy LOGIN PASSWORD 'aibuddy';
  END IF;
END
$$;
SQL

for db in aibuddy aibuddy_test; do
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || sudo -u postgres createdb -O aibuddy "$db"
done
```

Миграции применяются по возрастанию номера, откат — в обратном порядке. Версионной
таблицы нет, поэтому накатывать нужно на чистую базу:

```bash
export DATABASE_URL="postgres://aibuddy:aibuddy@localhost:5432/aibuddy?sslmode=disable"

for f in web/backend/migrations/*.up.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" || break
done

for f in $(ls -1r web/backend/migrations/*.down.sql); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" || break
done
```

Сид содержит собственные `BEGIN`/`COMMIT`, поэтому флаг `-1` для него не используется:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f web/backend/seeds/demo.sql
```

Откат удаляет таблицы вместе с данными — выполнять только на демонстрационной базе.
Файлы можно применять и через GUI-клиент (DBeaver), порядок тот же.

## Проверка

### Автоматические тесты
```bash
cd web/backend
go test -race ./...
```
Три уровня тестов: Unit (buddy) с fake-хранилищами, HTTP (httpapi) через httptest, Интеграционные (store) против реальной БД aibuddy_test.

### Ручная проверка API
```bash
cd web/backend
go run ./cmd/server
```
В другом терминале:
```bash
# Получить токен
TOKEN=$(curl -s localhost:8080/api/v1/demo/sessions \
  -H 'Content-Type: application/json' -d '{"profile_id":"sasha"}' | jq -r .access_token)

# Получить уведомления (у sasha есть карточка экватора)
curl -s localhost:8080/api/v1/notifications -H "Authorization: Bearer $TOKEN" | jq

# Чат (нужны AI_SERVICE_URL и работающие Flask/MCP/LLM)
curl -s -X POST localhost:8080/api/v1/chat/messages \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Как оформить отгул?"}' | jq
```
### Проверка схемы в БД
```bash
psql "$DATABASE_URL" -c "SELECT p.id, coalesce(bool_or(perm.service_id='grafana'), false) AS grafana FROM profiles p LEFT JOIN service_request_permissions perm ON perm.profile_id=p.id GROUP BY p.id ORDER BY p.id;"

psql "$DATABASE_URL" -c "SELECT profile_id, count(*) FROM onboarding_progress GROUP BY profile_id ORDER BY profile_id;"

psql "$DATABASE_URL" -c "SELECT id, number, status FROM access_requests;"
```
*Ожидаемо:*
grafana — maria t, olga t, sasha f; прогресс — maria 12, olga 3, sasha 10; одна заявка Д-001 со статусом submitted.

## Ограничения и открытые вопросы

- **Legacy write-tool не подключён.** `prepare_access_request` ещё не реализован; чат с read-tools и учебный review работают отдельно от этого legacy-сценария.
- **Нет версионирования миграций.** Порядок применения соблюдается вручную через скрипт `scripts/db-setup.sh`.
- **Каталог сервисов минимален** (`id`, `name`, `description`). Атрибуты `state`, `aliases`, `owner`, `instruction` остаются в `data.ts` веба и переедут в бэкенд или AI-сервис вместе с чат-сценарием.
- **Презентация шагов остаётся на фронте.** API отдаёт `id`, `title`, `guidance`, `status`, `action_url`; поля `summary`, `due`, `owner`, `stage`, `icon`, `tone` — оформление из `data.ts`.
- **Снятие отметки не предусмотрено.** Контракт содержит только `PUT .../completion` (идемпотентная отметка). Фронтовый `toggleTask` умеет снимать отметку — расхождение решается отдельной задачей по контракту.
- **Дедуп по сервису** выполняется на этапе подготовки черновика в чате, а не при подтверждении; на подтверждении достаточно `UNIQUE (draft_id)`.
- **Нумерация за 999.** `lpad(..., 3, '0')` обрежет номер до трёх цифр, в отличие от фронтового `padStart`. Для демонстрации недостижимо.
## Предложение агента онбординга

Обновлённый [OpenSpec агента](../../openspec/README.md) описывает будущую работу с чек-листом и шестью корпоративными сервисами. Агент оценивает, наставник одобряет, Go проверяет и применяет переход. Это новые требования, не подтверждение их реализации. Текущие API завершения задач и заявок на доступ остаются baseline; новые схемы требуют отдельного согласования.

[Инструкция подключения Python и двух MCP read-tools](../integrations/go-python-mcp.md) описывает задачи следующего среза; Go-код при подготовке инструкции не менялся.

Миграция `08_team_guide` синхронизирует четыре профиля стажёров и их команды, добавляет брифы и таблицу `team_guides`. Маршрут путеводителя и воркер включаются при настройке `AI_SERVICE_URL`. [Спецификация путеводителя](../specs/product-guide.md).

Для расписания `HR_ABSENCES_URL` и `HR_TRIPS_URL` задают адреса источников сведений за сегодня. [Спецификация](../specs/schedule-hr.md).

## Серверные доступы и Confluence (следующий реализованный срез)

[SDD 007](../specs/007-agent-access-confluence.md) расширяет прежние пять Go/MCP-чтений:
get_access_catalog, get_access_requests, get_knowledge_page и submit_access_request.
Максимум — 13 tools; submit_access_request объявляется только при AccessIntent текущего turn.
Два новых инструмента чтения/подготовки доступны при настройке serviceactions.
Маршруты Go: GET /internal/v1/ai/access/catalog, GET/POST /internal/v1/ai/access/requests,
POST /internal/v1/ai/knowledge/page. Используются прежние resource-token,
X-Request-ID, TTL и ACL. local_demo остаётся с двумя read tools.
Поиск включает сохранённые Confluence-страницы продукта и общие гайды; заявки
портала/чата общие в PostgreSQL. Повторы идемпотентны; receipt из БД, approved
не является granted. Исторические ограничения выше относятся к предыдущим срезам.

Поиск MCP по knowledge_articles использует русский полнотекстовый поиск
PostgreSQL: значимые слова объединяются через OR, заголовок имеет больший вес,
чем содержимое. Полный вопрос не обязан встречаться в статье дословно.

`internal/worktools/agent.go` предоставляет каталог и проекцию записей для MCP.
Встроенный каталог и `tools/*/demo.json` содержат все 13 инструментов для
каждого продукта; тест сверяет их данные. Новые записи добавляются прежним
идемпотентным сидом. Проверка команды и фильтрация записей в API сохраняются.
GET /internal/v1/ai/work-tools и POST /internal/v1/ai/work-tools/context используют
тот же resource-token, X-Request-ID и проверенный TeamID. Новых профилей/URL в
аргументах нет. Клиент проверяет team ответа, ограничивает размер/время,
не следует redirect и не использует env proxy. [SDD 009](../specs/009-agent-role-tools.md).

## Пояснение выделенного текста

buddy/selection.go проверяет контекст выделения, а HistoryText сохраняет цитату и название с вопросом. Bridge передаёт selection в Flask и подписывает read_only в delegation/resource JWT. Режим запрещает submit_access_request и prepare_service_action, включая прямой вызов resource API.

[Сценарий и ограничения](../specs/010-selection-explanation.md).

## Назначения карточек чата

[SDD 011](../specs/011-chat-navigation.md): internal/ai/navigation.go строит URL конкретного задания по task_id/action_url и настроенным публичным адресам, исправляет источники старой истории только по однозначным задачам владельца. papers/documents используют один Documents evidence. Неизвестное evidence не ссылается на согласия. Форматы API/MCP не расширены; новый экран задания читает существующий GET /api/v1/onboarding. Вкладка своих access-заявок задаётся tab=requests.

## Опросы стажировки и уведомления

Миграция `12_internship_surveys` добавляет ответы с уникальным ключом по стажёру и этапу, отметку `notifications.read_at` и напоминания для четырёх демопрофилей. `GET /api/v1/onboarding/surveys` возвращает только этапы с ответами. `PUT /api/v1/onboarding/surveys/{stage}` проверяет ответы и сохраняет первую отправку. `GET /api/v1/notifications` включает статус прочтения и скрывает напоминание после завершения соответствующей анкеты. `POST /api/v1/notifications/read` отмечает показанные ID в рамках текущего профиля. [Контракт](../../contracts/openapi.yaml), [спецификация](../specs/internship-surveys.md).

## Контекст текущего веб-чек-листа

Чат принимает ограниченный `page_context.checklist`. `buddy.ChecklistContext.Valid`
проверяет status/task, существующая task-схема — границы полей. Bridge передаёт
его Flask без подмены профиля или серверного прогресса. Сам snapshot не выдаёт
полномочия и не меняет делегацию обычных поручений; selection по-прежнему read_only.
[Контракт и сценарий](../specs/current-checklist-and-dialogue.md).

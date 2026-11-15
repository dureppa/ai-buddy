# Go HTTP API для Python-агента и Python MCP-сервера

SDD 009 добавляет GET /internal/v1/ai/work-tools и POST /internal/v1/ai/work-tools/context. Каталог и записи привязаны к профилю делегации; схемы — [work-tools.openapi.yaml](../../contracts/work-tools.openapi.yaml), поведение — [спецификация](../specs/009-agent-role-tools.md). Максимум grants — 13.

SDD 008 добавляет POST /internal/v1/ai/service-context и POST /internal/v1/ai/service-actions/prepare с прежней делегацией/resource-token и X-Request-ID. Схемы — contracts/agent-tools.json: get_service_context и prepare_service_action. prepare сохраняет черновик; выполняющий confirm не публикуется в MCP. [Подробности](../components/service-actions.md).

## Реализованный следующий срез

Go/Flask/MCP теперь соединены кодом. Включение: AI_SERVICE_URL и отдельные
AI_SERVICE_TOKEN/MCP_ADAPTER_SERVICE_TOKEN/AI_DELEGATION_SECRET в Go;
MCP_BACKEND=go_http и GO_API_URL в MCP. Добавлены progress/task-context/task-evidence
из [SDD 004](../specs/004-agent-service-integration.md). Три новых tools доступны
только в go_http. Старый demo-корпус не выдаёт личные данные Go.
Делегация и resource JWT имеют разные audience и одинаковый срок действия;
Go проверяет X-Request-ID и профиль при чтениях. Ниже — исходный подробный
контракт двух чтений; заявления о несуществующем Go-вызове заменены этим разделом.


Обновлено 14.11.2026. **MCP-сервер и HTTP-адаптер реализованы на Python; Go-разработчик реализует HTTP API и бизнес-логику.** Эта инструкция заменяет прежнее задание поднять `/mcp` на Go. MCP SDK, JSON-RPC, `tools/list` и `tools/call` в Go не нужны.

Статус: Flask chat/assessment, Python MCP-клиент, сервер с локальными данными и Go HTTP-адаптер реализованы. **Адаптер проверен на HTTP-моках; доступности и совместимости настоящих Go endpoints это не подтверждает.** [Запуск demo/go_http](../components/python-mcp.md). Поля новых HTTP API — договорённость команды, не схемы корпоративных сервисов Авито. Требуется согласование с Go-разработчиком и живая интеграционная проверка.

## 1. Целевой маршрут и ответственность

```text
Клиент → Go chat API → Python Flask /internal/v1/turns → LLM
                                                       ↓ вызов инструмента
                                              Python MCP-сервер
                                                       ↓ обычный HTTP/JSON
                                              Go API данных и моков
```

| Go-разработчик | Python-разработчик |
| --- | --- |
| HTTP API, пользователи, права, история, данные команды, инструкции и моки | Flask, агент, prompts, MCP-клиент и MCP-сервер |
| Выдача и проверка доверенного контекста текущего пользователя | Привязка MCP-вызова к этому контексту, без subject_id из аргументов модели |
| Бизнес-валидация, сохранение операций/прогресса и решение наставника | HTTP-адаптер, закрытые MCP-схемы, проверка результата, таймауты и безопасные ошибки |

Python не читает таблицы Go напрямую и не дублирует правила завершения этапов. Агент оценивает знания, наставник одобряет, Go проверяет актуальность и применяет переход.

## 2. Минимальный список работ Go

1. **Подключить Go chat → существующий Flask endpoint** из раздела 3: передавать доверенный контекст, историю и сообщение, получать и сохранять текст/ссылки. В проверенном baseline `assistant.Ask(ctx, msg) error` не переносит profileID и не возвращает Reply; интерфейс интеграции должен поддерживать оба. Сведения о baseline не заменяют проверку вашей актуальной ветки.
2. **Выдавать короткоживущую делегацию на один AI-ход** после проверки пользователя и владельца диалога. Подготовить HTTP-проверку контекста из раздела 4. Не использовать браузерный токен как универсальный ключ.
3. **Реализовать два HTTP API чтения:** поиск инструкций и контекст своей команды из раздела 5. Это источники для уже известных инструментов `search_knowledge` и `get_team_context`.
4. **Проверять актуальные ACL на каждом HTTP-чтении**, ограничивать результаты и не возвращать чужие сведения. Закрытые поля не должны доходить до Python даже с пометкой «не показывать».
5. **Настроить таймауты, отмену и сохранение** из раздела 7. Не удерживать транзакцию/row lock при ожидании Python: агент вызывает обратно другие HTTP-маршруты Go.
6. Оценку знаний подключать отдельным HTTP-вызовом по [assessment-инструкции](knowledge-assessment.md). MCP для него не нужен. Версии, сохранение оценки, review и переход принадлежат Go.

**Приоритет первого среза:** доверенный контекст + два чтения + чат с сохранением. HTTP-моки шести сервисов сами по себе не заменяют данные команды и базу инструкций. Если один из этих источников ещё не готов, это нужно явно согласовать, а не подставлять неподтверждённые ответы.

Корпоративные категории: `absences`, `business_trips`, `hiring`, `dismissals`, `consents`, `benefits`. Для их бизнес-операций Go/UI согласуют отдельные HTTP-схемы. Этот read-only срез не требует автоматически добавлять по MCP-tool на каждый HTTP endpoint. Progress/evidence, подготовка заявок, подтверждения и mentor review не считаются реализованными наличием этих двух чтений.

## 3. Go → Flask: существующий контракт

**POST** `/internal/v1/turns`, `Content-Type: application/json`, `Authorization: Bearer <AI_SERVICE_TOKEN>`.

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "message": "Как оформить отсутствие?",
  "delegation_token": "synthetic-mcp-delegation",
  "history": [],
  "page_context": {"url": "https://demo.example/services/absences"}
}
```

- request_id/conversation_id — обязательные UUID; Go проверяет владение диалогом до Python.
- message — 1–4000 символов, не только пробелы. history — до 20 объектов `{role,content}`: role только user/assistant, content 1–4000 символов; текущий message в history не дублировать.
- delegation_token — 1–8192 ASCII символа без пробелов/управляющих, opaque token для **Python MCP**, не авторизация Go HTTP-чтений. MCP отвергает не-ASCII bearer до resolve.
- page_context необязателен. URL http/https без userinfo/query/fragment; Go очищает его. Python не загружает страницу и не видит DOM.
- Объекты закрытые, тело ≤65536 UTF-8 байт. Новые profile_id/subject_id/roles/mode в этот DTO не добавлять: текущий Python отклонит их. Профиль связывается с делегацией на Go. Не отправлять history=null вместо отсутствующего поля.

Ответ 200:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "reply": {
    "text": "В демо-сервисе открой раздел «Отсутствия» и нажми «Новая заявка». После отправки заявка будет на согласовании. [absence-guide]",
    "references": [{"title": "Демо: оформление отсутствия", "url": "https://demo.example/policies/absences"}]
  }
}
```

Go сверяет оба ID и сохраняет итоговый текст/ссылки. В текущий публичный ChatReply преобразовать явно: conversation_id из ответа, kind=`answer`, text=reply.text, references=reply.references. Внутренний ответ нельзя отдавать как прежний публичный DTO без преобразования. Clarification пока не выделяется отдельным kind. Успешный 200 с «нет информации» не означает выполненное действие или завершённый этап.

Readiness Flask проверяет только конфигурацию, не доступность LLM/MCP. MCP_URL указывает на **Python MCP-сервис**, а не на Go. В demo используется локальный токен; в go_http — выданная Go делегация. [Команды запуска](../components/python-mcp.md). MCP liveness не обращается к Go: go_connected=null в HTTP-режиме, а не утверждение об успешной связи.

## 4. Доверенный контекст: Go HTTP-контракт адаптера

Чтобы сохранить текущий TurnRequest и не передавать subject_id от модели, предлагается **непрозрачная делегация с проверкой у выдавшего её Go**. Конкретная реализация хранения/выпуска остаётся Go. Это внутренний контракт команды, не готовый OAuth-сервер.

### Выдача внутри Go chat

После аутентификации Go связывает случайную непредсказуемую делегацию с subject/profile, request_id, conversation_id, audience=`ai-buddy-python-mcp`, сроком и разрешёнными tools. Исходное предложение TTL — 60–120 секунд с запасом на 25-секундный ход; срок не продлевается молча. Делегация передаётся Flask в существующем поле delegation_token и далее клиентом в Python MCP Authorization. Она не попадает в prompt, URL или логи.

### Проверка Python MCP

**POST** `/internal/v1/ai/context/resolve` на Go. Авторизация: отдельный сервисный секрет `Authorization: Bearer <MCP_ADAPTER_SERVICE_TOKEN>`, известный только Go и Python MCP.

```json
{"delegation_token": "synthetic-mcp-delegation"}
```

Успех HTTP 200:

```json
{
  "active": true,
  "subject_id": "demo-profile",
  "request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "allowed_tools": ["search_knowledge", "get_team_context"],
  "expires_at": "2026-11-13T18:00:00Z",
  "api_token": "synthetic-go-http-access"
}
```

Неизвестная, отозванная или истёкшая делегация: HTTP 200 с `{"active":false}`, без субъекта/причины/данных. Неправильный сервисный секрет: HTTP 401. Валидация закрытого JSON/размера: 400/413, без echo токена. Успех выдаётся только после проверки audience, срока, привязок и текущих прав. Пустой allowed_tools допустим: он не даёт доступа к инструментам. Повтор проверки не создаёт бизнес-операцию; api_token живёт не дольше делегации и связан с теми же request/conversation/subject и разрешениями.

`api_token` — **отдельная учётная запись доступа к Go HTTP API**, например отдельный opaque token; его назначение — `ai-buddy-go-http`. Дальнейшие чтения используют его как bearer. Исходная MCP-делегация поступает только в служебную проверку у её issuer, **не используется как bearer к ресурсным HTTP API**. Не пересылать один и тот же bearer по всей цепочке: MCP требует привязки к получателю и запрещает token passthrough к downstream API. [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-audience-binding-and-validation).

Ответ resolve — закрытый объект, строки токенов 1–8192 ASCII символа без пробелов/управляющих, subject_id — Identifier; UUID как в TurnRequest, expires_at — RFC3339 UTC. Body запроса/ответа ≤16 KiB. Записи/секреты не логировать; в примерах все токены и дата синтетические и не дают реального доступа.

**Python-сторона реализована:** каждый MCP HTTP-запрос вызывает resolve без кеша, проверяет закрытую схему, active/UTC-срок/allowed_tools, держит контекст в ContextVar, фильтрует discovery и сверяет request_id в MCP `_meta` при tools/call. В Go отправляются только отдельный api_token и доверенный X-Request-ID. Повторные/неизвестные tools в allowed_tools, равенство api_token делегации или сервисному секрету отклоняются; пустой список допустим. В initialize/discovery нет tool args с profile_id. Активность, audience, владение диалогом и текущие ACL Go обязан проверять сам, включая каждое чтение.

Недействительная/истёкшая делегация даёт HTTP 401 самого MCP; неправильный сервисный секрет Go либо неисправный resolve — безопасный HTTP 503. В существующем Flask boundary оба становятся MCP_UNAVAILABLE. Это отличается от FORBIDDEN в корректном результате инструмента. Проверено на моках; выдачу и валидацию настоящих токенов Go ещё предстоит проверить совместно.

## 5. Python MCP → Go: два HTTP API чтения

Оба endpoint используют `Authorization: Bearer <api_token>` и `X-Request-ID: <request_id>`. Go сверяет их привязку; request_id — корреляция, а не отдельное разрешение. conversation/subject берутся из Go-токена, не из query/body. Адрес Go фиксируется настройками Python MCP; не выбирается LLM. HTTP JSON обычный: **нет JSON-RPC, isError, structuredContent и MCP-сессий на Go**.

### Поиск инструкций

**POST** `/internal/v1/ai/knowledge/search`, Content-Type application/json:

```json
{"query": "Как оформить отсутствие?", "limit": 3}
```

query — 1–500 символов после нормализации пробелов, не пустой; limit — integer 1–5, по умолчанию 3. Лишние поля запрещены. HTTP 200:

```json
{
  "ok": true,
  "data": {
    "documents": [{
      "source": {
        "id": "absence-guide",
        "title": "Демо: оформление отсутствия",
        "url": "https://demo.example/policies/absences",
        "version": "1",
        "is_demo": true
      },
      "excerpt": "В демо-сервисе открой раздел «Отсутствия» и нажми «Новая заявка». После отправки статус — «на согласовании», а не «одобрено»."
    }]
  }
}
```

Нет совпадений — HTTP 200 с `{"ok":true,"data":{"documents":[]}}`, не 404 и не null. Возвращать максимум limit подходящих разрешённых документов. Способ поиска — реализация Go; договориться о версионированном демо-корпусе и не возвращать один и тот же ответ на любой query. Указанная в чек-листе ссылка без доступного текста не является загруженной инструкцией.

### Контекст своей команды

**GET** `/internal/v1/ai/team-context`, без query и без тела. HTTP 200:

```json
{
  "ok": true,
  "data": {
    "team": {"id": "search", "name": "Поиск", "summary": "Демонстрационная команда поиска."},
    "mentor": {"display_name": "Анна Тестова", "contact": "@demo_mentor"},
    "lead": null,
    "references": [{"id": "team-search", "title": "Демо: команда поиска", "url": "https://demo.example/teams/search", "version": "1", "is_demo": true}]
  }
}
```

Нет разрешённых сведений — HTTP 200 с team/mentor/lead=null, references=[]; неизвестный лид может быть null при известной команде. Не возвращать полный справочник сотрудников и не принимать произвольный profile_id. Проверка ACL и фильтрация выполняются до сериализации.

### Схемы и ограничения

[Машиночитаемые примеры и схемы](go-python-mcp.examples.json): существующие TurnRequest/Reply и envelopes совпадают с Python-моделями; новые пути/resolve-схемы помечены proposed. Для данных используются SearchEnvelope/TeamEnvelope, для ошибки FailureEnvelope. Envelopes выбраны для тонкого преобразования HTTP → MCP, это обычные JSON-объекты, не обязанность Go реализовывать MCP.

- Source: id 1–128 без пробелов/управляющих; для цитирования ASCII `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`; title 1–200, url 1–2048, version 1–64, is_demo boolean.
- Document: source + excerpt 1–1200; Team: id/name 1–120/summary 1–1200; Contact: display_name 1–120/contact 1–300; references ≤5. Все объекты закрытые.
- URL http/https без userinfo и управляющих символов; допустим относительный путь с одним начальным `/`. Не выдавать localhost/внутренний URL без согласования, что клиент сможет его открыть. Источники разных версий не должны незаметно делить один id.
- Тела чтений и результатов ≤32 KiB UTF-8. Оставить запас: MCP-wrapper увеличит размер; итоговый MCP-результат тоже обязан укладываться в лимит 32 KiB. Не обрезать JSON/смысл документа для попадания в лимит. Content-Type application/json; адаптер запрашивает identity encoding и отвергает сжатие, дубли JSON-ключей и нечисловой Content-Length.

## 6. Ошибки Go HTTP и преобразование

Форма ошибки чтения:

```json
{"ok":false,"error":{"code":"FORBIDDEN","message":"Нет доступа к данным.","retryable":false}}
```

| Go HTTP | code | Поведение Python MCP |
| --- | --- | --- |
| 400 | INVALID_ARGUMENTS | Отказ инструмента, без исполнения запроса с исправленными Python аргументами |
| 401 | CONTEXT_EXPIRED | Завершить ход, новый контекст выдаёт Go; не подменять пользователя |
| 403 | FORBIDDEN | Не повторять, не раскрывать закрытые данные |
| 404 | NOT_FOUND | Не различать чужую и отсутствующую конкретную запись |
| 429 / 503 | TEMPORARILY_UNAVAILABLE | Без ложного успеха; retryable — информация, не команда повторять |
| 500 | INTERNAL_ERROR | Нормализовать в безопасный TOOL_ERROR; provider/DB body не пересылать |

Для ошибок инструмента MCP-сервер создаёт FailureEnvelope с isError=true и безопасным стандартным текстом. Для перечисленных 400/401/403/404/429/503 проверяется точное сочетание HTTP/code и закрытая схема; расхождение даёт INVALID_RESULT. Внешний retryable не запускает повтор, MCP выставляет retryable=false. Клиент пропускает указанные доменные коды, а также MCP_TIMEOUT/INVALID_RESULT/RESULT_TOO_LARGE в Flask как HTTP 503 с тем же code; прочие tool codes становятся TOOL_ERROR. Go chat должен явно сопоставить это со своими публичными ошибками, а не копировать внутренний HTTP status/code как готовый ответ клиенту.

Сеть/HTTP timeout → TEMPORARILY_UNAVAILABLE; неверный JSON/схема/сочетание HTTP-code → INVALID_RESULT; размер → RESULT_TOO_LARGE; redirect, 500 и неожиданный статус → TOOL_ERROR. Истечение TTL во время чтения → CONTEXT_EXPIRED; истечение MCP call budget → MCP_TIMEOUT. Это безопасные отказы, не пустые данные. Нет повторов/redirects/env proxies/cookie persistence, приватные body и секреты не публикуются. Бюджеты ограничивают полное чтение, включая медленные chunks.

Для resolve отказ сервисной авторизации — отдельный HTTP 401, недействительная делегация — `200 {active:false}`. Не смешивать эти формы с envelopes чтений.

## 7. Ошибки Flask, таймауты и сохранение

Существующая ошибка Flask имеет форму `{"error":{"code":"AI_TIMEOUT","message":"Запрос не выполнен. Проверьте статус и повторите позже."}}`, без retryable/request_id. Go знает ID исходного запроса.

| HTTP Flask | Основные code |
| --- | --- |
| 400 / 413 / 415 | INVALID_REQUEST: схема/JSON, размер или Content-Type |
| 401 | UNAUTHORIZED: неверный AI_SERVICE_TOKEN |
| 503 | NOT_READY, AI_UNAVAILABLE, AI_TIMEOUT, AI_RATE_LIMITED, AI_INVALID_RESPONSE |
| 503 | MCP_UNAVAILABLE, MCP_TIMEOUT, INCOMPATIBLE_SCHEMA, INVALID_TOOL, INVALID_RESULT, RESULT_TOO_LARGE, AGENT_LIMIT_REACHED и доменные tool codes |

Полный AI-ход по умолчанию и максимум 25 с, LLM по умолчанию 20 с; MCP initialize/discovery/call — ≤5 с в оставшемся общем бюджете. До 3 генераций/6 tool-попыток и одна коррекция цитаты, без сетевых retries.

**Python-бюджеты реализованы:** resolve ≤1 с, HTTP-чтение Go ≤2,5 с и остатком TTL, плюс запас на MCP/проверки; вся цепочка должна помещаться в 5 с. Тесты проверяют медленные headers/chunks, отмену и закрытие stream. **Для Go предлагается:** Go → Flask timeout около 30 с с учётом внешнего deadline; WriteTimeout — согласовать, например ≥35 с. В проверенном Go baseline он 15 с, это короче AI budget. Эти настройки Go не изменялись; реальные задержки и shutdown нужно проверить при интеграции.

Go сохраняет пользовательское сообщение до вызова Python и итоговый reply после него. При сбое сохраняет возможность нового запроса/ручной проверки, не подставляет фиктивный ответ и не считает request_id механизмом готовой идемпотентности. Не делать повторную генерацию незаметно для пользователя. Отмена внешнего запроса передаётся HTTP-клиенту и БД. При будущем неизвестном результате записи нужна сверка статуса, не повтор операции с новым ключом.

## 8. Порядок подключения и приёмки

1. Согласовать пути/закрытые JSON-схемы resolve и двух чтений, авторизацию, subject binding и тестовый корпус. Если Go предлагает другие пути, зафиксировать их до реализации Python адаптера.
2. Проверить Go HTTP напрямую: resolve active/inactive; выдача отдельного API-токена; два профиля изолированы; срок/отзыв/неверный request_id/недостаточные права отклоняются. Никаких MCP initialize/tools/list на Go.
3. Проверить успешные/пустые/ошибочные ответы чтений, null-контакты, query/limit, лишние поля, размеры и источники. Не выдавать synthetic-* из примеров за работающие секреты или реальные регламенты.
4. Запустить MCP_BACKEND=go_http с GO_API_URL и MCP_ADAPTER_SERVICE_TOKEN. Python Gateway → MCP → HTTP проверен на моках, включая Flask и безопасные ошибки; повторить те же проверки с настоящим Go API и его ACL. Demo не использовать для сокрытия неработающего HTTP.
5. Подключить Go chat → Flask; пройти вопрос → реальный HTTP-read Go → ответ с допустимыми ссылками → сохранение → повторное открытие диалога. Проверить отключённую LLM/MCP/Go, медленный HTTP и истёкший контекст.
6. Отдельно подключить [оценку знаний](knowledge-assessment.md): сохранить ответ/snapshot, вызвать `/internal/v1/assessments`, сверить версии перед записью, показать наставнику. Локальная Qwen ещё не прошла приёмку оценщика. Дальнейшее одобрение и атомарный переход проверяются Go/UI отдельно.

Существующий `experiments.flask_smoke` проверяет Flask/LLM с синтетическим Python MCP внутри тестового процесса. Он не запускает новый HTTP-адаптер и не подтверждает работу Go API. Общий golden dataset также не является результатом живой интеграции.

Новый `tests/test_go_http.py` проверяет Flask → настоящий SDK MCP → Python HTTP-адаптер → HTTP mock без LLM. Это подтверждает Python-контракт, не работу Go/БД или качество ответов модели. [Область OpenSpec](../../openspec/changes/implement-python-agent/go-http-adapter-scope.md).

## 9. Ссылки для реализации

- [HTTP/данные Python](../../ai-agent/ai_buddy/schemas.py), [MCP-клиент](../../ai-agent/ai_buddy/mcp_client.py), [Flask](../../ai-agent/ai_buddy/app.py), [настройки](../../ai-agent/ai_buddy/config.py).
- [JSON-примеры и схемы](go-python-mcp.examples.json), [assessment](knowledge-assessment.md), [готовность сценария](../../openspec/changes/implement-python-agent/scenario-status.md).
- [Широкий будущий каталог MCP](../../openspec/changes/implement-python-agent/mcp-contracts.md) задаёт будущие возможности, а не список уже подключённых tools; прежние указания о размещении `/mcp` на Go этой инструкцией заменены для нового адаптера.

## Серверные доступы и Confluence (следующий реализованный срез)

[SDD 007](../specs/007-agent-access-confluence.md) расширяет прежние пять Go/MCP-чтений:
get_access_catalog, get_access_requests, get_knowledge_page и submit_access_request.
Максимум — девять tools, запись объявляется только при AccessIntent текущего turn.
Маршруты Go: GET /internal/v1/ai/access/catalog, GET/POST /internal/v1/ai/access/requests,
POST /internal/v1/ai/knowledge/page. Используются прежние resource-token,
X-Request-ID, TTL и ACL. local_demo остаётся с двумя read tools.
Поиск включает сохранённые Confluence-страницы продукта и общие гайды; заявки
портала/чата общие в PostgreSQL. Повторы идемпотентны; receipt из БД, approved
не является granted. Исторические ограничения выше относятся к предыдущим срезам.

Go-поиск учитывает русские словоформы и отдельные значимые слова вопроса
через PostgreSQL text search; результаты ранжируются по заголовку/содержимому.
Пустой запрос по-прежнему ошибка, запрос только со стоп-словами даёт пустую выдачу.

SDD 010 расширяет необязательный page_context полем selection: ограниченный текст/заголовок и тип ресурса. Go передаёт его в TurnRequest и сохраняет цитату в истории. Подписанный read_only распространяется на MCP delegation/resource, исключает и запрещает оба write tools. URL очищается как прежде; page/issue/record id передаётся отдельно. См. [спецификацию](../specs/010-selection-explanation.md).

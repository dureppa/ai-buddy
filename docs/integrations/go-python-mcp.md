# Подключение Go к Python-агенту и два MCP-инструмента

Проверено 13.11.2026 по Python runtime в коммите `a515315`. Это инструкция к уже реализованному Python-контракту; задачи Go ниже ещё предстоит выполнить. Код Go и его зависимости этим документом не меняются.

**Первый рабочий срез:** клиент → Go → POST Python `/internal/v1/turns` → локальная LLM → Go `/mcp` → ответ с источниками → сохранение ответа Go → клиент. Доступны только `search_knowledge` и `get_team_context`, оба без записи. Оценка знаний, progress/evidence, HR-действия и одобрение этапа пока не поддерживаются.

[Все схемы и JSON-примеры](go-python-mcp.examples.json) сформированы из действующих Python-моделей. Там есть `inputSchema`, схемы успешных/ошибочных результатов и примеры пустых данных. JSON Schema не выражает все Python-валидаторы: правила URL, нормализации и контроля источников дополнены ниже.

## 1. Что нужно сделать на стороне Go

1. Добавить официальный MCP Go SDK, закрепить выбранную версию в go.mod/go.sum; в текущем go.mod зависимости MCP ещё нет. Для HTTP есть `NewStreamableHTTPHandler` и настройки `Stateless`/`JSONResponse`. Для начала рекомендуются stateless и JSON-ответы: не нужны server-initiated запросы или фоновые SSE-события. Это выбор реализации, а не дополнительное требование Python. [API SDK](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.8.0/mcp#StreamableHTTPOptions)
2. Поднять отдельный MCP endpoint `/mcp` без перенаправления на `/mcp/`, добавить проверку делегации и два инструмента со схемами из раздела 5.
3. Подключить HTTP-адаптер Python в `cmd/server/main.go` вместо `buddy.UnavailableAssistant`.
4. Передать в адаптер доверенный профиль и владение диалогом. Сейчас `buddy.Chat.Ask` принимает profileID, но текущий `assistant.Ask(ctx, msg) error` не передаёт его дальше и не возвращает ответ. Порт нужно расширить либо явно передать доверенный контекст: простая замена заглушки без этого не закрывает интеграцию.
5. В `internal/httpapi/chat.go` сформировать и отправить клиенту ответ: сейчас успешной сериализации там ещё нет. Внутренний Python Reply преобразовать в публичный ChatReply, а не отдать внутренний JSON напрямую.
6. Настроить сроки ожидания и сохранение сообщений. Python не хранит диалоги, не проверяет их владельца и не обеспечивает идемпотентность request_id.

## 2. Адреса, запуск и два разных токена

| Направление | Адрес для локальной разработки | Авторизация |
| --- | --- | --- |
| Go → Python | `http://127.0.0.1:8001/internal/v1/turns` | `Authorization: Bearer <AI_SERVICE_TOKEN>` |
| Python → Go MCP | `MCP_URL=http://127.0.0.1:8080/mcp` | `Authorization: Bearer <delegation_token>` |
| Python → Ollama | `OLLAMA_URL=http://127.0.0.1:11434` | Делегация и сервисный токен туда не отправляются |

Порты — пример общей конфигурации, не встроенные адреса Go. При разнесении сервисов согласовать реальные адреса; loopback внутри контейнера указывает на сам контейнер. Python сейчас разрешает Ollama только на loopback origin. MCP_URL может быть адресом Go-сервиса, без credentials/query/fragment.

Python запускается из `services/ai-python`:

```bash
uv sync --locked --no-dev
AI_AGENT_ENABLED=true OLLAMA_MODEL=qwen3:4b-q4_K_M AI_SERVICE_TOKEN=local-service-token MCP_URL=http://127.0.0.1:8080/mcp uv run --locked --no-dev flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Модель должна быть установлена, Ollama — работать с `OLLAMA_NO_CLOUD=1`. Flask не скачивает веса. Это development server; production WSGI-развёртывание не настроено. [Все настройки Python](../components/ai-python.md).

`AI_SERVICE_TOKEN` — общий внутренний секрет Go/Python. `delegation_token` — отдельный короткоживущий ASCII-токен одного доверенного контекста Go для доступа к MCP. В JSON передаётся сырой токен, без префикса `Bearer`. Не заменять его браузерным session JWT без отдельного решения о назначении и ограничениях этого JWT.

**Что уже делает Python:** проверяет сервисный токен, требует непустую делегацию без пробелов/управляющих символов, отправляет её только в MCP Authorization. Подпись, срок, субъект и ACL делегации Python не проверяет — это обязанность Go MCP.

**Предложение для Go, ещё не реализованное Python-контрактом:** связать делегацию с subject/profile, conversation_id, request_id, audience MCP, сроком и разрешёнными tools. Можно использовать подписанный JWT или непрозрачный токен с серверной записью. Формат claims не зафиксирован; Python видит только непрозрачную строку. Рекомендуемый TTL 60–120 с с учётом 25-секундного хода и запаса. Это не замена проверки актуальных прав на каждом обращении.

На initialize/tools/list отдельные conversation_id/request_id не добавляются Python в аргументы. Поэтому Go должен получать субъект и привязки из проверенной делегации, а не ждать их в теле каждого JSON-RPC сообщения. При tools/call request_id дополнительно приходит в `_meta` — сверить его с делегацией. Не хранить «текущего пользователя» в глобальном поле общего MCP server.

## 3. HTTP Go → Python

Запрос: `Content-Type: application/json`, обычный JSON без JSON-RPC оболочки.

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "message": "Как оформить отсутствие?",
  "delegation_token": "synthetic-delegation-token",
  "history": [],
  "page_context": {
    "url": "https://demo.example/services/absences"
  }
}
```

| Поле | Правило |
| --- | --- |
| request_id, conversation_id | Обязательные UUID. Создаёт/проверяет Go; владение диалогом проверяется до Python. |
| message | 1–4000 символов, не только пробелы. |
| delegation_token | 1–8192 символа без пробелов/управляющих; используйте ASCII JWT/base64url. |
| history | Необязательно, по умолчанию `[]`; ≤20 объектов, role только user/assistant, content 1–4000 символов. Go передаёт предыдущие сообщения, без повторения текущего message. |
| page_context | Необязательно; при наличии объект с единственным полем url. Только http/https, без userinfo/query/fragment и управляющих символов. URL очищает Go; Python страницу не загружает. |

Все объекты закрытые: дополнительные subject_id, roles, mode, assessment и прочие поля сейчас дадут 400. Необязательное поле лучше опустить: history=null или page_context с пустым url не равны отсутствию поля. Длина строк считается в символах Python, тело — максимум 65536 байт UTF-8. Слишком большую историю нельзя молча подменить другой просьбой: нужно ограничить/обработать её на стороне Go явно.

Быстрая ручная проверка с подготовленным Go MCP и валидной делегацией:

```bash
curl --max-time 30 http://127.0.0.1:8001/internal/v1/turns \
  -H "Authorization: Bearer $AI_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @turn.json
```

`turn.json` — запрос выше с реально выданной Go делегацией. Значения synthetic-* из примеров предназначены для тестов, не пройдут настоящую проверку JWT/ACL.

Ответ 200, пример формы, не требование к буквальному тексту модели:

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "reply": {
    "text": "В демо-сервисе открой раздел «Отсутствия» и нажми «Новая заявка». После отправки заявка будет на согласовании. [absence-guide]",
    "references": [
      {
        "title": "Демо: оформление отсутствия",
        "url": "https://demo.example/policies/absences"
      }
    ]
  }
}
```

request_id/conversation_id проставляет код из входа. Go обязан сверить их с ожидаемым ходом. Список references содержит максимум 5 закрытых объектов `{title,url}` и строится из допущенных источников текущего хода. Go сохраняет итоговый текст/ссылки; не извлекает внутренние trace или инструменты из текста ответа.

**Маппинг в текущий публичный контракт:** Python возвращает вложенный reply без kind. В Go ChatReply обязательны conversation_id, kind и text. Для первого read-only среза предлагается `kind="answer"`, `text=reply.text`, `references=reply.references`; это решение адаптера Go, не поле Python. Python пока не классифицирует clarification отдельно. `access_confirmation_required` и draft не выдавать: этот runner ничего не подготавливает. Публичный OpenAPI остаётся без изменений этим документом.

Успешный 200 может содержать «нет информации» или отказ из-за недоверенного документа. Это завершённая обработка вопроса, а не доказательство выполненной задачи онбординга или одобрения перехода.

## 4. MCP: транспорт и последовательность

Использовать Streamable HTTP на одном `/mcp`, не старую схему `/sse` + `/messages`. Python использует SDK 1.30.0 и начинает negotiation с `2025-11-25`; также поддерживает `2025-06-18`, `2025-03-26`, `2024-11-05`. Для нашего HTTP-среза согласовать `2025-11-25`; более новый Go SDK должен уметь ответить этой поддерживаемой версией, не навязывать неподдерживаемую Python версию. [Lifecycle MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [совместимость SDK](https://github.com/modelcontextprotocol/go-sdk#version-compatibility).

Порядок: initialize → ответ с capabilities.tools → notifications/initialized → tools/list → ноль или несколько tools/call → закрытие клиента. Python начинает новую MCP-сессию на каждый HTTP-ход. Один ход не обязан вызывать оба инструмента.

HTTP-заголовки Python SDK: Content-Type application/json; Accept включает application/json и text/event-stream; после negotiation передаётся MCP-Protocol-Version. Authorization с делегацией используется и при handshake/discovery, не только tools/call. В stateless JSON-режиме на GET/DELETE `/mcp` допустим 405; успешная notification обычно получает 202 без тела. Редиректы Python отвергает. Origin, если присутствует, проверяет MCP endpoint; Python — серверный клиент и не обязан присылать браузерный Origin. [Транспорт MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Форма initialize для ручной диагностики (SDK формирует свой clientInfo):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"handoff-check","version":"1.0"}}}
```

Минимальный ответ:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}} ,"serverInfo":{"name":"ai-buddy-go-mcp","version":"0.1.0"}}}
```

После этого клиент отправляет `{"jsonrpc":"2.0","method":"notifications/initialized"}`. В stateful режиме SDK дополнительно обслуживает MCP-Session-Id; это не замена авторизации и привязки к субъекту. Статус 200 с произвольным REST-объектом без JSON-RPC result не является MCP-ответом.

## 5. Точные tools/list и inputSchema

Запрос: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`. Поле result ответа:

```json
{
  "tools": [
    {
      "name": "search_knowledge",
      "inputSchema": {
        "additionalProperties": false,
        "properties": {
          "query": {
            "maxLength": 500,
            "minLength": 1,
            "title": "Query",
            "type": "string"
          },
          "limit": {
            "default": 3,
            "maximum": 5,
            "minimum": 1,
            "title": "Limit",
            "type": "integer"
          }
        },
        "required": [
          "query"
        ],
        "title": "SearchArguments",
        "type": "object"
      }
    },
    {
      "name": "get_team_context",
      "inputSchema": {
        "additionalProperties": false,
        "properties": {},
        "title": "EmptyArguments",
        "type": "object"
      }
    }
  ]
}
```

**Не менять схемы по смысловой эквивалентности:** Python сравнивает структуру JSON Schema, игнорируя только title/description/$comment на любом уровне. Порядок ключей объекта не важен. Добавление `$schema`, `$id`, required=[], изменение default, minimum/maximum или additionalProperties уже не игнорируется. Для пустых аргументов `properties:{}` обязателен, `required` отсутствует. В поиске `limit` имеет default=3 и не входит в required.

Go SDK может автоматически построить другую схему по struct. Использовать возможность явного/raw inputSchema либо проверить сериализованный tools/list против нашего примера до подключения LLM. Optional outputSchema сейчас Python не сравнивает; если публикуете, она должна описывать фактический envelope, не только data. [Tools MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

Первый каталог лучше вернуть одной страницей. Python допускает максимум 4 страницы под общим 5-секундным discovery budget. nextCursor не должен зацикливаться; повторное имя разрешённого инструмента вызовет несовместимость. Посторонние tools игнорируются allowlist, но не включаются автоматически. Само отсутствие одного из этих tools не обязательно ломает discovery — поэтому приёмка должна явно проверять наличие обоих.

## 6. search_knowledge

Вход: query 1–500 символов, limit целое 1–5, default 3. Python нормализует пробелы query и отправляет уже заполненный limit; Go всё равно валидирует прямых клиентов и запрещает дополнительные поля. Строка `"3"` и число 3.5 не равны integer 3.

Запрос с доверенной meta-информацией:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_knowledge","arguments":{"query":"Как оформить отсутствие?","limit":3},"_meta":{"ai-buddy.example/request-id":"11111111-1111-4111-8111-111111111111"}}}
```

JSON-RPC ответ:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": false,
    "structuredContent": {
      "ok": true,
      "data": {
        "documents": [
          {
            "source": {
              "id": "absence-guide",
              "title": "Демо: оформление отсутствия",
              "url": "https://demo.example/policies/absences",
              "version": "1",
              "is_demo": true
            },
            "excerpt": "В демо-сервисе открой раздел «Отсутствия» и нажми «Новая заявка». После отправки статус — «на согласовании», а не «одобрено»."
          }
        ]
      }
    },
    "content": []
  }
}
```

Go ищет только по материалам, которые доступны субъекту делегации, фильтрует ACL **до** выдачи и ограничения количества. Возвращает максимум запрошенного limit документов. Полный корпус/таблицы БД и закрытые инструкции оценки не выдаются. Для MVP можно использовать синтетический каталог/существующие knowledge_articles с адаптером в этот envelope; поля source/version/is_demo — часть контракта, не утверждение об уже существующих колонках БД.

Если совпадений нет, это успех с `data={"documents":[]}` и isError=false. `documents:null`, отсутствующее documents и возврат текста «ничего не найдено» вместо структуры не подходят. Не подставлять общую памятку как будто она отвечает на любой query.

## 7. get_team_context

Вход — ровно `{}`. Нельзя передавать profile_id/team_id: пользователя определяет Go по делегации. Запрос:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_team_context","arguments":{},"_meta":{"ai-buddy.example/request-id":"11111111-1111-4111-8111-111111111111"}}}
```

Ответ:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "isError": false,
    "structuredContent": {
      "ok": true,
      "data": {
        "team": {
          "id": "search",
          "name": "Поиск",
          "summary": "Демонстрационная команда поиска."
        },
        "mentor": {
          "display_name": "Анна Тестова",
          "contact": "@demo_mentor"
        },
        "lead": null,
        "references": [
          {
            "id": "team-search",
            "title": "Демо: команда поиска",
            "url": "https://demo.example/teams/search",
            "version": "1",
            "is_demo": true
          }
        ]
      }
    },
    "content": []
  }
}
```

Все четыре поля data обязательны: team, mentor, lead, references. Значения team/mentor/lead могут быть null, но поля нельзя опускать через omitempty. Валидный субъект без настроенных сведений: `{"team":null,"mentor":null,"lead":null,"references":[]}`. Неизвестная/чужая личность не должна превращаться в такой пустой успешный ответ.

Возвращаются только команда текущего пользователя и разрешённые контакты; полный справочник сотрудников не нужен. Изоляция работает даже при одновременных запросах разных профилей. Отдельный Go HTTP-запрос, в котором ранее был проверен профиль, сам по себе не авторизует новый MCP-запрос без делегации.

## 8. Ограничения результатов и источников

| Объект | Обязательные поля и ограничения |
| --- | --- |
| Source | id 1–128 без whitespace/control; title 1–200; url 1–2048; version 1–64; is_demo boolean. Для runtime id используйте ASCII `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`: более широкая модель id дополнительно ограничивается политикой цитат. |
| Document | source и excerpt 1–1200; лишних полей нет. |
| Team | id 1–128, name 1–120, summary 1–1200. |
| Contact | display_name 1–120, contact 1–300. Не добавлять email/role вместо или сверх этих полей. |
| Списки | documents ≤5 и не больше запрошенного limit; references ≤5; пустые значения — `[]`, не null. |

Все вложенные объекты закрытые. Все поля Source обязательны: `is_demo:false` нельзя опустить через omitempty. Ссылки http/https либо безопасные относительные пути от `/`; без userinfo, обратных слешей и управляющих символов. Для демо удобнее абсолютные URL приложения. Python не загружает ссылку и не подтверждает её существование — корректный маршрут/доступ обеспечивает Go. Токены и закрытые query-значения в Source URL не включать.

id должен обозначать стабильный источник, version — его версию. Один id с разными URL внутри хода отзывается политикой цитат. Метаданные и excerpt не должны содержать инструкций для модели, смены ролей или управляющей разметки. Подозрительный документ может быть целиком исключён Python; полученная ссылка не гарантирует истинность каждого утверждения модели.

Размер **всего CallToolResult**, включая structuredContent/content, ≤32768 байт при сериализации Python. Служебная JSON-RPC оболочка отдельно ограничена транспортом: входящий HTTP-поток ≤1 MiB. Рекомендуется оставлять запас, а не добивать ответ ровно до предела; дублирующий text увеличивает размер. Нельзя отдавать картинки, resource links или произвольную markdown content вместо JSON-данных.

## 9. Ошибки MCP и их отличие от HTTP-ошибок

Для доменной ошибки возвращать обычный JSON-RPC result с isError=true:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "isError": true,
    "structuredContent": {
      "ok": false,
      "error": {
        "code": "FORBIDDEN",
        "message": "Нет доступа к данным.",
        "retryable": false
      }
    },
    "content": []
  }
}
```

Полный error envelope: ok=false; error.code 1–64, message ≤300, retryable boolean — все обязательны, лишних data и полей нет. retryable=false тоже нельзя потерять через omitempty.

| code инструмента | Что получает Go от Python | Действие Go |
| --- | --- | --- |
| FORBIDDEN | 503/FORBIDDEN | Не повторять; показать безопасное отсутствие прав. |
| NOT_FOUND | 503/NOT_FOUND | Не раскрывать существование чужой записи. Для поиска без совпадений нужен пустой успех, а не этот код. |
| CONTEXT_EXPIRED | 503/CONTEXT_EXPIRED | Перепроверить сессию/контекст; новый ход только после решения Go. |
| INVALID_ARGUMENTS | 503/INVALID_ARGUMENTS | Проверить контракт/поведение агента; не запускать бесконечные исправления. |
| TEMPORARILY_UNAVAILABLE | 503/TEMPORARILY_UNAVAILABLE | Завершить ожидание, дать возможность повторить пользователю. |
| Любой другой code | 503/TOOL_ERROR | Сейчас код не входит в безопасный mapping; не ожидать прямой передачи TIMEOUT/CONFLICT/INTERNAL_ERROR. |

message инструмента не передаётся пользователю как есть, retryable=true **не включает** автоматический retry в Python. Для отсутствующего/чужого конкретного ресурса использовать одинаковый NOT_FOUND, если это не противоречит проверке самой делегации.

На уровне транспорта Go отклоняет неподписанную/истёкшую делегацию HTTP 401/403 до инструмента. Это **не** то же самое, что structured error.code=FORBIDDEN: текущий Python SDK boundary обычно сведёт HTTP/JSON-RPC транспортный отказ к MCP_UNAVAILABLE. Если контекст валидно аутентифицирован, но логически устарел или действие запрещено, можно вернуть доменный код выше.

При успехе: isError=false + structuredContent={ok:true,data:...}. При ошибке: isError=true + structuredContent={ok:false,error:...}. content всегда JSON-массив, допустимо `[]`. Если SDK добавляет text, каждый элемент должен быть type=text с **JSON того же полного envelope**; обычное «permission denied»/markdown будет INVALID_RESULT. Автоматическое преобразование Go error/SetError нужно проверить на итоговом wire-ответе, не полагаться на его удобное имя. JSON-представления сравниваются по содержимому, не по пробелам/порядку ключей.

## 10. HTTP-ошибки Python для Go-адаптера

Единая форма, например:

```json
{
  "error": {
    "code": "MCP_TIMEOUT",
    "message": "Запрос не выполнен. Проверьте статус и повторите позже."
  }
}
```

| HTTP | error.code | Значение |
| --- | --- | --- |
| 401 | UNAUTHORIZED | Неправильный/отсутствующий AI_SERVICE_TOKEN; исправить конфигурацию Go → Python. |
| 400 | INVALID_REQUEST | Неверный JSON/UUID/роль/поле/URL/длина. До LLM/MCP. |
| 413 | INVALID_REQUEST | Тело HTTP >64 KiB. |
| 415 | INVALID_REQUEST | Неверный Content-Type. |
| 503 | NOT_READY | Нет обязательной конфигурации/модели при включённом агенте. |
| 503 | AI_UNAVAILABLE | Runner выключен, Ollama недоступна, нет модели или HTTP-сбой провайдера. |
| 503 | AI_TIMEOUT | Модель не ответила вовремя либо исчерпан общий deadline. |
| 503 | AI_RATE_LIMITED | Ollama вернула 429; сам Python endpoint при этом вернул 503, а не 429. |
| 503 | AI_INVALID_RESPONSE | Неверный/пустой/слишком большой/незавершённый ответ модели. |
| 503 | MCP_UNAVAILABLE / MCP_TIMEOUT | Транспорт MCP недоступен либо превышен срок операции. |
| 503 | INCOMPATIBLE_SCHEMA / INVALID_TOOL / INVALID_RESULT | Ошибка каталога, имени или результата; проверить wire-контракт. |
| 503 | AGENT_LIMIT_REACHED | Лимит модели/tools/discovery; не трактовать как частичный успех. |
| 503 | RESULT_TOO_LARGE | Превышен размер MCP-результата/транспорта. |
| 503 | Доменные коды / TOOL_ERROR | См. таблицу выше. |
| 503 | INVALID_REQUEST | Принятый вход/история + prompt/tools не поместились в ограничение запроса Ollama 64 KiB. |

error содержит только code/message, без retryable, request_id и conversation_id. Go уже знает идентификаторы исходного запроса. Не путать с плоским публичным errorBody Go `{code,message}`: внутреннюю ошибку нужно явно отобразить в доменные ошибки Go/публичный ответ. Для неизвестного кода — безопасный fallback, не сырое тело провайдера.

## 11. Таймауты, повторы и сохранение

| Участок | Уже в Python | Предложение для Go |
| --- | --- | --- |
| Полный ход с MCP/LLM/cleanup | По умолчанию и максимум 25 с, AI_TURN_TIMEOUT | HTTP client/context Go → Python около 30 с с учётом общего deadline входящего запроса. |
| Вызов LLM | По умолчанию 20 с, AI_MODEL_TIMEOUT ≤25 | Не делать отдельную попытку за Python. |
| MCP initialize | 5 с | Быстрая проверка делегации, без ожидания длинных операций. |
| Весь discovery, до 4 страниц | Общий бюджет 5 с | Одна страница с двумя tools для первого среза. |
| tools/call | ≤5 с и оставшийся общий бюджет | Собственный DB/handler deadline, например 3–4 с, чтобы вернуть контролируемый результат. |
| Модель / tools | ≤3 генераций / ≤6 попыток; одна корректировка цитаты | Не запускать повторную генерацию по таймауту автоматически. |

**В текущем Go server WriteTimeout=15 с**, меньше Python turn timeout. Go-разработчику нужно согласовать его с клиентским бюджетом, например ≥35 с для обычного ответа чата; иначе корректный Python-ответ может не дойти до клиента. Shutdown budget сейчас 10 с — отдельно решить, прерываются ли текущие ходы или им дают завершиться. Это предлагаемые изменения Go, здесь они не внесены.

Не держать транзакцию/row-lock/общий mutex во время ожидания Python: агент вызывает обратно Go MCP, которому нужны те же данные. Сначала сохранить сообщение пользователя и завершить транзакцию, потом вызвать Python, затем отдельной транзакцией сохранить итоговый ответ или безопасный статус ошибки. Согласовать повторы/конкуренцию одного диалога по request_id в Go: Python повторный request_id обработает заново.

Отмена context Go завершает ожидание Go HTTP-клиента, но синхронный Flask не гарантирует автоматическую остановку agent loop при отключении клиента; Python всё равно ограничен своим deadline. Ни отмена соединения, ни 200 с текстовым отказом не разрешают отметить шаг выполненным. В текущем срезе MCP read-only, так что подтверждать действия или менять этап по ответу модели нельзя.

## 12. Порядок приёмки

1. Без LLM проверить initialize/notification/tools/list: negotiated version поддерживается Python, обе inputSchema совпадают с JSON-пакетом, каталог не теряет пустые properties/default.
2. Проверить tools/call напрямую: успех и пустые списки; null-контакты; доменная ошибка; корректные content/structuredContent; два профиля не видят чужие данные. Неавторизованный запрос не получает каталог/данные.
3. На Python выполнить existing offline-проверки: `uv run --locked pytest tests/test_mcp.py tests/test_mcp_integration.py tests/test_runtime.py`. Они проверяют нашу сторону, а не новый Go MCP.
4. Запустить Python с **реальным** Go MCP и Ollama. `GET /health/live` → 200 `{"status":"alive"}`, readiness → 200 `{"ready":true}`. Health не проверяет сеть, поэтому затем обязателен валидный POST.
5. Задать вопрос о наставнике и инструкции: получить 200 с совпадающими IDs и допустимыми references; сохранить ответ и показать его после перезагрузки клиента. Формулировку модели не сравнивать посимвольно.
6. Отдельно проверить: отключённый MCP/LLM, задержку >5 с у tool, истёкший контекст, чужой профиль, неверную схему, лишние поля и oversized result. Сроки ограничены, UI перестаёт ждать, успех не выдуман.
7. Проверить неизвестный вопрос и документ с командой модели: безопасное отсутствие знаний/блокировка, без выдуманных ссылок и смены этапа.
8. После этого убрать UnavailableAssistant и подключить публичный ответ. Не объявлять готовыми assessment, HR-actions и mentor review — для них нужны новые согласованные контракты.

Ручной `python -m experiments.flask_smoke` использует синтетический Python MCP. Его зелёный результат сам по себе **не проверяет Go endpoint**. Ни интеграция с Go, ни изменения его исходников этим документом не выполнены.

## Источники контракта

- [Python-модели](../../services/ai-python/ai_buddy/schemas.py), [Gateway и транспорт](../../services/ai-python/ai_buddy/mcp_client.py), [Flask](../../services/ai-python/ai_buddy/app.py), [конфигурация](../../services/ai-python/ai_buddy/config.py), [коды](../../services/ai-python/ai_buddy/errors.py).
- [Общие предлагаемые MCP-контракты](../../openspec/changes/implement-python-agent/mcp-contracts.md): более широкий будущий каталог, а не список включённых сейчас инструментов.
- [Текущая готовность онбординга](../../openspec/changes/implement-python-agent/scenario-status.md), [runtime-срез](../../openspec/changes/implement-python-agent/flask-runner-scope.md).

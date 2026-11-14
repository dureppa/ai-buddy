# Python MCP → Go HTTP: ограниченный read-only адаптер

Авторизован 14.11.2026. Реализуем контракт [инструкции Go](../../../docs/integrations/go-python-mcp.md) на Python; Go/UI не меняем. До появления Go проверяем HTTP-моками и настоящим SDK MCP. Это не подтверждение живой Go-интеграции, качества LLM или завершения онбординга.

Режим go_http MUST включаться явно, отдельно от demo. GO_API_URL — фиксированный origin без пути, userinfo, query и fragment; HTTP допустим только для loopback, в общей среде нужен HTTPS. MCP остаётся loopback-процессом. Нельзя автоматически заменять Go локальным корпусом. Liveness сообщает режим, но не обещает доступность Go.

Каждый MCP HTTP-запрос MUST иметь один ограниченный ASCII bearer. До handshake/discovery/call Python вызывает POST /internal/v1/ai/context/resolve с отдельным MCP_ADAPTER_SERVICE_TOKEN и исходной делегацией в JSON. Ответ ≤16 KiB проверяется по закрытой схеме: active=false без других полей либо active=true, subject_id, UUID request/conversation, allowed_tools, UTC expires_at, отдельный api_token. Пустые имена/повторные/неизвестные разрешения, просроченный срок или переиспользование делегации как api_token MUST отвергаться (пустой список разрешений допустим). Контекст живёт только в текущем HTTP-запросе; кеширования делегаций нет.

Discovery MUST показывать только пересечение двух существующих tools и разрешений. tools/call MUST проверять _meta request-id на равенство доверенному UUID, актуальный срок, разрешённый tool и закрытые аргументы до HTTP-чтения. subject_id из LLM не принимается. Параллельные запросы MUST оставаться изолированными, контекст сбрасывается также при отмене/исключении.

search_knowledge вызывает POST /internal/v1/ai/knowledge/search с нормализованными query/limit; get_team_context — GET /internal/v1/ai/team-context без query/body. Авторизация чтений — только отдельный api_token и доверенный X-Request-ID, без исходной делегации и сервисного секрета. Go перепроверяет ACL и привязки на каждом чтении. Схемы успешного результата/пустых данных остаются прежними, превышение requested limit отвергается.

Resolve MUST иметь общий deadline ≤1 с, чтение ≤2,5 с; каждый включает соединение и полное ограниченное чтение тела, а не отдельный timeout на каждый chunk. Остаток TTL дополнительно ограничивает запрос. Серверный backend budget ≤4 с, клиентский MCP budget ≤5 с сохраняются. Retries, redirects, env proxies, cookies и передача credentials на другой origin MUST отсутствовать; ответ без JSON, дубли ключей, повреждённая/неверная схема, oversized/decompression body MUST дать безопасный отказ, не пустой успех. HTTP body лимит чтений 32 KiB, итоговый MCP-result также ≤32 KiB.

Таблица HTTP/code из инструкции MUST проверяться совместно. 400/INVALID_ARGUMENTS, 401/CONTEXT_EXPIRED, 403/FORBIDDEN, 404/NOT_FOUND, 429|503/TEMPORARILY_UNAVAILABLE сохраняются; 500 и неожиданные статусы → TOOL_ERROR. Сетевой сбой/HTTP timeout → TEMPORARILY_UNAVAILABLE, неверный JSON/schema/status-code pairing → INVALID_RESULT, размер → RESULT_TOO_LARGE. Ошибки resolve: inactive/expired → 401, неисправный upstream/неверный service secret → безопасный 503; MCP-клиент классифицирует handshake отказ как MCP_UNAVAILABLE. Тексты Go, секреты и headers не попадают в сообщения/логи приложения. Отмена не преобразуется в успех и закрывает stream/client.

Тесты MUST включать реальные initialize/list/call, обе функции, два субъекта конкурентно, закрытые аргументы/метаданные, отзыв/истечение/недостаточные права, раздельные credentials, статусы/JSON/schema/size, медленный resolve/read/chunks, cancellation/cleanup, отсутствие повторов и redirects. Flask→MCP→HTTP-mock проверяется без LLM. Live Go и holdout не запускаются этим блоком.

## Серверные доступы и Confluence (следующий реализованный срез)

[SDD 007](../../../docs/specs/007-agent-access-confluence.md) расширяет прежние пять Go/MCP-чтений:
get_access_catalog, get_access_requests, get_knowledge_page и submit_access_request.
Максимум — девять tools, запись объявляется только при AccessIntent текущего turn.
Маршруты Go: GET /internal/v1/ai/access/catalog, GET/POST /internal/v1/ai/access/requests,
POST /internal/v1/ai/knowledge/page. Используются прежние resource-token,
X-Request-ID, TTL и ACL. local_demo остаётся с двумя read tools.
Поиск включает сохранённые Confluence-страницы продукта и общие гайды; заявки
портала/чата общие в PostgreSQL. Повторы идемпотентны; receipt из БД, approved
не является granted. Исторические ограничения выше относятся к предыдущим срезам.

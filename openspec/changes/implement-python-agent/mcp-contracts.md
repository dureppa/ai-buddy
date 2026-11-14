# Предлагаемые MCP-контракты агента онбординга

Статус: проект до совместного согласования Go/Python/UI. Все схемы и английские коды — допущение A-02. Сервисы: absences, business_trips, hiring, dismissals, consents, benefits. Нет LMS, календаря, IT и выдачи доступа к репозиторию.

## Транспорт и доверие

Новое размещение MCP — Python; Go предоставляет HTTP API по [инструкции](../../../docs/integrations/go-python-mcp.md). Локальный demo уже поддерживает два чтения; HTTP-адаптер к Go пока не реализован. Streamable HTTP на фиксированном MCP_URL. Go выдаёт короткоживущий делегированный контекст, связанный с субъектом, conversation_id и request_id; проверяет актуальные права при каждом вызове. Subject, роли и токен не выбирает модель. Каталог tools/list пересекается с локальным allowlist; схема LLM адаптируется явно. Любая несовместимость блокирует исполнение, не удаляется молча из аргументов.

Аргументы и результаты — закрытые объекты, дополнительные поля запрещены. id: 1–128 символов без пробельных/управляющих; query: 1–500, после нормализации пробелов. Результат ≤32 KiB UTF-8 с ограничением чтения транспорта. Source содержит id, title, url, version, is_demo; ссылки разрешены Go, не загружаются Python. Source и факты проходят ACL до сериализации.

Успех: isError=false и structuredContent={ok:true,data:...}. Ошибка: isError=true и {ok:false,error:{code,message,retryable}}, без data. При дублирующем JSON в text он обязан совпадать. В LLM передаётся одно проверенное представление. Ошибка транспорта не выдаётся за ответ сервера.

## Чтение

| Имя | Аргументы | Результат data и смысл |
| --- | --- | --- |
| search_knowledge | query; optional limit 1–5, default 3 | documents: до limit объектов source + excerpt ≤1200; отсутствие совпадений — пустой список |
| get_team_context | {} | team, mentor, lead: разрешённые сведения либо null, references до 5; полный справочник сотрудников не возвращается |
| get_onboarding_progress | {} | plan_id/version, current_stage, stage_status, tasks до 30 с id/title/status/required/owner/period/dependencies, next_task_id, blockers; status задач todo/in_progress/needs_review/done; это новый предлагаемый контракт, несовместимый со старой плоской схемой без адаптера |
| get_task_context | task_id | task/version, source_ref: лист/диапазон/версия, инструкция, verification_mode, completion_criteria, доступные actions и references. Закрытые материалы оценки выдаются только внутреннему режиму оценки, не в пользовательский ответ |
| get_task_evidence | task_id | evidence до 20: id, source_type, source_record_id, source_version, observed_at, status, краткий result. Версии и привязки проверяет Go; read не изменяет факт или прогресс |
| get_service_guide | service | разрешённая инструкция, source/version/is_demo и доступные действия; нет инструкции — безопасное отсутствие данных |
| get_my_service_records | service; optional limit 1–10, default 5 | records: id, service, operation_type, status_code, status_meaning, version, updated_at, безопасное summary и references. До утверждения enum Go неизвестный статус не интерпретируется как успех |

Для найма/увольнений возвращаются только разрешённые синтетические сведения/инструкции. Нет доступа к другим кандидатам/сотрудникам. Для отсутствующей и чужой записи одинаковый NOT_FOUND.

## Только подготовка действия

| Имя | Предлагаемый вход | Предварительное условие |
| --- | --- | --- |
| prepare_absence_request | absence_type_id, start_date, end_date | Тип и календарные ограничения проверены по demo-каталогу Go |
| prepare_business_trip_request | destination_id, start_date, end_date, purpose (1–300) | Только учебная заявка без финансовых операций; поля подтверждены Go |
| prepare_benefit_request | benefit_id | Доступность определяется demo-правилами Go, не исторической статьёй |

Даты — ISO date, начало не позже окончания. Согласование обязательности полей и правил — задача 1.1; до него write-tools не публикуются. Общий результат: draft={id,service,operation_type,version,summary,expires_at}. Содержание формирует Go, привязывает к владельцу и immutable snapshot. Наставник/пользователь видят ровно этот состав. Подготовка не отправляет заявку, не создаёт согласие и не меняет прогресс.

request_id и стабильный operation_id передаются служебной meta-информацией, не через LLM. Go атомарно связывает operation_id с владельцем и каноническими аргументами. Повтор возвращает тот же результат; несовместимые аргументы дают CONFLICT. Истёкший черновик требует нового явного запроса, не скрытого нового ключа.

Отправка черновика, принятие согласия и решение наставника выполняются UI → Go с повторной авторизацией, проверкой версии/срока и идемпотентностью. Их MCP-инструменты модели не предоставляются. Оценка Python сохраняется внутренним контрактом с evaluation_id; это не tool complete_task/advance_stage.

## Ошибки

| Код | Поведение |
| --- | --- |
| INVALID_ARGUMENTS / INVALID_RESULT | Не исполнять/не принимать; одна коррекция в бюджете, без трактовки как успех |
| FORBIDDEN / NOT_FOUND / CONTEXT_EXPIRED | Не повторять; не раскрывать закрытые сведения; обновление контекста через Go |
| CONFLICT / DRAFT_EXPIRED / STALE_VERSION | Не менять ключ или версию молча; показать актуальное состояние и требуемое действие |
| TEMPORARILY_UNAVAILABLE / TIMEOUT | Чтение: не более одного retry в бюджете. Подготовка: retry только при гарантированной идемпотентности и том же operation_id; иначе итог unknown |
| INTERNAL_ERROR / LIMIT_EXCEEDED | Безопасная ошибка, без ложного факта выполнения и секретов |

Go определяет фактический итог записи и сохраняет доказательство. Модель не может самостоятельно превратить неизвестный результат в completed. Трассировка требований MCP и [приёмки](evaluation-plan.md).

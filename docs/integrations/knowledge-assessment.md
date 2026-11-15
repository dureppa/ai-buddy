# Go → Python: оценка знаний стажёра

## Учебная Go-интеграция согласий

POST /api/v1/onboarding/consent-review принимает answer текущего стажёра.
Go формирует фиксированную рубрику consent-news-v1, сохраняет версию HR evidence,
вызывает этот endpoint и сверяет IDs, версии, hash, required/pass и актуальность
evidence перед сохранением. Оценка показывается наставнику через staff API.
Одобрение повторно сверяет evidence; решение и completion пишутся транзакционно.
DeepSeek выбирается через AI_LLM_PROVIDER=deepseek. Этот учебный маршрут не
утверждает качество оценивания на общем holdout и не завершает другие этапы.


Go уже вызывает этот endpoint и сохраняет оценку. Полная модельная приёмка на holdout не выполнена. Этот endpoint не завершает онбординг. Форматы — решения команды, не поля из ТЗ.

## Запуск и авторизация

POST `/internal/v1/assessments`, `Content-Type: application/json`, `Authorization: Bearer AI_SERVICE_TOKEN`. Тот же приватный Flask-сервис, что и [чат](go-python-mcp.md); отдельный режим без MCP, делегированного MCP-токена и истории диалога. Go проверяет пользователя, владельца ответа и доступ к рубрике до вызова. Клиенту стажёра сервисный токен не выдаётся.

```bash
AI_AGENT_ENABLED=true AI_LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=ключ DEEPSEEK_MODEL=deepseek-flash AI_SERVICE_TOKEN=local-service-token uv run --locked flask --app ai_buddy:create_app run --host 127.0.0.1 --port 8001
```

Команда из `ai-agent`. MCP_URL для assessment не нужен. GET `/health/ready/assessments` возвращает 200/503 с `{"ready": true/false}` по локальным настройкам, без сети. Это не проверка качества или доступности модели. Старый `/health/ready` относится к чату и требует MCP_URL.

## Входной snapshot

[Схемы и примеры](knowledge-assessment.examples.json) выведены из Pydantic. Все объекты закрыты для лишних полей. UUID: request_id, conversation_id, evaluation_id, answer_id. Остальные id/версии — строки 1–128 символов по Identifier; точный pattern в JSON Schema. Версии не сравниваются Python и не передаются модели.

- question: 1–1200 символов, не только пробелы; answer: 0–4000; context: до 2000, по умолчанию пустой.
- criteria: 1–5, уникальные id; description: 1–200 и expected: 1–400 непустых символов; required: boolean. Хотя бы один критерий обязателен.
- Весь HTTP body ≤64 KiB; сериализованный question/answer/context/criteria ≤12000 UTF-8 байт. Превышение отклоняется до модели, текст не обрезается. Это ограничение размера, не гарантия вместимости в токеновый контекст модели.
- expected — утверждённое знание для сравнения, оно передаётся LLM. Эталонные **вердикты оценщика** из golden dataset остаются вне запроса. Рубрику и контекст Go формирует из доверенной версии задания; стажёр не должен присылать их как свои настройки.

Иллюстративный запрос, не запись из реального корпоративного API:

```json
{
  "request_id": "4fadd566-fccd-5c90-9464-117e4151d903",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "evaluation_id": "627885d8-0880-516e-b11b-bb471da7a868",
  "answer_id": "0dbca8cb-f12f-530a-a262-195352f720dd",
  "task_id": "demo-absence",
  "task_version": "1",
  "plan_version": "1",
  "answer_version": "1",
  "rubric_id": "demo-absence-v1",
  "rubric_version": "1",
  "context_version": "1",
  "question": "Как оформить отсутствие, что означает отправка заявки и кто одобряет переход этапа?",
  "answer": "Открыть раздел «Отсутствия» и нажать «Новая заявка». После отправки заявка на согласовании, ещё не одобрена. Переход одобряет наставник, агент только оценивает знания.",
  "context": "Демо-сервис: раздел «Отсутствия», кнопка «Новая заявка». Отправка означает статус «на согласовании». Переход этапа одобряет наставник, агент только оценивает знания.",
  "criteria": [
    {
      "id": "steps",
      "description": "Объясняет начало оформления.",
      "expected": "Названы раздел Отсутствия и кнопка Новая заявка.",
      "required": true
    },
    {
      "id": "status",
      "description": "Отличает отправку от одобрения.",
      "expected": "После отправки заявка на согласовании, не одобрена автоматически.",
      "required": true
    },
    {
      "id": "reviewer",
      "description": "Знает владельца решения о переходе.",
      "expected": "Переход этапа одобряет наставник, агент только оценивает.",
      "required": true
    }
  ]
}
```

## Результат и его смысл

Следующий ответ показывает валидный контракт. Он построен из эталонных меток для примера, **не является успешным live-ответом Qwen**:

```json
{
  "request_id": "4fadd566-fccd-5c90-9464-117e4151d903",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "assessment": {
    "evaluation_id": "627885d8-0880-516e-b11b-bb471da7a868",
    "answer_id": "0dbca8cb-f12f-530a-a262-195352f720dd",
    "task_id": "demo-absence",
    "task_version": "1",
    "plan_version": "1",
    "answer_version": "1",
    "rubric_id": "demo-absence-v1",
    "rubric_version": "1",
    "context_version": "1",
    "answer_sha256": "beac60a7b1f48da6d4214aaacfd8375b42589fd64454b3d6086c99ca6f18ed2a",
    "prompt_version": "knowledge-assessment-v4",
    "model": "qwen3:4b-q4_K_M",
    "method": "llm",
    "guard_reason": null,
    "criteria": [
      {
        "criterion_id": "steps",
        "required": true,
        "verdict": "pass",
        "reason_code": "matched",
        "reason": "Ответ подтверждает критерий: Объясняет начало оформления.",
        "evidence": {
          "quote": "Открыть раздел «Отсутствия» и нажать «Новая заявка».",
          "start": 0,
          "end": 52
        }
      },
      {
        "criterion_id": "status",
        "required": true,
        "verdict": "pass",
        "reason_code": "matched",
        "reason": "Ответ подтверждает критерий: Отличает отправку от одобрения.",
        "evidence": {
          "quote": "После отправки заявка на согласовании, ещё не одобрена.",
          "start": 53,
          "end": 108
        }
      },
      {
        "criterion_id": "reviewer",
        "required": true,
        "verdict": "pass",
        "reason_code": "matched",
        "reason": "Ответ подтверждает критерий: Знает владельца решения о переходе.",
        "evidence": {
          "quote": "Переход одобряет наставник, агент только оценивает знания.",
          "start": 109,
          "end": 167
        }
      }
    ],
    "recommendation": "ready_for_mentor_review",
    "manual_review_required": true
  }
}
```

В knowledge-assessment-v4 Python сначала выделяет дословные фрагменты answer_evidence с ID. Модель классифицирует критерий и выбирает evidence_id; Python подставляет исходную цитату/позиции, отображает reason_code в verdict и строит краткую reason из типа причины и description. Развёрнутого объяснения LLM этот срез не генерирует.

| reason_code | verdict | Значение |
| --- | --- | --- |
| matched | pass | Знание явно выражено; обязательна дословная цитата |
| contradiction | fail | Прямое противоречие эталону |
| missing | fail | Требуемое знание не раскрыто |
| ambiguous | unclear | Нужен уточняющий ответ |
| not_assessed | unclear | Правило остановило автоматическую оценку |

Цитата берётся из выбранного Python-фрагмента исходного answer, до 80 символов. Неизвестный evidence_id отклоняется; модель не переписывает цитату. evidence.start/end — Unicode code points Python, начало с 0, конец не включён; это **не Go byte offsets и не JavaScript UTF-16 offsets**. ID фрагмента однозначно задаёт исходные позиции, в том числе при повторении одинакового текста. Дословность не доказывает смысловую правильность классификации — её проверяет live-eval и наставник.

Python требует ровно все criterion_id без дубликатов. required, IDs, версии, SHA-256 UTF-8 ответа, prompt_version и configured model задаёт код. Полей approved/completed/advance_stage/score нет. Рекомендация вычисляется по обязательным критериям:

1. Есть fail → needs_revision.
2. Иначе есть unclear → needs_clarification.
3. Иначе → ready_for_mentor_review.

Необязательный fail не блокирует ready_for_mentor_review. **manual_review_required всегда true**; готовность к review не означает одобрение. Даже все pass не меняют этап.

Пустой ответ либо обнаруженные инструкции подмены оценки дают method=rule_guard, guard_reason=empty_answer/untrusted_content, все unclear, needs_clarification, без LLM. Это остановка автоматической оценки, не подтверждённый пробел в знаниях. Эвристика инструкций не гарантирует обнаружение всех атак и может требовать ручного разбора.

## Ошибки и бюджет

| HTTP | code | Причина |
| --- | --- | --- |
| 400 | INVALID_REQUEST | JSON/схема/лимит snapshot/невалидная рубрика |
| 401 | UNAUTHORIZED | Нет правильного service bearer |
| 413 | INVALID_REQUEST | Body больше 64 KiB |
| 415 | INVALID_REQUEST | Неверный Content-Type |
| 503 | AI_UNAVAILABLE | Выключен AI, сеть/модель недоступна или неожиданный сбой |
| 503 | NOT_READY | Не задана модель |
| 503 | AI_TIMEOUT | Модельный или общий deadline |
| 503 | AI_RATE_LIMITED | Провайдер вернул 429 |
| 503 | AI_INVALID_RESPONSE | Невалидный результат после одной коррекции |

Форма: `{"error": {"code": "AI_TIMEOUT", "message": "Запрос не выполнен. Проверьте статус и повторите позже."}}`. При 503 нет assessment и нет фиктивного fail/pass. Go сохраняет ответ и позволяет наставнику оценить вручную с причиной.

Общий AI_TURN_TIMEOUT ≤25 с, AI_MODEL_TIMEOUT по умолчанию 20 с (не выше 25). Максимум два вызова: исходный и одна коррекция JSON/id/цитаты в том же общем бюджете. Сетевой retry отсутствует. Схема ответа проверяется локально, temperature=0, до 768 output tokens. Чат сохраняет свой лимит 384. Go задаёт HTTP-клиенту запас сверх общего AI deadline.

## Что делает Go

1. Сохраняет ответ и доверенный snapshot задания/рубрики; выдаёт evaluation_id и версии до вызова.
2. Вызывает отдельный assessment endpoint, не сериализует его в прежний ChatReply.
3. Перед сохранением сверяет answer_id/hash и актуальность answer/task/plan/rubric/context versions. Поздняя оценка не перезаписывает новый ответ или решение человека.
4. Сохраняет результат, показывает наставнику критерии/цитаты/версии. При ошибке оставляет ручной путь; не теряет ответ.
5. Только аутентифицированное одобрение наставника с повторной проверкой актуальности даёт Go право атомарно применить переход.

Python не хранит БД, не обеспечивает идемпотентность evaluation_id, не проверяет свежесть Go-данных и не вызывает корпоративные инструменты при оценке. Сервисные IDs/версии/токены не включаются в prompt; в логах — только IDs, модель, prompt, счётчики и безопасный исход.

## Проверка качества

[Dataset и правила оценки](../../ai-agent/evals/README.md), [результаты development](../../ai-agent/experiments/assessment-quality.md), [границы OpenSpec](../../openspec/changes/implement-python-agent/assessment-scope.md). Структурная корректность, покрытие тестами и смысловая точность — разные показатели. Для включения автоматического оценивания нужно выбрать модель, пройти размеченные примеры и ручную приёмку. [Общий development](../../ai-agent/evals/reports/README.md) не заменяет такую приёмку.

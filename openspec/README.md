# OpenSpec агента AI Buddy

Обновлено 13 ноября 2026. Активное предложение [implement-python-agent](changes/implement-python-agent/proposal.md) описывает онбординг, с которым работает агент. Реализован ограниченный Python runtime: Flask, прямой локальный Ollama-цикл, read-only MCP, отдельный assessment endpoint и тесты; полный онбординг и Go-интеграция ещё не завершены.

1. [Границы](changes/implement-python-agent/proposal.md).
2. [Источники, решения команды и допущения](changes/implement-python-agent/sources-and-assumptions.md).
3. [Поведение агента в онбординге](changes/implement-python-agent/specs/agent-behavior/spec.md).
4. [MCP](changes/implement-python-agent/mcp-contracts.md) и [требования](changes/implement-python-agent/specs/mcp-tools/spec.md).
5. [Python-сервис](changes/implement-python-agent/specs/python-ai-service/spec.md), [дизайн](changes/implement-python-agent/design.md).
6. [Оценка](changes/implement-python-agent/evaluation-plan.md), [требования качества](changes/implement-python-agent/specs/agent-evaluation/spec.md), [план](changes/implement-python-agent/tasks.md).

Онбординг основан на общем и Backend чек-листах. Корпоративных сервисов ровно шесть; агент оценивает, наставник одобряет, Go применяет переход. Три раздела, рубрики, поля API и demo-статусы — решения команды. Неподтверждённые/недоступные источники явно отмечены.

Исторические SDD доступа и текущий публичный OpenAPI не описывают новую приёмку. Новые схемы должны быть согласованы Go/UI/Python до реализации. Существующие технические сервисы в baseline не являются шестью сервисами из ТЗ. Первый Python-каркас реализован отдельно; Go/UI и публичный API остаются без изменений.

Проверка CLI 1.17.0 из корня проекта:

```bash
openspec validate implement-python-agent --strict --no-interactive
openspec status --change implement-python-agent --json
```

Готовность первого среза и ещё невыполненные задачи разделены в tasks.md. CLI проверяет структуру, а не готовность поведения. Apply и archive не выполнять до отдельного запроса на реализацию и фактической проверки.

Текущий срез: [foundation-scope](changes/implement-python-agent/foundation-scope.md).

Сравнение оркестрации оформлено отдельно: [условия эксперимента](changes/implement-python-agent/agent-loop-experiment.md).

Актуальный runtime: [границы подключения Flask](changes/implement-python-agent/flask-runner-scope.md), [готовность пользовательского сценария](changes/implement-python-agent/scenario-status.md).

Оценка знаний: [Python-срез](changes/implement-python-agent/assessment-scope.md), [контракт Go](../docs/integrations/knowledge-assessment.md), [черновой gold dataset](../services/ai-python/evals/README.md). Контракт реализован, локальная LLM не прошла development-проверку; Go/admin integration и общий holdout остаются открыты.

Общий golden dataset: [20 development / 10 candidate holdout](../services/ai-python/evals/agent-v1/README.md), [границы](changes/implement-python-agent/golden-dataset-scope.md). Набор подготовлен, метки требуют review, live/holdout не выполнены; 4 кейса заблокированы будущей интеграцией. [Дополнительный контроль качества](../docs/ai/quality-control.md).

[Локальный Python MCP](changes/implement-python-agent/mcp-demo-scope.md) реализует два read-tools на синтетических данных; Go HTTP backend ещё не подключён.

[Go HTTP-адаптер](changes/implement-python-agent/go-http-adapter-scope.md) реализован на Python и проверен на моках: resolve, изоляция пользователей, два чтения, безопасные ошибки и таймауты. Живая Go-интеграция и сохранение результатов остаются отдельной приёмкой.

[Development harness](changes/implement-python-agent/eval-harness-scope.md) реализован с фактическими MCP-вызовами и отдельным assisted-review; [результаты](../services/ai-python/evals/reports/README.md). Holdout не запускался.

[Текущий harness](changes/implement-python-agent/current-harness-scope.md) поддерживает DeepSeek/Ollama и каталог 11 MCP tools на синтетических fixtures. Legacy agent-v1 сохраняется отдельно от проверки новых контрактов; живые запросы требуют явного включения.

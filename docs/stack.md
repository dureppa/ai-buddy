# Стек AI Buddy

Кейс называет Go, Python с Flask для отдельных сервисов, PostgreSQL и Redis, React и TypeScript с TanStack, Zustand и Zod. Для AI-сценариев кейс требует спецификации поведения агента и его инструментов. Совместимость с этим стеком оценивается по архитектуре. Версии и дополнительные инструменты в таблице выбраны для нашего прототипа. [Материалы Авито](avito-sources.md)

| Компонент | Требования проекта | Где зафиксированы версии |
| --- | --- | --- |
| Go API и инструменты | Go 1.26.11, стандартные `net/http` и `encoding/json` для HTTP/JSON, pgx/v5 5.12.0 для PostgreSQL, MCP-сервер реализуется на Python, Go предоставляет обычный HTTP API; Go MCP SDK не требуется. | [go.mod](../services/backend-go/go.mod), [go.sum](../services/backend-go/go.sum) |
| Данные | PostgreSQL 17 для пользователей, чек-листов, прогресса и заявок. Схему изменяем SQL-миграциями. Redis применяем при появлении конкретной задачи кеширования или временного состояния. | Версию образа закрепить при добавлении PostgreSQL в Docker Compose. [Поддержка PostgreSQL](https://www.postgresql.org/support/versioning/) |
| AI-сервис | Python 3.13, Flask 3.1.3, официальный MCP SDK 1.30.0; Pydantic 2.14.3 для схем и httpx 0.28.1 для ограниченного транспорта. Starlette 1.10.0/Uvicorn 0.54.0 явно подключены для отдельного Python MCP ASGI-сервера. Зависимости и виртуальное окружение управляются через uv. | [.python-version](../services/ai-python/.python-version), [pyproject.toml](../services/ai-python/pyproject.toml), [uv.lock](../services/ai-python/uv.lock) |
| Веб | React 19, TypeScript 6.0.3, Vite 8 и Node.js 24.22.2 LTS. React Router 7 для страниц, TanStack Query 5 для серверных данных, Zod 4 для проверки входных данных. Сейчас экраны используют локальный demo-adapter. Zustand подключаем для общего клиентского состояния, когда появляется такая потребность. | [package.json веба](../apps/web/package.json), [общие инструменты](../package.json), [package-lock.json](../package-lock.json) |
| Расширение | Chromium Manifest V3 для прототипа, React и TypeScript для интерфейса, типы Chrome API. Сейчас контекст страницы сопоставляется локальным adapter-ом. Будущий API-клиент будет подключён по OpenAPI. | [package.json расширения](../apps/extension/package.json), [package-lock.json](../package-lock.json) |

Корпоративные демосайты используют те же React, TypeScript и Vite. Они собираются в отдельные статические сайты из [одного workspace](components/corporate-services.md).

### Контракты и интеграции

- Описывай публичное HTTP API Go в OpenAPI. Проверяй права, данные и подтверждение операции в Go перед вызовом имитации корпоративного API. PostgreSQL хранит результат операции и статус. Python получает контекст от Go, вызывает LLM и MCP-инструменты и возвращает результат. [AvitoTech Playbook](https://github.com/avito-tech/playbook/blob/master/development-principles.md), [пример backend-задания](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Backend/Backend-trainee-assignment-autumn-2026/Backend-trainee-assignment-autumn-2026.md)
- Для MCP используй официальные SDK. До реализации AI-сценария зафиксируй его входы, результаты, вызовы инструментов, ошибки и проверки прав в спецификации в `docs/`. Кейс приводит spec-kit и OpenSpec как примеры SDD. Для Python-агента подготовлен [пакет OpenSpec](../openspec/README.md) в формате spec-driven, проверенный CLI 1.17.0. CLI использован отдельно от зависимостей приложения; Flask подключает native Ollama и два MCP read-tools; экспериментальный LangChain остаётся в dev-группе, runtime его не импортирует. Go/UI этим срезом не меняются. [MCP Go SDK](https://github.com/modelcontextprotocol/go-sdk), [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk), [OpenSpec](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md)
- Для прототипа используй Docker Compose и GitHub Actions по мере появления сервисов и проверок. Grafana и Clickstream подходят для наблюдаемости и событий, RPC и Kafka для взаимодействий, если они понадобятся сценариям. Корпоративные интеграции и аналитика демонстрируются на тестовых данных и имитациях.

### Локальная установка

**Python.** Из `services/ai-python/` выполни `uv sync --locked`. uv создаёт `.venv` на Python 3.13. Запускай команды как `uv run --locked …`. Меняй зависимости через `uv add` и `uv remove`, затем коммить манифест и `uv.lock`. Для этого сервиса выбран uv как единый менеджер зависимостей. [Документация uv](https://docs.astral.sh/uv/concepts/projects/sync/)

**Go.** Из `services/backend-go/` выполни `go mod download` и `go mod verify`. Манифест фиксирует зависимости будущего кода PostgreSQL и MCP. С появлением импортов поддерживай `go.mod` и `go.sum` командой `go mod tidy` и коммить вместе. [Документация Go Modules](https://go.dev/ref/mod)

**Веб и расширение.** Используй Node из [.nvmrc](../.nvmrc) и npm 11. Установи оба workspace из корня через `npm ci`. При изменении зависимостей обновляй соответствующий манифест и общий `package-lock.json`. [Релизы Node.js](https://nodejs.org/en/about/previous-releases), [npm Workspaces](https://docs.npmjs.com/cli/using-npm/workspaces), [Vite](https://vite.dev/guide/)

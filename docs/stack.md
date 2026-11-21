# Стек AI Buddy

Кейс называет Go, Python с Flask для отдельных сервисов, PostgreSQL и Redis, React и TypeScript с TanStack, Zustand и Zod. Совместимость оценивается по архитектуре, а не по тому, что подключены все перечисленные технологии. Версии прототипа зафиксированы ниже. [Материалы Авито](avito-sources.md)

| Компонент | Что используется | Где зафиксирована версия |
| --- | --- | --- |
| Go API | Go 1.26.11, `net/http`, `encoding/json`, pgx/v5 5.12.0 | [go.mod](../web/backend/go.mod) |
| Данные | PostgreSQL 17 в Compose. Схема меняется SQL-миграциями | `postgres:17-alpine` в `docker-compose.yml` |
| AI-сервис | Python 3.13, Flask 3.1.3, MCP SDK 1.30.0, Pydantic 2.14.3, httpx 0.28.1. Модель — DeepSeek `deepseek-flash` через httpx | [pyproject.toml](../ai-agent/pyproject.toml), [uv.lock](../ai-agent/uv.lock) |
| Веб | React 19, TypeScript 6.0.3, Vite 8, Node.js 24.22.2, React Router 7, TanStack Query 5, Zod 4 | [package.json](../web/package.json), [.nvmrc](../.nvmrc) |
| Расширение | Chromium Manifest V3, React и TypeScript | [package.json](../extension/package.json) |

Redis, Zustand, Kafka, Grafana и Clickstream не подключены: для текущих сценариев нет отдельной задачи кеша, общего клиентского хранилища, шины событий или дашборда. Корпоративные сервисы — учебные HTTP API со своими базами, не новые HR-системы.

Поведение агента и инструментов описано в `docs/specs/`. Схемы MCP — в `contracts/agent-tools.json`, публичный HTTP — в `contracts/openapi.yaml`.

### Локальная установка

Для нагрузочных тестов достаточно Python 3.10+ и `sh`: `./load_test.sh`
подготавливает закреплённые инструменты в `.load-tools/` внутри проекта,
без Docker, just и изменения глобального PATH. [Инструкция](load-testing.md).

**Python.** Из `ai-agent/` выполни `uv sync --locked`. Команды запускай как `uv run --locked …`. Зависимости меняй через `uv add` и `uv remove` и коммить `pyproject.toml` вместе с `uv.lock`.

**Go.** Из `web/backend/` выполни `go mod download`. После изменения импортов — `go mod tidy`, коммить `go.mod` и `go.sum`.

**Веб и расширение.** Node из [.nvmrc](../.nvmrc), npm 11. Из корня: `npm ci`.

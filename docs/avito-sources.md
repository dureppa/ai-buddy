# Материалы Авито

Кейс Hack&Change 2026 «AI-buddy: ИИ-наставник для стажёров» на с. 7 и 10–12 задаёт сценарии, критерии совместимости со стеком, SDD, требования к проверке прав и покрытию. На с. 15 перечислены источники ниже. Версии и библиотеки, выбранные для прототипа, зафиксированы в [стеке AI Buddy](stack.md).

| Источник со слайда | Что используем |
| --- | --- |
| [Чек-лист стажёра](https://docs.google.com/spreadsheets/d/1qKFqOzfSZ2jEz57jBSmq7rukDXi_tRfWohgemViceV0/edit?usp=sharing) | Общий лист даёт сценарии знакомства с командой, доступов к Confluence и Jira, встреч с наставником, прогресса, экватора и опросов. Лист Backend указывает на Effective Go, документацию Go, API, базы данных и инструменты из следующего раздела. |
| [AvitoTech Playbook](https://github.com/avito-tech/playbook) | Проектирование с учётом текущей архитектуры, повторное использование компонентов, простые решения и поддерживаемые интерфейсы. Для деталей см. [принципы разработки](https://github.com/avito-tech/playbook/blob/master/development-principles.md), [инженерные практики](https://github.com/avito-tech/playbook/blob/master/avito-developer-practice.md) и [ревью технического дизайна](https://github.com/avito-tech/playbook/blob/master/tech_design_review.md). |
| [Блог AvitoTech на Хабре](https://habr.com/ru/companies/avito/articles/) | Примеры отдельных практик и команд. [Материал о Go в 2026 году](https://habr.com/ru/companies/avito/articles/1091694/) разбирает Go 1.25/1.26 и диагностику горутин. [Материал об API-тестах](https://habr.com/ru/companies/avito/articles/844370/) описывает тестирование на Go на основе Testify в команде Marketplace. |
| [AvitoTech](https://avito.tech/) | Инженерный портал с публикациями по backend, frontend, Go, Python, инфраструктуре и дизайну. Используем его для поиска материалов конкретных команд. |
| [AvitoTech Internship](https://github.com/avito-tech/tech-internship) | Открытые задания и примеры. Указанные там версии относятся к конкретным заданиям и приведены ниже. |
| [Библиотека дизайн-системы Авито в Figma](https://habr.com/ru/companies/avito/articles/543450/) | Веб-компоненты, согласованные цвета и типографика, варианты состояний и спецификации для разработчиков. [Правила применения в проекте](components/web.md#дизайн-и-компоненты) описаны в документации веба. |
| [Стажировки в Авито](https://start.avito.ru/internships) | Контекст программы и направлений стажировки для демонстрационного онбординга. |
| [Доклад о дизайн-системе](https://rutube.ru/video/6a203a00a9ef7cdd25d811a01cacd61b/) | Плеер не открылся в рабочей среде. По [описанию видео](https://rutube.ru/api/video/6a203a00a9ef7cdd25d811a01cacd61b/?format=json), Филипп Соломин рассказывает об устройстве дизайн-системы и работе с ней. Для подробностей использовали [его статью](https://habr.com/ru/companies/avito/articles/699652/). |

## Версии в опубликованных примерах

- Backend, осень 2026. Предпочтительные языки — Go и Python. В задании ожидаются Docker Compose, миграции и OpenAPI. Общий минимум версии языка там не задан. [Задание backend](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Backend/Backend-trainee-assignment-autumn-2026/Backend-trainee-assignment-autumn-2026.md)
- Backend, зима 2025. В демонстрационных Dockerfile указаны Go 1.22 и Python 3.6 с командой запуска Flask. Это версии примеров того набора. [Go Dockerfile](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Backend/Backend-trainee-assignment-winter-2025/docker_compose_examples/docker_compose_examples/go/Dockerfile), [Python Dockerfile](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Backend/Backend-trainee-assignment-winter-2025/docker_compose_examples/docker_compose_examples/python/Dockerfile)
- Frontend, осень 2026. Клиентское задание требует Node.js 20+, React 18+, TypeScript и `react-router-dom`. Манифест предоставленного учебного API задаёт TypeScript `^6.0.3`, Zod `^4.4.3` и Vitest `^4.1.10`. [Задание frontend](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Frontend/Frontend-trainee-assignment-autumn-2026/Frontend-trainee-assignment-autumn-2026.md), [манифест учебного API](https://github.com/avito-tech/tech-internship/blob/main/Tech%20Internships/Frontend/Frontend-trainee-assignment-autumn-2026/server/package.json)
- В открытых Python-проектах Avito Ads SDK и Aqueduct минимальная поддерживаемая версия — Python 3.8. Avito Ads SDK использует httpx, поддерживает интеграцию с Flask и проверяется `mypy --strict`. Это требования к самим библиотекам. [Avito Ads Python SDK](https://github.com/avito-tech/avito-ads-sdk-python3#требования), [Aqueduct setup.py](https://github.com/avito-tech/aqueduct/blob/main/setup.py)
- Открытый менеджер транзакций AvitoTech поддерживает `database/sql`, sqlx, GORM и pgx, в том числе pgx/v5. Модуль драйвера объявляет Go 1.19 и pgx/v5 v5.5.4. Эти версии описывают зависимость конкретного модуля. [AvitoTech Go Transaction Manager](https://github.com/avito-tech/go-transaction-manager), [go.mod драйвера](https://github.com/avito-tech/go-transaction-manager/blob/master/drivers/pgxv5/go.mod)

Доступные материалы дают версии отдельных проектов и заданий. Единая матрица версий сервисов Авито в этих источниках не опубликована.

## Инструменты из чек-листа Backend

- Для качества Go-кода используй [Effective Go](https://go.dev/doc/effective_go) и [документацию Go](https://go.dev/doc/) вместе со [стандартами проекта](engineering.md#go).
- Bruno или Charles, Lens для Kubernetes, Grafana, Sentry и Redash в чек-листе выступают темами освоения инструментов. Для прототипа бери из них те, которые нужны выбранному сценарию или проверке. Например, ручную проверку HTTP API можно проводить в Bruno.
- `avito-cli`, Stash, PaaS и Observer можно описывать в демонстрационных материалах по онбордингу Backend. Интеграции прототипа для таких сценариев работают через имитации на синтетических данных.

# Continuous delivery

После CI для push в main workflow Deploy проверяет успешные frontend/python/go/
repository именно у завершившегося run attempt, сверяет SHA с текущим main и
передаёт git archive этого SHA по SSH. PR, чужой репозиторий, неуспешный CI и
устаревший SHA не деплоятся. Production concurrency не отменяет текущий деплой.
Workflow имеет только contents:read/actions:read; API-ключ LLM остаётся на сервере.

Actions secrets: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS.
Это отдельный SSH-ключ с restrict и forced command: разрешены только
`deploy <40-hex-SHA>` и `status <SHA>`. Обычная shell, forwarding и PTY запрещены.
Ключ хоста закреплён в known_hosts; StrictHostKeyChecking=yes обязателен.

На сервере доверенный dispatcher получает ограниченный tar, отклоняет traversal,
symlinks, спецфайлы, .env/.deploy/backups и запускает процесс вне SSH-сессии.
Файлы секретов не обновляются из Git. Новый source release хранится отдельно;
.env и сгенерированная nginx-защита подключаются из постоянного каталога.
flock не допускает параллельных обновлений. Образы собираются строго по одному,
пока предыдущие контейнеры обслуживают запросы. Перед up сохраняются дамп всего
PostgreSQL-кластера, старые image IDs и конфигурация веба.

После up --wait проверяется парольный HTTP 401 без gate-cookie, затем Basic login,
cookie + Bearer API и onboarding. Успех атомарно записывает current release/SHA.
При ошибке up/проверок восстанавливаются прежние image tags и конфигурация и
запускается предыдущий release. При ошибке сборки работающие контейнеры не
меняются. Дамп БД не восстанавливается автоматически: SQL-миграции должны быть
обратно совместимы; их откат требует отдельного решения, чтобы не потерять новые
записи. Автоудаления томов, backup и старых release нет.

SSH-процесс запускает detached worker; обрыв CI не прерывает переключение.
Workflow опрашивает status до готовности или явной ошибки. Повтор SHA с ready
идемпотентен; повтор running не создаёт второй worker. Неизвестный SHA не
интерпретируется как успех. Статусы и server logs не содержат ключей или пароля.

Установка: scripts/deploy/install.sh подготавливает root-owned dispatcher и
worker, а также отдельный authorized_keys entry. Путь проекта и публичный SSH-ключ
передаются аргументами; адрес сервера и реальные ключи в Git не хранятся.
Оба Python-скрипта используют стандартную библиотеку сервера; нужны python3,
Docker Compose, tar/openssl и существующие .env/.deploy auth файлы.

Источники: [workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

Проверки реализации: just check прошёл (PostgreSQL store-тесты локально не
повторялись: в этой инфраструктурной задаче не поднималась локальная БД; CI go
предоставляет отдельную PostgreSQL). Итоговый Python-прогон с coverage скриптов:
401 тест, 90,29%. 17 тестов CD покрывают границы архива, CI gate, backup, HTTP,
повторные запросы, успешный переход, отказ сборки, rollback и rollback_failed.
Actionlint v1.7.7 и bash -n прошли. Отдельный ключ на сервере проверен: status
доступен, произвольная shell-команда отклоняется; рабочее приложение не менялось.

Jira добавлена в последовательную сборку. Серверный overlay активирует её
без дополнительного профиля; существующая отдельная Jira-БД резервируется в
`jira-database.sql.gz`. Проверка готовности включает вход и чтение Jira-задач
на 5189. Для перехода со старого набора сервисов нужно один раз обновить
установленный root-owned worker через install.sh: доверенный код вне release
не заменяется автоматически архивом PR.

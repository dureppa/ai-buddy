# Браузерное расширение

В [apps/extension](../../extension/) зафиксированы React и типы Chrome API. Исходники, Manifest V3 и frontend-конфигурация находятся в [extension/frontend](../../extension/frontend/). TypeScript и Vite берём из корневого npm workspace. Content script с `matches: ["<all_urls>"]` добавляет плавающего Buddy на обычные страницы, а service worker хранит состояние и отвечает на вопросы. [Манифест зависимостей](../../extension/package.json), [Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)

Расширение показывает питомца справа внизу каждой обычной веб-страницы. При наведении появляется действие «Задать вопрос», а по клику раскрывается компактный чат. Вопрос получает URL, заголовок и выделенный текст текущей страницы. В текущем фронтенд-прототипе `src/assistant.ts` отвечает локально через service worker. После подключения API этот adapter можно заменить вызовом Go по контракту OpenAPI. Popup остаётся доступным как дополнительный вход. На каждой вкладке content script создаёт новый экземпляр виджета, поэтому визуально питомец сопровождает пользователя при переходах между вкладками.

### Карта расширения

- `frontend/src/main.tsx` — popup, поле вопроса, состояние ожидания, ответ и переход в веб-приложение.
- `frontend/src/content.ts` — плавающий Shadow DOM-виджет, hover-действие и мини-чат поверх страницы.
- `frontend/src/background.ts` — service worker для storage и ответов Buddy.
- `frontend/src/assistant.ts` — локальный ответчик по контексту страницы.
- `frontend/src/context.ts` — совместимый helper для проверки URL тестовой страницы.
- `frontend/src/styles.css` — компактная версия палитры и motion-принципов popup.
- `frontend/public/manifest.json` — Manifest V3 с `storage`, `host_permissions` и content script на обычных страницах.
- `frontend/assets/inter.woff2` — локальный шрифт popup с лицензией рядом.

Сборка выполняется командой `npm run build --workspace=@ai-buddy/extension`. При другом адресе веб-прототипа скопируй [`.env.example`](../../extension/.env.example) в `.env` и укажи `VITE_WEB_URL`. Каталог `extension/dist/` загружается в Chromium через страницу расширений в режиме разработчика. После установки Chrome один раз попросит разрешение на работу с сайтами. После этого content script появляется автоматически на обычных веб-страницах. Системные страницы Chrome и Chrome Web Store недоступны для content script.

Для интерфейса питомца и быстрых вопросов придерживайся [правил оформления веба](web.md#дизайн-и-компоненты). При реализации зафиксируй поддерживаемые браузеры и страницы, манифест и разрешения, точки входа, правила отбора контекста и команды сборки, установки и проверки.

# Корпоративные демосайты

AI Buddy открывает шесть самостоятельных сайтов по карточкам и результатам поиска. Общие React-компоненты, оформление и демоадаптер находятся в npm workspace `apps/corporate-services`.

| Сайт | Адрес по умолчанию | Переменная в `apps/web/frontend/.env` | Сборка в `apps/corporate-services/dist/` |
| --- | --- | --- | --- |
| Отсутствия | http://localhost:5181/ | `VITE_ABSENCES_URL` | `absences/` |
| Командировки | http://localhost:5182/ | `VITE_TRIPS_URL` | `trips/` |
| Найм | http://localhost:5183/ | `VITE_HIRING_URL` | `hiring/` |
| Увольнения | http://localhost:5184/ | `VITE_OFFBOARDING_URL` | `offboarding/` |
| Согласия | http://localhost:5185/ | `VITE_CONSENTS_URL` | `consents/` |
| Бенефиты | http://localhost:5186/ | `VITE_BENEFITS_URL` | `benefits/` |

Запуск всех сайтов из корня репозитория после `npm ci`

```bash
npm run dev --workspace=@ai-buddy/corporate-services
```

Для одного сайта передай его идентификатор, например `npm run dev --workspace=@ai-buddy/corporate-services -- absences`. Сборка всех сайтов выполняется командой `npm run build --workspace=@ai-buddy/corporate-services`. Каждый каталог сборки можно опубликовать отдельно. Для ссылки возврата в AI Buddy настрой `VITE_AI_BUDDY_URL` в `apps/corporate-services/frontend/.env` перед запуском или сборкой.

- `sites.mjs` запускает и собирает сайты по карте `frontend/service-ports.json`.
- `frontend/src/main.tsx` выбирает страницу для конкретной сборки, `HrPages.tsx` содержит интерфейсы.
- `hr-demo.ts` проверяет действия и хранит демозаписи в `localStorage` текущего сайта. `hr-profiles.json` содержит синтетические начальные настройки.
- `npm test --workspace=@ai-buddy/corporate-services` запускает проверки правил, истории и профилей. CI выполняет их в общей job `frontend`.

## Подключение серверов

У каждого сайта предусмотрен отдельный будущий API. Спецификация перечисляет [сценарии и правила сервисов](../specs/003-hr-services.md). При интеграции публичный контракт уточняется с владельцем соответствующего Go-мока. Сайт и инструмент агента будут обращаться к одному API, а сервис будет проверять личность сотрудника, права и состояние своих данных. Внешние ссылки передают адрес страницы. Общий вход и серверные API подключаются отдельной задачей.

Предлагаемые операции для первого подключения перечислены ниже. Пути относятся к API соответствующего сайта. Каждый API определяет сотрудника по серверной сессии или токену.

| Сервис | Чтение для страницы и агента | Действие |
| --- | --- | --- |
| Отсутствия | `GET /api/v1/me/absence-summary` — баланс, ближайшая дата, заявки | `POST /api/v1/me/absence-requests` — даты начала и окончания |
| Командировки | `GET /api/v1/me/travel-summary` — право на поездку, лимит, заявки | `POST /api/v1/me/trip-requests` — город, дата, смета |
| Найм | `GET /api/v1/me/referral-summary` — вакансии, лимит, рекомендации | `POST /api/v1/me/referrals` — вакансия, имя и почта кандидата |
| Увольнения | `GET /api/v1/me/offboarding` — шаги, срок уведомления, черновик | `PUT /api/v1/me/offboarding/checklist/{step}` — отметка шага, `POST /api/v1/me/offboarding/draft` — дата для черновика |
| Согласия | `GET /api/v1/me/consents` — цели и текущие состояния | `PUT /api/v1/me/consents/{purpose}` — предоставить или отозвать согласие |
| Бенефиты | `GET /api/v1/me/benefit-summary` — доступные программы, бюджет, заявки | `POST /api/v1/me/benefit-requests` — программа компенсации |

BEGIN;

INSERT INTO teams (id, name, product, lead_name, lead_contact) VALUES
    ('product-design', 'Дизайн продукта', 'Поиск и знакомство с предложениями',
     'Алексей Морозов', 'alexey@design.example')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name, role, team_id, mentor_name, mentor_contact, internship_started_on) VALUES
    ('olga',  'Ольга Соколова',  'Стажёр · продуктовый дизайнер', 'product-design', 'Анна Ким', 'anna@design.example', DATE '2026-11-16'),
    ('sasha', 'Александр Ким',   'Стажёр · продуктовый дизайнер', 'product-design', 'Анна Ким', 'anna@design.example', DATE '2026-08-19'),
    ('maria', 'Мария Лебедева',  'Стажёр · продуктовый дизайнер', 'product-design', 'Анна Ким', 'anna@design.example', DATE '2026-05-21')
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_members (team_id, name, role, contact) VALUES
    ('product-design', 'Алексей Морозов', 'Лид команды',          'alexey@design.example'),
    ('product-design', 'Анна Ким',         'Старший дизайнер',     'anna@design.example'),
    ('product-design', 'Дарья Волкова',    'Продуктовый дизайнер', 'daria@design.example'),
    ('product-design', 'Максим Орлов',     'Frontend-инженер',     'max@design.example'),
    ('product-design', 'Елена Савина',     'Продакт-менеджер',     'elena@design.example')
ON CONFLICT (team_id, name) DO NOTHING;

INSERT INTO services (id, name, description) VALUES
    ('figma',      'Figma',      'Макеты, прототипы и библиотека компонентов.'),
    ('confluence', 'Confluence', 'База знаний, процессы и документация по продукту.'),
    ('grafana',    'Grafana',    'Дашборды и метрики пользовательских сценариев.'),
    ('jira',       'Jira',       'Задачи, планирование и статусы команды.'),
    ('mattermost', 'Mattermost', 'Чаты, обсуждения и объявления команды.'),
    ('drive',      'Диск команды', 'Шаблоны презентаций и материалы для встреч.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_request_permissions (profile_id, service_id) VALUES
    ('olga',  'grafana'), ('olga',  'jira'),
    ('sasha', 'jira'),
    ('maria', 'grafana'), ('maria', 'jira')
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_tasks (id, title, guidance, action_url, sort_order) VALUES
    ('papers', 'Подписать документы',
     'Проверь комплект документов в демонстрационном кадровом кабинете. Если какого-то документа нет, напиши куратору стажировки.',
     '/resources?article=documents', 1),
    ('intro', 'Познакомиться с лидом',
     'На встрече обсудите цели стажировки, задачи команды и то, как будет устроена обратная связь. Подготовь пару вопросов о продукте.',
     NULL, 2),
    ('equipment', 'Проверить рабочую технику',
     'Убедись, что ноутбук подключается к сети, открывается корпоративная почта, а камера и микрофон работают.',
     '/resources?article=equipment', 3),
    ('safety', 'Пройти обязательные курсы',
     'Открой учебный портал и пройди вводные материалы по охране труда и пожарной безопасности. Затем отметь этот шаг выполненным.',
     '/resources?article=learning', 4),
    ('welcome', 'Посмотреть приветствие Buddy',
     'Посмотри план адаптации и открой чат. Buddy поможет найти нужного человека или подсказать следующий шаг.',
     NULL, 5),
    ('account', 'Настроить рабочий аккаунт',
     'Проверь имя и контакты в рабочем профиле и убедись, что получаешь письма.',
     NULL, 6),
    ('chat-join', 'Вступить в чат команды',
     'В командном чате можно представиться и задать организационные вопросы.',
     NULL, 7),
    ('team-meet', 'Познакомиться с командой',
     'Посмотри, кто за что отвечает, и договорись о коротком знакомстве с наставником.',
     NULL, 8),
    ('product', 'Изучить продукт',
     'Начни с обзора продукта. Запиши вопросы о пользователях и ближайших задачах для обсуждения с лидом.',
     '/resources?article=product', 9),
    ('access', 'Запросить рабочие доступы',
     'На странице «Инструменты и доступы» выбери нужный сервис и подтверди заявку в чате Buddy.',
     NULL, 10),
    ('first-task', 'Обсудить первую задачу',
     'На встрече с наставником согласуй цель, критерии готовности и сроки первой задачи.',
     NULL, 11),
    ('review', 'Подвести первые итоги',
     'Подготовь краткий список того, что получилось, и вопросов, которые стоит обсудить на встрече.',
     NULL, 12)
ON CONFLICT (id) DO NOTHING;

INSERT INTO onboarding_progress (profile_id, task_id) VALUES
    ('olga', 'welcome'), ('olga', 'account'), ('olga', 'chat-join'),
    ('sasha', 'papers'), ('sasha', 'intro'), ('sasha', 'equipment'), ('sasha', 'safety'),
    ('sasha', 'welcome'), ('sasha', 'account'), ('sasha', 'chat-join'), ('sasha', 'team-meet'),
    ('sasha', 'product'), ('sasha', 'access'),
    ('maria', 'papers'), ('maria', 'intro'), ('maria', 'equipment'), ('maria', 'safety'),
    ('maria', 'welcome'), ('maria', 'account'), ('maria', 'chat-join'), ('maria', 'team-meet'),
    ('maria', 'product'), ('maria', 'access'), ('maria', 'first-task'), ('maria', 'review')
ON CONFLICT DO NOTHING;

INSERT INTO access_request_drafts (id, profile_id, service_id, expires_at) VALUES
    ('11111111-1111-1111-1111-111111111111', 'maria', 'grafana', now() + interval '15 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO access_requests (id, draft_id, profile_id, service_id, number) VALUES
    ('22222222-2222-2222-2222-222222222222',
     '11111111-1111-1111-1111-111111111111', 'maria', 'grafana', 'Д-001')
ON CONFLICT (id) DO NOTHING;

SELECT setval('access_request_number_seq',
    GREATEST((SELECT last_value FROM access_request_number_seq), 1), true);

INSERT INTO page_guides (url, title, guidance) VALUES
    ('http://localhost:5173/tools', 'Инструменты и доступы',
     'Выбери карточку нужного сервиса, например Grafana. В подробностях нажми «Подготовить заявку», а затем подтверди её в чате.')
ON CONFLICT (url) DO NOTHING;

INSERT INTO knowledge_articles (id, title, url, content) VALUES
    ('documents', 'Документы и инструкции', 'http://localhost:5187/',
     'В учебном сервисе документов можно отметить памятки прочитанными: оформление в первый день, правила первого дня и подписание документов. Отметка сохраняется сервером для текущего стажёра. Агент может проверить текущее состояние, но не меняет отметки и не одобряет этап онбординга.'),
    ('product', 'Путеводитель по продукту', '/resources?article=product',
     'Команда улучшает поиск и знакомство с предложениями. В первые недели изучи пользовательский путь, текущие задачи и библиотеку компонентов.'),
    ('learning', 'Учебный портал', '/resources?article=learning',
     'Начни с вводного курса, охраны труда и пожарной безопасности. В плане адаптации укажи, когда закончишь обучение.'),
    ('timeoff', 'Отпуска и выходные', '/resources?article=timeoff',
     'В этом учебном сценарии сначала согласуй дату с лидом и уточни дальнейшие шаги у HR. Для рабочего запроса используй актуальные инструкции своей компании.'),
    ('equipment', 'Рабочее место и IT', '/resources?article=equipment',
     'Проверь вход в почту, камеру и микрофон. Если подключение не работает, запиши устройство и симптом и передай их IT-поддержке.'),
    ('contacts', 'Полезные контакты', '/resources?article=contacts',
     'По задачам пиши лидеру команды Алексею. По первым шагам обратись к Анне. По оформлению и обучению поможет куратор стажировки.'),
    ('meetups', 'Корпоративные мероприятия', 'http://localhost:5188/',
     'В учебном сервисе мероприятий можно записаться на знакомство с командой, вводное обучение и встречу по первым результатам. Запись сохраняется сервером для текущего стажёра. Агент может проверить текущее состояние, но не меняет записи и не одобряет этап онбординга.')
ON CONFLICT (id) DO NOTHING;

COMMIT;
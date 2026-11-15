ALTER TABLE teams ADD COLUMN guide_brief text;

CREATE TABLE team_guides (
    team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
    cards jsonb,
    lease_until timestamptz NOT NULL DEFAULT '-infinity',
    attempt bigint NOT NULL DEFAULT 0,
    CHECK ((status = 'ready') = (cards IS NOT NULL))
);

INSERT INTO teams (id, name, product, lead_name, lead_contact, guide_brief) VALUES
    ('delivery', 'Путь заказа', 'Авито Доставка', 'Алексей Морозов', 'alexey@delivery.example', 'Изучает, где покупатели прерывают оформление доставки, и помогает упростить этот путь.'),
    ('travel', 'Бронирование жилья', 'Авито Путешествия', 'Екатерина Павлова', 'ekaterina@travel.example', 'Развивает сервисы проверки доступности жилья, подтверждения и отмены брони.'),
    ('autoteca', 'Качество отчётов', 'Автотека', 'Роман Громов', 'roman@autoteca.example', 'Проверяет поиск по VIN и госномеру и то, как данные об автомобиле отображаются в отчёте.'),
    ('help', 'Участие в проектах', '#яПомогаю', 'Михаил Орлов', 'mikhail@help.example', 'Проектирует страницы социальных и экологических инициатив и путь пользователя до участия.')
ON CONFLICT (id) DO UPDATE SET guide_brief = EXCLUDED.guide_brief;

INSERT INTO profiles (id, display_name, role, team_id, mentor_name, mentor_contact, internship_started_on) VALUES
    ('olga', 'Ольга Соколова', 'Стажёр · продуктовый аналитик', 'delivery', 'Анна Ким', 'anna@delivery.example', '2026-11-16'),
    ('sasha', 'Александр Ким', 'Стажёр · бэкенд-разработчик', 'travel', 'Илья Воронцов', 'ilya@travel.example', '2026-08-19'),
    ('timur', 'Тимур Алиев', 'Стажёр · тестировщик', 'autoteca', 'Нина Белова', 'nina@autoteca.example', '2026-11-16'),
    ('maria', 'Мария Лебедева', 'Стажёр · веб-дизайнер', 'help', 'Дарья Волкова', 'daria@help.example', '2026-05-21')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, team_id = EXCLUDED.team_id,
    mentor_name = EXCLUDED.mentor_name, mentor_contact = EXCLUDED.mentor_contact;

INSERT INTO team_members (team_id, name, role, contact) VALUES
    ('delivery', 'Алексей Морозов', 'Руководитель · Продакт-менеджер', 'alexey@delivery.example'),
    ('delivery', 'Анна Ким', 'Наставник · Старший продуктовый аналитик', 'anna@delivery.example'),
    ('delivery', 'Алина Котова', 'Аналитик данных', 'alina@delivery.example'),
    ('delivery', 'Денис Власов', 'Бэкенд-разработчик', 'denis@delivery.example'),
    ('delivery', 'Вера Никифорова', 'Продуктовый дизайнер', 'vera@delivery.example'),
    ('travel', 'Екатерина Павлова', 'Руководитель · Тимлид разработки', 'ekaterina@travel.example'),
    ('travel', 'Илья Воронцов', 'Наставник · Старший бэкенд-разработчик', 'ilya@travel.example'),
    ('travel', 'Артём Сидоров', 'Бэкенд-разработчик', 'artem@travel.example'),
    ('travel', 'Полина Захарова', 'Инженер по тестированию', 'polina@travel.example'),
    ('travel', 'Кирилл Смирнов', 'Фронтенд-разработчик', 'kirill@travel.example'),
    ('autoteca', 'Роман Громов', 'Руководитель · Руководитель тестирования', 'roman@autoteca.example'),
    ('autoteca', 'Нина Белова', 'Наставник · Старший инженер по тестированию', 'nina@autoteca.example'),
    ('autoteca', 'Олег Фёдоров', 'Инженер данных', 'oleg@autoteca.example'),
    ('autoteca', 'Ксения Романова', 'Инженер по автоматизации тестирования', 'ksenia@autoteca.example'),
    ('autoteca', 'Максим Егоров', 'Фронтенд-разработчик', 'maksim@autoteca.example'),
    ('help', 'Михаил Орлов', 'Руководитель · Дизайн-лид', 'mikhail@help.example'),
    ('help', 'Дарья Волкова', 'Наставник · Старший веб-дизайнер', 'daria@help.example'),
    ('help', 'Юлия Миронова', 'Редактор', 'yulia@help.example'),
    ('help', 'Никита Андреев', 'Фронтенд-разработчик', 'nikita@help.example'),
    ('help', 'Елена Громова', 'Координатор социальных проектов', 'elena@help.example')
ON CONFLICT (team_id, name) DO NOTHING;

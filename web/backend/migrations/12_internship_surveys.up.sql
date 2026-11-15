CREATE TABLE internship_survey_responses (
    profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('first', 'midpoint', 'final')),
    answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, stage)
);

ALTER TABLE notifications ADD COLUMN read_at timestamptz;

-- Stages of the four demo profiles match the web onboarding workspace.
INSERT INTO notifications (profile_id, kind, title, body, action_title, action_url)
SELECT p.id, reminder.kind, reminder.title, 'Поделись впечатлениями о стажировке.',
       'Пройти опрос', '/onboarding?survey=' || reminder.stage
FROM (VALUES
    ('olga', 'survey-first', 'Опрос о начале стажировки', 'first'),
    ('timur', 'survey-first', 'Опрос о начале стажировки', 'first'),
    ('sasha', 'equator', 'Опрос на экваторе стажировки', 'midpoint'),
    ('maria', 'survey-final', 'Финальный опрос о стажировке', 'final')
) AS reminder(profile_id, kind, title, stage)
JOIN profiles p ON p.id = reminder.profile_id
ON CONFLICT (profile_id, kind) DO UPDATE
SET title = EXCLUDED.title, body = EXCLUDED.body, action_title = EXCLUDED.action_title,
    action_url = EXCLUDED.action_url;

INSERT INTO notifications (profile_id, kind, title, body, action_title, action_url)
SELECT p.id, notice.kind, notice.title, notice.body, notice.action_title, '/onboarding'
FROM (VALUES
    ('olga', 'first-day', 'Твой первый день', 'Сегодня в 14:00 — знакомство с лидом.', 'Посмотреть план'),
    ('timur', 'first-day', 'Твой первый день', 'Сегодня в 14:00 — знакомство с лидом.', 'Посмотреть план'),
    ('maria', 'graduation', 'Финал стажировки', 'Проверь итоги адаптации и подготовься к переходу в команду.', 'Открыть итоги')
) AS notice(profile_id, kind, title, body, action_title)
JOIN profiles p ON p.id = notice.profile_id
ON CONFLICT (profile_id, kind) DO NOTHING;

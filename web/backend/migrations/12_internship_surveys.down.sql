DELETE FROM notifications WHERE kind IN ('survey-first', 'survey-final', 'first-day', 'graduation');
UPDATE notifications
SET title = 'Экватор стажировки',
    body = 'Половина стажировки позади! Поделись впечатлениями — это поможет сделать программу лучше.',
    action_url = 'https://forms.example.com/equator-survey'
WHERE profile_id = 'sasha' AND kind = 'equator';

ALTER TABLE notifications DROP COLUMN read_at;
DROP TABLE internship_survey_responses;

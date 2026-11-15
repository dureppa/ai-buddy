DELETE FROM onboarding_progress WHERE task_id IN ('documents', 'events');
DELETE FROM onboarding_tasks WHERE id IN ('documents', 'events');

UPDATE onboarding_tasks
SET action_url = '/resources?article=documents'
WHERE id = 'papers' AND action_url = 'http://localhost:5187/';

UPDATE knowledge_articles
SET url = '/resources?article=documents',
    content = 'Сверь комплект документов с куратором. После согласования он подскажет, где подписать документы и как проверить статус.'
WHERE id = 'documents';

UPDATE knowledge_articles
SET url = '/resources?article=meetups',
    content = 'В календаре адаптации отмечены знакомство с командой, обучение и встреча по первым результатам. Ближайшие события видны на главной.'
WHERE id = 'meetups';

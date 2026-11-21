-- Extend each demo team without changing existing profiles or progress.
INSERT INTO profiles (id, display_name, role, team_id, mentor_name, mentor_contact, internship_started_on, job_role)
SELECT added.id, added.name, source.role, source.team_id, source.mentor_name,
       source.mentor_contact, DATE '2026-11-22', source.job_role
FROM (VALUES
    ('delivery-ivan', 'Иван Смирнов', 'olga'),
    ('delivery-elena', 'Елена Кузнецова', 'olga'),
    ('travel-pavel', 'Павел Волков', 'sasha'),
    ('travel-sofia', 'София Новикова', 'sasha'),
    ('autoteca-egor', 'Егор Попов', 'timur'),
    ('autoteca-alisa', 'Алиса Федорова', 'timur'),
    ('help-mark', 'Марк Васильев', 'maria'),
    ('help-eva', 'Ева Михайлова', 'maria')
) AS added(id, name, primary_id)
JOIN profiles source ON source.id = added.primary_id
ON CONFLICT (id) DO NOTHING;

import { describe, expect, it } from 'vitest';
import { stages, tasksFor } from './checklist';
import type { ProfileId } from './demo-accounts';

const profiles = ['olga', 'sasha', 'timur', 'maria'] as const satisfies readonly ProfileId[];

describe('internship checklist', () => {
  it('groups tasks into the periods from the intern checklist', () => {
    expect(stages.map((stage) => stage.name)).toEqual([
      '1 неделя',
      '2 неделя',
      '1 месяц',
      '2 месяц',
      '3 месяц',
      'После 3 месяцев',
    ]);
  });

  it('keeps one shared step list and a backend track taken from the checklist', () => {
    const ids = profiles.map((profile) => tasksFor(profile).map((task) => task.id));
    expect(new Set(ids.map((list) => list.join(','))).size).toBe(1);
    expect(ids[0].filter((id) => id === 'meet-team')).toHaveLength(1);
    expect(
      tasksFor('sasha')
        .filter((task) => task.stage === 'week-1')
        .slice(0, 3)
        .map((task) => task.id),
    ).toEqual(['meet-team', 'mentor-work', 'cluster-space']);

    const backend = tasksFor('sasha');
    expect(backend.find((task) => task.id === 'avito-cli')?.details).toBe('Настрой avito-cli.');
    expect(backend.find((task) => task.id === 'sniffer')?.details).toContain('Bruno или Charles');
    expect(backend.find((task) => task.id === 'effective-go')?.title).toBe('Изучи Effective Go');
    expect(backend.find((task) => task.id === 'book-primary')?.details).toContain('Донован');
    expect(backend.find((task) => task.id === 'book-recommendations')?.details).toContain('Ходакова');
    expect(backend.find((task) => task.id === 'shataliti')?.title).toBe('Шаталити');

    const shared = ['meet-team', 'agile', 'infomodel', 'equator-meeting', 'graduation'];
    for (const id of shared) {
      const titles = profiles.map((profile) => tasksFor(profile).find((task) => task.id === id)?.title);
      expect(new Set(titles).size).toBe(1);
    }
    expect(tasksFor('olga').find((task) => task.id === 'avito-cli')?.title).toBe('Получи доступ к витринам');
    expect(tasksFor('timur').find((task) => task.id === 'zbp')?.title).toBe('Zero Bug Policy');
    expect(tasksFor('maria').find((task) => task.id === 'sniffer')?.title).toBe('Figma и инспектор макетов');
    expect(tasksFor('olga').some((task) => task.title.includes('Подписать документы'))).toBe(false);
  });
});

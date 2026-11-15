import { describe, expect, it } from 'vitest';
import { readSchedule, scheduleKey, upcomingEvents } from './schedule';

describe('personal schedule', () => {
  const now = new Date(2026, 10, 16, 10);

  it('keeps demo meetings in the future when their usual time has passed', () => {
    const storage = { getItem: () => null };
    const late = new Date(2026, 10, 16, 20);
    const events = readSchedule(storage, 'olga', late);
    expect(upcomingEvents(events, late.getTime())).toHaveLength(3);
  });

  it('restores changes for the active profile, sorts upcoming events and preserves an empty schedule', () => {
    const storage = new Map<string, string>();
    const reader = { getItem: (key: string) => storage.get(key) ?? null };
    const [first, second, third] = readSchedule(reader, 'olga', now);
    storage.set(scheduleKey('olga'), JSON.stringify([third, first, second]));
    storage.set(scheduleKey('sasha'), '[]');
    expect(
      upcomingEvents(readSchedule(reader, 'olga'), Date.parse(first.startsAt) + 1).map((event) => event.id),
    ).toEqual([second.id, third.id]);
    expect(readSchedule(reader, 'sasha')).toEqual([]);
    expect(readSchedule(reader, 'timur', now)).toHaveLength(3);
  });

  it.each([
    ['Созвон', 'blue'],
    ['Встреча', 'mint'],
    ['Напоминание', 'lilac'],
  ] as const)('restores %s with its type color instead of the previously saved color', (kind, tone) => {
    const event = {
      id: 'existing',
      title: 'Событие команды',
      kind,
      startsAt: '2026-11-17T10:00:00.000Z',
      tone: 'pink',
      description: 'Сохранённое описание',
    };
    const saved = JSON.stringify([event]);
    const storage = { getItem: () => saved };
    expect(readSchedule(storage, 'olga')).toEqual([{ ...event, tone }]);
    expect(storage.getItem()).toBe(saved);
  });

  it.each(['olga', 'sasha', 'timur', 'maria'] as const)('uses green for all demo meetings of %s', (profile) => {
    const events = readSchedule({ getItem: () => null }, profile, now);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(({ kind, tone }) => kind === 'Встреча' && tone === 'mint')).toBe(true);
  });
});

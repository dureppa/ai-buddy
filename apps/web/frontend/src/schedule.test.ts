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
});

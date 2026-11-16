// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from './backend';
import { readCalendar, changeCalendar } from './schedule-api';
import { scheduleKey, type ScheduleEvent } from './schedule';
import { absenceServiceLink } from './demo';
vi.mock('./backend', () => ({ apiFetch: vi.fn() }));
const event: ScheduleEvent = {
  id: 'one',
  title: 'Синхронизация',
  kind: 'Созвон',
  tone: 'blue',
  startsAt: '2030-01-01T12:00:00Z',
  description: '',
};
beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
});
afterEach(() => vi.restoreAllMocks());
it('reads server events for the authenticated profile without browser demo fallback', async () => {
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ events: [event], has_more: false }));
  expect((await readCalendar('olga')).events).toEqual([event]);
  expect(apiFetch).toHaveBeenCalledWith('olga', '/api/v1/schedule/events', expect.anything());
});
it.each([{ events: [] }, { events: [event] }])(
  'imports the legacy calendar before reading and removes only its profile key',
  async ({ events }) => {
    localStorage.setItem(scheduleKey('olga'), JSON.stringify(events));
    localStorage.setItem(scheduleKey('sasha'), '[]');
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ events, has_more: false }));
    expect((await readCalendar('olga')).events).toEqual(events);
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      'olga',
      '/api/v1/schedule/import',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][2]?.body))).toEqual({ events });
    expect(localStorage.getItem(scheduleKey('olga'))).toBeNull();
    expect(localStorage.getItem(scheduleKey('sasha'))).toBe('[]');
  },
);
it('retains the old calendar if import fails or local data changes during import', async () => {
  localStorage.setItem(scheduleKey('olga'), '[]');
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
  await expect(readCalendar('olga')).rejects.toThrow('offline');
  expect(localStorage.getItem(scheduleKey('olga'))).toBe('[]');
  vi.mocked(apiFetch)
    .mockImplementationOnce(async () => {
      localStorage.setItem(scheduleKey('olga'), JSON.stringify([event]));
      return Response.json({ ok: true });
    })
    .mockResolvedValueOnce(Response.json({ events: [], has_more: false }));
  await readCalendar('olga');
  expect(localStorage.getItem(scheduleKey('olga'))).toBe(JSON.stringify([event]));
});
it('rejects malformed server data and legacy data without deleting the legacy key', async () => {
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ events: [{ ...event, kind: 'wrong' }], has_more: false }));
  await expect(readCalendar('olga')).rejects.toThrow();
  localStorage.setItem(scheduleKey('olga'), 'not-json');
  await expect(readCalendar('olga')).rejects.toThrow();
  expect(localStorage.getItem(scheduleKey('olga'))).toBe('not-json');
});
it('creates, edits and deletes through the server, checking returned identity', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json(event));
  expect(await changeCalendar('olga', [], [event])).toEqual({ saved: event });
  expect(apiFetch).toHaveBeenLastCalledWith(
    'olga',
    '/api/v1/schedule/events/one',
    expect.objectContaining({ method: 'PUT' }),
  );
  const edited = { ...event, title: 'Новая тема' };
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json(edited));
  expect(await changeCalendar('olga', [event], [edited])).toEqual({ saved: edited });
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ ok: true }));
  expect(await changeCalendar('olga', [event], [])).toEqual({ removed: 'one' });
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ ...event, id: 'other' }));
  await expect(changeCalendar('olga', [], [event])).rejects.toThrow('Неверное событие');
  await expect(changeCalendar('olga', [], [])).rejects.toThrow('одно событие');
});
it('retains failed writes as failures and provides a calendar link even without agent sources', async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error('offline'));
  await expect(changeCalendar('olga', [], [event])).rejects.toThrow('offline');
  expect(absenceServiceLink('Какие события у меня на этой неделе?')).toEqual({
    label: 'Открыть календарь событий',
    to: '/events',
  });
});

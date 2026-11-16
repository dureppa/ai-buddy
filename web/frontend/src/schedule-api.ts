import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId } from './data';
import { eventSchema, scheduleKey, type ScheduleEvent } from './schedule';

const calendarSchema = z.object({ events: z.array(eventSchema).max(500), has_more: z.boolean() });
const okSchema = z.object({ ok: z.literal(true) });

export async function readCalendar(profile: ProfileId, signal?: AbortSignal) {
  const key = scheduleKey(profile);
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    const events = z.array(eventSchema).max(500).parse(JSON.parse(raw));
    const response = await apiFetch(profile, '/api/v1/schedule/import', {
      method: 'POST',
      body: JSON.stringify({ events }),
      signal,
    });
    okSchema.parse(await response.json());
    if (localStorage.getItem(key) === raw) {
      try {
        localStorage.setItem(key + '.backup', raw);
        localStorage.removeItem(key);
      } catch {
        // Keep the source if a browser cannot save the backup.
      }
    }
  }
  return calendarSchema.parse(await (await apiFetch(profile, '/api/v1/schedule/events', { signal })).json());
}

export async function changeCalendar(profile: ProfileId, before: ScheduleEvent[], after: ScheduleEvent[]) {
  const next = z.array(eventSchema).max(500).parse(after);
  const removed = before.filter((item) => !next.some((other) => other.id === item.id));
  const changed = next.filter(
    (item) => JSON.stringify(before.find((old) => old.id === item.id)) !== JSON.stringify(item),
  );
  if (removed.length + changed.length !== 1) throw new Error('Измени одно событие за раз.');
  if (removed.length) {
    okSchema.parse(
      await (
        await apiFetch(profile, '/api/v1/schedule/events/' + encodeURIComponent(removed[0].id), { method: 'DELETE' })
      ).json(),
    );
    return { removed: removed[0].id };
  }
  const saved = changed[0];
  const response = await apiFetch(profile, '/api/v1/schedule/events/' + encodeURIComponent(saved.id), {
    method: 'PUT',
    body: JSON.stringify(saved),
  });
  const event = eventSchema.parse(await response.json());
  if (event.id !== saved.id) throw new Error('Неверное событие в ответе.');
  return { saved: event };
}

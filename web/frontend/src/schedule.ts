import { z } from 'zod';
import { profiles, type ProfileId } from './demo-accounts';

export const eventKinds = ['Встреча', 'Созвон', 'Напоминание'] as const;
const tones = ['mint', 'blue', 'lilac', 'pink'] as const;
export const eventTones = {
  Встреча: 'mint',
  Созвон: 'blue',
  Напоминание: 'lilac',
} as const satisfies Record<(typeof eventKinds)[number], (typeof tones)[number]>;
export const eventSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  title: z.string().trim().min(1).max(120),
  kind: z.enum(eventKinds),
  startsAt: z.iso.datetime(),
  tone: z.enum(tones),
  description: z.string().max(4000),
});
export type ScheduleEvent = z.infer<typeof eventSchema>;
type DemoEvent = Pick<ScheduleEvent, 'title' | 'description'> & { time: string };
const eventsByStage: Record<(typeof profiles)[ProfileId]['stageId'], DemoEvent[]> = {
  first: [
    {
      title: 'Встреча с лидом',
      time: '14:00',
      description: 'Руководитель расскажет о задачах команды и обсудит твои цели на первые недели.',
    },
    {
      title: 'Кофе с наставником',
      time: '11:00',
      description: 'Неформальное знакомство с наставником. Можно задать вопросы о команде и повседневной работе.',
    },
    {
      title: 'Знакомство с продуктом',
      time: '15:00',
      description: 'Команда покажет пользовательские сценарии и расскажет, над чем работает сейчас.',
    },
  ],
  midpoint: [
    {
      title: 'Встреча на экваторе',
      time: '12:00',
      description: 'Обсуди с наставником результаты первых месяцев и цели на вторую половину стажировки.',
    },
  ],
  final: [
    {
      title: 'Итоговая встреча с лидом',
      time: '15:00',
      description: 'Подведи итоги стажировки, обсуди обратную связь и договорись о следующих шагах.',
    },
  ],
};

export const scheduleKey = (profileId: ProfileId) => 'ai-buddy.schedule.' + profileId;

export function readSchedule(
  storage: Pick<Storage, 'getItem'>,
  profileId: ProfileId,
  now = new Date(),
): ScheduleEvent[] {
  const raw = storage.getItem(scheduleKey(profileId));
  if (raw !== null) {
    try {
      return eventSchema
        .array()
        .parse(JSON.parse(raw))
        .map((event) => ({ ...event, tone: eventTones[event.kind] }));
    } catch {
      return [];
    }
  }
  return eventsByStage[profiles[profileId].stageId].map(({ time, ...event }, index) => {
    const starts = new Date(now);
    const [hours, minutes] = time.split(':').map(Number);
    starts.setDate(starts.getDate() + index);
    starts.setHours(hours, minutes, 0, 0);
    if (starts <= now) starts.setDate(starts.getDate() + 1);
    return { ...event, id: 'demo-' + index, kind: 'Встреча', tone: eventTones.Встреча, startsAt: starts.toISOString() };
  });
}

export function upcomingEvents(events: ScheduleEvent[], now = Date.now()) {
  return events
    .filter((event) => Date.parse(event.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export const eventDay = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full' });
export const eventTime = new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' });
export const eventMonth = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

export function localDateTime(startsAt: string) {
  const time = new Date(startsAt);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

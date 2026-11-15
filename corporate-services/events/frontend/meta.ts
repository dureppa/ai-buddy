import type { Tone } from '../../../web/frontend/src/data';
import type { IconName } from '../../../web/frontend/src/ui';

export const eventsService = {
  id: 'events',
  title: 'Корпоративные мероприятия',
  description: 'Встречи, обучение и важные даты.',
  icon: 'sparkles',
  tone: 'lilac',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const eventItems = [
  {
    id: 'intro',
    title: 'Знакомство с командой',
    text: 'Встреча со стажёрами и наставником в первый день.',
  },
  {
    id: 'learn',
    title: 'Вводное обучение',
    text: 'Короткая встреча по правилам и первым рабочим шагам.',
  },
  {
    id: 'results',
    title: 'Встреча по первым результатам',
    text: 'Обсуждение первых задач ближе к концу адаптации.',
  },
] as const;

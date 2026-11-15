import type { Tone } from '../../../web/frontend/src/data';
import type { IconName } from '../../../web/frontend/src/ui';

export const tripsService = {
  id: 'trips',
  title: 'Командировки',
  description: 'Проверь лимит поездки и подай заявку.',
  icon: 'map',
  tone: 'blue',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const destinations = [
  { id: 'kazan', title: 'Казань', description: 'Встреча продуктовой команды', estimate: 18000 },
  { id: 'petersburg', title: 'Санкт-Петербург', description: 'Исследовательский выезд', estimate: 26000 },
  { id: 'ekaterinburg', title: 'Екатеринбург', description: 'Встреча с региональной командой', estimate: 34000 },
] as const;

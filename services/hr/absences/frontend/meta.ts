import type { Tone } from '../../../../apps/web/frontend/src/data';
import type { IconName } from '../../../../apps/web/frontend/src/ui';

export const absencesService = {
  id: 'absences',
  title: 'Отсутствия',
  description: 'Планируй отпуск и проверяй остаток дней.',
  icon: 'calendar',
  tone: 'mint',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

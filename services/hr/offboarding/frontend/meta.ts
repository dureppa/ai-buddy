import type { Tone } from '../../../../apps/web/frontend/src/data';
import type { IconName } from '../../../../apps/web/frontend/src/ui';

export const offboardingService = {
  id: 'offboarding',
  title: 'Увольнения',
  description: 'Подготовь передачу дел и возврат техники.',
  icon: 'flag',
  tone: 'pink',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const exitSteps = [
  {
    id: 'handover',
    title: 'Передать задачи и рабочие материалы',
    description: 'Поделись статусами и ссылками с лидом.',
  },
  { id: 'equipment', title: 'Согласовать возврат техники', description: 'Уточни дату и способ возврата у IT.' },
  { id: 'feedback', title: 'Запланировать итоговую встречу', description: 'Обсуди результаты с наставником.' },
] as const;

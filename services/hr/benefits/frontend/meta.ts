import type { Tone } from '../../../../apps/web/frontend/src/data';
import type { IconName } from '../../../../apps/web/frontend/src/ui';

export const benefitsService = {
  id: 'benefits',
  title: 'Бенефиты',
  description: 'Выбери программу и запроси компенсацию.',
  icon: 'heart',
  tone: 'mint',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const benefitOptions = [
  { id: 'learning', title: 'Обучение', description: 'Курсы и профессиональные книги', amount: 4500, icon: 'book' },
  { id: 'sport', title: 'Спорт', description: 'Абонемент или занятия', amount: 6000, icon: 'flag' },
  {
    id: 'wellbeing',
    title: 'Забота о себе',
    description: 'Консультации и восстановление',
    amount: 7500,
    icon: 'heart',
  },
] as const satisfies readonly { id: string; title: string; description: string; amount: number; icon: IconName }[];

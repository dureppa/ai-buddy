import type { Tone } from '../../../../apps/web/frontend/src/data';
import type { IconName } from '../../../../apps/web/frontend/src/ui';

export const hiringService = {
  id: 'hiring',
  title: 'Найм',
  description: 'Посмотри вакансии и порекомендуй кандидата.',
  icon: 'users',
  tone: 'lilac',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const vacancies = [
  { id: 'design', title: 'Продуктовый дизайнер', description: 'Дизайн продукта · Москва' },
  { id: 'frontend', title: 'Frontend-разработчик', description: 'Веб-платформа · Удалённо' },
  { id: 'analyst', title: 'Продуктовый аналитик', description: 'Аналитика · Москва' },
] as const;

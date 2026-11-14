import type { Tone } from '../../../../apps/web/frontend/src/data';
import type { IconName } from '../../../../apps/web/frontend/src/ui';

export const consentsService = {
  id: 'consents',
  title: 'Согласия',
  description: 'Управляй согласиями на рассылку и публикацию фото.',
  icon: 'file',
  tone: 'blue',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const consentOptions = [
  { id: 'news', title: 'Внутренние новости', description: 'Письма о событиях и обучении.' },
  { id: 'photos', title: 'Фото с мероприятий', description: 'Публикация фото во внутренних каналах.' },
] as const;

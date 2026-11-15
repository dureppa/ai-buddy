import type { Tone } from '../../../web/frontend/src/data';
import type { IconName } from '../../../web/frontend/src/ui';

export const documentsService = {
  id: 'documents',
  title: 'Документы и инструкции',
  description: 'Оформление, памятки и правила первого дня.',
  icon: 'file',
  tone: 'blue',
} as const satisfies { id: string; title: string; description: string; icon: IconName; tone: Tone };

export const documentItems = [
  {
    id: 'papers',
    title: 'Оформление в первый день',
    text: 'Сверь комплект документов с куратором и отметь, что памятка прочитана.',
  },
  {
    id: 'rules',
    title: 'Правила первого дня',
    text: 'Коротко: куда прийти, кого найти и какие документы подписать.',
  },
  {
    id: 'sign',
    title: 'Подписание документов',
    text: 'После согласования куратор подскажет, где подписать документы и как проверить статус.',
  },
] as const;

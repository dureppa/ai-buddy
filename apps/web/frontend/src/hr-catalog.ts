import type { Tone } from './data';
import type { IconName } from './ui';

export const hrServices = [
  {
    id: 'absences',
    title: 'Отсутствия',
    description: 'Планируй отпуск и проверяй остаток дней.',
    icon: 'calendar',
    tone: 'mint',
  },
  {
    id: 'trips',
    title: 'Командировки',
    description: 'Проверь лимит поездки и подай заявку.',
    icon: 'map',
    tone: 'blue',
  },
  {
    id: 'hiring',
    title: 'Найм',
    description: 'Посмотри вакансии и порекомендуй кандидата.',
    icon: 'users',
    tone: 'lilac',
  },
  {
    id: 'offboarding',
    title: 'Увольнения',
    description: 'Подготовь передачу дел и возврат техники.',
    icon: 'flag',
    tone: 'pink',
  },
  {
    id: 'consents',
    title: 'Согласия',
    description: 'Управляй согласиями на рассылку и публикацию фото.',
    icon: 'file',
    tone: 'blue',
  },
  {
    id: 'benefits',
    title: 'Бенефиты',
    description: 'Выбери программу и запроси компенсацию.',
    icon: 'heart',
    tone: 'mint',
  },
] as const satisfies readonly { id: string; title: string; description: string; icon: IconName; tone: Tone }[];

export type HrService = (typeof hrServices)[number];
export const hrPath = (id: HrService['id']) => '/resources/' + id;

export const destinations = [
  { id: 'kazan', title: 'Казань', description: 'Встреча продуктовой команды', estimate: 18000 },
  { id: 'petersburg', title: 'Санкт-Петербург', description: 'Исследовательский выезд', estimate: 26000 },
  { id: 'ekaterinburg', title: 'Екатеринбург', description: 'Встреча с региональной командой', estimate: 34000 },
] as const;

export const vacancies = [
  { id: 'design', title: 'Продуктовый дизайнер', description: 'Дизайн продукта · Москва' },
  { id: 'frontend', title: 'Frontend-разработчик', description: 'Веб-платформа · Удалённо' },
  { id: 'analyst', title: 'Продуктовый аналитик', description: 'Аналитика · Москва' },
] as const;

export const exitSteps = [
  {
    id: 'handover',
    title: 'Передать задачи и рабочие материалы',
    description: 'Поделись статусами и ссылками с лидом.',
  },
  { id: 'equipment', title: 'Согласовать возврат техники', description: 'Уточни дату и способ возврата у IT.' },
  { id: 'feedback', title: 'Запланировать итоговую встречу', description: 'Обсуди результаты с наставником.' },
] as const;

export const consentOptions = [
  { id: 'news', title: 'Внутренние новости', description: 'Письма о событиях и обучении.' },
  { id: 'photos', title: 'Фото с мероприятий', description: 'Публикация фото во внутренних каналах.' },
] as const;

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
] as const;

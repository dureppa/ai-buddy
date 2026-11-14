import { profiles, type ProfileId } from './demo-accounts';
export type { AvatarVariant, Person, ProfileId } from './demo-accounts';
export { profiles } from './demo-accounts';

export type Tone = 'mint' | 'blue' | 'lilac' | 'pink' | 'paper';

export { homeTasks, stages, tasksFor, type StageId, type Task } from './checklist';

export const navigation = [
  { path: '/home', label: 'Главная', icon: 'home' },
  { path: '/onboarding', label: 'Моя адаптация', icon: 'map' },
  { path: '/team', label: 'Моя команда', icon: 'users' },
  { path: '/tools', label: 'Инструменты и доступы', icon: 'grid' },
  { path: '/resources', label: 'Корпоративные сервисы', icon: 'layers' },
  { path: '/chat', label: 'Чат с Buddy', icon: 'sparkles' },
] as const;

export type Event = {
  day: string;
  month: string;
  title: string;
  detail: string;
  tone: Tone;
  description: string;
};

const eventsByStage: Record<(typeof profiles)[ProfileId]['stageId'], Event[]> = {
  first: [
    {
      day: '16',
      month: 'НОЯ',
      title: 'Встреча с лидом',
      detail: 'Сегодня · 14:00–14:30',
      tone: 'lilac',
      description: 'Руководитель расскажет о задачах команды и обсудит твои цели на первые недели.',
    },
    {
      day: '17',
      month: 'НОЯ',
      title: 'Кофе с наставником',
      detail: 'Завтра · 11:00–11:30',
      tone: 'pink',
      description: 'Неформальное знакомство с наставником. Можно задать вопросы о команде и повседневной работе.',
    },
    {
      day: '19',
      month: 'НОЯ',
      title: 'Знакомство с продуктом',
      detail: 'Четверг · 15:00–16:00',
      tone: 'blue',
      description: 'Команда покажет пользовательские сценарии и расскажет, над чем работает сейчас.',
    },
  ],
  midpoint: [
    {
      day: '13',
      month: 'ФЕВ',
      title: 'Встреча на экваторе',
      detail: 'Сегодня · 12:00–12:30',
      tone: 'lilac',
      description: 'Обсуди с наставником результаты первых месяцев и цели на вторую половину стажировки.',
    },
  ],
  final: [
    {
      day: '14',
      month: 'МАЙ',
      title: 'Итоговая встреча с лидом',
      detail: 'Сегодня · 15:00–15:30',
      tone: 'mint',
      description: 'Подведи итоги стажировки, обсуди обратную связь и договорись о следующих шагах.',
    },
  ],
};

export function eventsFor(profileId: ProfileId) {
  return eventsByStage[profiles[profileId].stageId];
}

export const services = [
  {
    id: 'figma',
    title: 'Figma',
    symbol: 'F',
    category: 'Дизайн',
    tone: 'lilac',
    state: 'available',
    description: 'Макеты, прототипы и библиотека компонентов.',
    owner: 'Наставник',
    instruction: 'Открой пространство команды и найди файл «Библиотека команды».',
    aliases: ['figma', 'фигм'],
  },
  {
    id: 'confluence',
    title: 'Confluence',
    symbol: 'C',
    category: 'Документация',
    tone: 'blue',
    state: 'available',
    description: 'База знаний, процессы и документация по продукту.',
    owner: 'Руководитель команды',
    instruction: 'В разделе «Пространства» выбери свою команду.',
    aliases: ['confluence', 'конфлюенс'],
  },
  {
    id: 'grafana',
    title: 'Grafana',
    symbol: 'G',
    category: 'Аналитика',
    tone: 'pink',
    state: 'requestable',
    description: 'Дашборды и метрики пользовательских сценариев.',
    owner: 'Администратор аналитики',
    instruction: 'Подготовь заявку в Buddy и подтверди её. Статус появится в списке доступов.',
    aliases: ['grafana', 'графан', 'аналитик'],
  },
  {
    id: 'jira',
    title: 'Jira',
    symbol: 'J',
    category: 'Задачи',
    tone: 'blue',
    state: 'requestable',
    description: 'Задачи, планирование и статусы команды.',
    owner: 'Руководитель команды',
    instruction: 'Для работы с доской запроси доступ к проекту команды.',
    aliases: ['jira', 'джир'],
  },
  {
    id: 'mattermost',
    title: 'Mattermost',
    symbol: 'M',
    category: 'Связь',
    tone: 'mint',
    state: 'available',
    description: 'Чаты, обсуждения и объявления команды.',
    owner: 'Наставник',
    instruction: 'В поиске каналов открой канал своей команды.',
    aliases: ['mattermost', 'чат команд'],
  },
  {
    id: 'drive',
    title: 'Диск команды',
    symbol: 'Д',
    category: 'Файлы',
    tone: 'paper',
    state: 'setup',
    description: 'Шаблоны презентаций и материалы для встреч.',
    owner: 'IT-поддержка',
    instruction: 'Уточни у наставника, какое пространство подключить к рабочему аккаунту.',
    aliases: ['диск'],
  },
] as const;

export const suggestions = [
  'С чего начать сегодня?',
  'Кто мой наставник?',
  'Запроси доступ к Grafana',
  'Где найти документы?',
  'Как оформить отгул?',
];

export type Service = (typeof services)[number];

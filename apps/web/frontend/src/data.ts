export type { AvatarVariant, Person, ProfileId } from './demo-accounts';
export { profiles } from './demo-accounts';

export type Tone = 'mint' | 'blue' | 'lilac' | 'pink' | 'paper';

export { homeTasks, stages, tasksFor, type StageId, type Task } from './checklist';

export const navigation = [
  { path: '/home', label: 'Главная', icon: 'home' },
  { path: '/onboarding', label: 'Моя адаптация', icon: 'map' },
  { path: '/events', label: 'События', icon: 'calendar' },
  { path: '/team', label: 'Моя команда', icon: 'users' },
  { path: '/tools', label: 'Инструменты и доступы', icon: 'grid' },
  { path: '/resources', label: 'Корпоративные сервисы', icon: 'layers' },
  { path: '/chat', label: 'Чат с Buddy', icon: 'sparkles' },
] as const;

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

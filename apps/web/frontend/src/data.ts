import { products, profiles, staffAccounts, type ProfileId } from './demo-accounts';
export type { AvatarVariant, Person, ProfileId } from './demo-accounts';
export { profiles } from './demo-accounts';

export type Tone = 'mint' | 'blue' | 'lilac' | 'pink' | 'paper';

export const navigation = [
  { path: '/home', label: 'Главная', icon: 'home' },
  { path: '/onboarding', label: 'Моя адаптация', icon: 'map' },
  { path: '/team', label: 'Моя команда', icon: 'users' },
  { path: '/tools', label: 'Инструменты и доступы', icon: 'grid' },
  { path: '/resources', label: 'Корпоративные сервисы', icon: 'layers' },
  { path: '/chat', label: 'Чат с Buddy', icon: 'sparkles' },
] as const;

export const stages = [
  { id: 'first', name: 'Первый рабочий день', dates: '16 ноября', tone: 'mint' },
  { id: 'company', name: 'Знакомство с компанией', dates: '16–18 ноября', tone: 'blue' },
  { id: 'workspace', name: 'Настройка рабочего пространства', dates: '16–20 ноября', tone: 'lilac' },
  { id: 'team', name: 'Знакомство с командой', dates: '16–20 ноября', tone: 'pink' },
  { id: 'role', name: 'Профессиональная адаптация', dates: '20–30 ноября', tone: 'blue' },
  { id: 'finish', name: 'Итоги адаптации', dates: '30 ноября', tone: 'mint' },
] as const;

export type Task = {
  id: string;
  title: string;
  summary: string;
  details: string;
  due: string;
  owner: string;
  stage: (typeof stages)[number]['id'];
  icon: 'file' | 'users' | 'monitor' | 'book' | 'key' | 'check' | 'flag';
  tone: Tone;
  today?: boolean;
  resource?: string;
};

export const tasks: Task[] = [
  {
    id: 'papers',
    title: 'Подписать документы',
    summary: 'Оформление в первый рабочий день',
    details:
      'Проверь комплект документов в демонстрационном кадровом кабинете. Если какого-то документа нет, напиши куратору стажировки.',
    due: 'Сегодня, 12:00',
    owner: 'Куратор стажировки',
    stage: 'first',
    icon: 'file',
    tone: 'blue',
    today: true,
    resource: 'documents',
  },
  {
    id: 'intro',
    title: 'Познакомиться с лидом',
    summary: 'Вводная встреча с руководителем',
    details:
      'На встрече обсудите цели стажировки, задачи команды и то, как будет устроена обратная связь. Подготовь пару вопросов о продукте.',
    due: 'Сегодня, 14:00',
    owner: 'Руководитель команды',
    stage: 'first',
    icon: 'users',
    tone: 'lilac',
    today: true,
  },
  {
    id: 'equipment',
    title: 'Проверить рабочую технику',
    summary: 'Ноутбук, почта и видеосвязь',
    details: 'Убедись, что ноутбук подключается к сети, открывается корпоративная почта, а камера и микрофон работают.',
    due: 'Сегодня, 16:00',
    owner: 'IT-поддержка',
    stage: 'workspace',
    icon: 'monitor',
    tone: 'mint',
    today: true,
    resource: 'equipment',
  },
  {
    id: 'safety',
    title: 'Пройти обязательные курсы',
    summary: 'Вводный инструктаж и безопасность',
    details:
      'Открой учебный портал и пройди вводные материалы по охране труда и пожарной безопасности. Затем отметь этот шаг выполненным.',
    due: 'Сегодня, 18:00',
    owner: 'Куратор стажировки',
    stage: 'company',
    icon: 'book',
    tone: 'pink',
    today: true,
    resource: 'learning',
  },
  {
    id: 'welcome',
    title: 'Посмотреть приветствие Buddy',
    summary: 'Первый вход в пространство стажёра',
    details: 'Посмотри план адаптации и открой чат. Buddy поможет найти нужного человека или подсказать следующий шаг.',
    due: '16 ноября',
    owner: 'AI-buddy',
    stage: 'first',
    icon: 'check',
    tone: 'mint',
  },
  {
    id: 'account',
    title: 'Настроить рабочий аккаунт',
    summary: 'Почта и профиль сотрудника',
    details: 'Проверь имя и контакты в рабочем профиле и убедись, что получаешь письма.',
    due: '16 ноября',
    owner: 'IT-поддержка',
    stage: 'workspace',
    icon: 'monitor',
    tone: 'blue',
  },
  {
    id: 'chat-join',
    title: 'Вступить в чат команды',
    summary: 'Канал твоей команды',
    details: 'В командном чате можно представиться и задать организационные вопросы.',
    due: '16 ноября',
    owner: 'Наставник',
    stage: 'team',
    icon: 'users',
    tone: 'lilac',
  },
  {
    id: 'team-meet',
    title: 'Познакомиться с командой',
    summary: 'Лид, наставник и коллеги',
    details: 'Посмотри, кто за что отвечает, и договорись о коротком знакомстве с наставником.',
    due: '19 ноября',
    owner: 'Наставник',
    stage: 'team',
    icon: 'users',
    tone: 'pink',
  },
  {
    id: 'product',
    title: 'Изучить продукт',
    summary: 'Цели команды и карта продукта',
    details: 'Начни с обзора продукта. Запиши вопросы о пользователях и ближайших задачах для обсуждения с лидом.',
    due: '20 ноября',
    owner: 'Руководитель команды',
    stage: 'role',
    icon: 'book',
    tone: 'blue',
    resource: 'product',
  },
  {
    id: 'access',
    title: 'Запросить рабочие доступы',
    summary: 'Инструменты твоей команды',
    details: 'На странице «Инструменты и доступы» выбери нужный сервис и подтверди заявку в чате Buddy.',
    due: '20 ноября',
    owner: 'Администратор сервиса',
    stage: 'workspace',
    icon: 'key',
    tone: 'lilac',
  },
  {
    id: 'first-task',
    title: 'Обсудить первую задачу',
    summary: 'Постановка задачи и ожидания',
    details: 'На встрече с наставником согласуй цель, критерии готовности и сроки первой задачи.',
    due: '24 ноября',
    owner: 'Наставник',
    stage: 'role',
    icon: 'flag',
    tone: 'mint',
  },
  {
    id: 'review',
    title: 'Подвести первые итоги',
    summary: 'Обратная связь и следующий шаг',
    details: 'Подготовь краткий список того, что получилось, и вопросов, которые стоит обсудить на встрече.',
    due: '30 ноября',
    owner: 'Руководитель команды',
    stage: 'finish',
    icon: 'flag',
    tone: 'pink',
  },
];

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

export const resources = [
  {
    id: 'documents',
    title: 'Документы и инструкции',
    category: 'Документы',
    icon: 'file',
    tone: 'blue',
    summary: 'Оформление, памятки и правила первого дня.',
    body: 'Сверь комплект документов с куратором. После согласования он подскажет, где подписать документы и как проверить статус.',
  },
  {
    id: 'product',
    title: 'Путеводитель по продукту',
    category: 'Документы',
    icon: 'map',
    tone: 'mint',
    summary: 'Что делает команда и кому помогает продукт.',
    body: 'Начни с задач команды и обсуди первые шаги с наставником.',
  },
  {
    id: 'learning',
    title: 'Учебный портал',
    category: 'Обучение',
    icon: 'book',
    tone: 'lilac',
    summary: 'Вводные курсы и материалы для развития.',
    body: 'Начни с вводного курса, охраны труда и пожарной безопасности. В плане адаптации укажи, когда закончишь обучение.',
  },
  {
    id: 'timeoff',
    title: 'Отпуска и выходные',
    category: 'Кадровые вопросы',
    icon: 'calendar',
    tone: 'pink',
    summary: 'Демонстрационная памятка об отгуле.',
    body: 'В этом учебном сценарии сначала согласуй дату с лидом и уточни дальнейшие шаги у HR. Для рабочего запроса используй актуальные инструкции своей компании.',
  },
  {
    id: 'equipment',
    title: 'Рабочее место и IT',
    category: 'Сервисы',
    icon: 'monitor',
    tone: 'mint',
    summary: 'Настройка техники, почты и видеосвязи.',
    body: 'Проверь вход в почту, камеру и микрофон. Если подключение не работает, запиши устройство и симптом и передай их IT-поддержке.',
  },
  {
    id: 'contacts',
    title: 'Полезные контакты',
    category: 'Контакты',
    icon: 'users',
    tone: 'blue',
    summary: 'К кому обратиться с вопросами о работе.',
    body: 'По задачам пиши руководителю команды. По первым шагам обратись к наставнику. По оформлению и обучению поможет куратор стажировки.',
  },
  {
    id: 'meetups',
    title: 'Корпоративные мероприятия',
    category: 'События',
    icon: 'sparkles',
    tone: 'lilac',
    summary: 'Встречи, обучение и важные даты.',
    body: 'В календаре адаптации отмечены знакомство с командой, обучение и встреча по первым результатам. Ближайшие события видны на главной.',
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
export type Resource = Omit<(typeof resources)[number], 'body'> & { body: string };

export function resourcesFor(profileId: ProfileId): Resource[] {
  const product = products[profiles[profileId].productId];
  return resources.map((resource) => {
    if (resource.id === 'product')
      return {
        ...resource,
        body: product.name + ' · «' + product.team + '». ' + product.teamDescription + ' ' + product.firstStep,
      };
    if (resource.id === 'contacts')
      return {
        ...resource,
        body:
          'По задачам пиши руководителю (' +
          staffAccounts[product.manager].name +
          '). По первым шагам обратись к наставнику (' +
          staffAccounts[product.mentor].name +
          '). По оформлению и обучению поможет куратор стажировки.',
      };
    return resource;
  });
}

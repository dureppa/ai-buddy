export type Tone = 'mint' | 'blue' | 'lilac' | 'pink' | 'paper';

export const navigation = [
  { path: '/home', label: 'Главная', icon: 'home' },
  { path: '/onboarding', label: 'Моя адаптация', icon: 'map' },
  { path: '/team', label: 'Моя команда', icon: 'users' },
  { path: '/tools', label: 'Инструменты и доступы', icon: 'grid' },
  { path: '/resources', label: 'Корпоративные сервисы', icon: 'layers' },
  { path: '/chat', label: 'Чат с Buddy', icon: 'sparkles' },
] as const;

export const profiles = {
  olga: {
    id: 'olga',
    name: 'Оля',
    fullName: 'Ольга Соколова',
    initials: 'ОС',
    avatar: 'olga',
    role: 'Стажёр · продуктовый дизайнер',
    team: 'Дизайн продукта',
    day: 1,
    stage: 'Первый день',
    stageDescription: 'Знакомство с командой и настройка рабочего места',
  },
  sasha: {
    id: 'sasha',
    name: 'Саша',
    fullName: 'Александр Ким',
    initials: 'АК',
    avatar: 'alexander',
    role: 'Стажёр · продуктовый дизайнер',
    team: 'Дизайн продукта',
    day: 90,
    stage: 'Экватор',
    stageDescription: 'Первые результаты и обратная связь от наставника',
  },
  maria: {
    id: 'maria',
    name: 'Маша',
    fullName: 'Мария Лебедева',
    initials: 'МЛ',
    avatar: 'maria',
    role: 'Стажёр · продуктовый дизайнер',
    team: 'Дизайн продукта',
    day: 180,
    stage: 'Финал',
    stageDescription: 'Итоги стажировки и переход к самостоятельной работе',
  },
} as const;
export type ProfileId = keyof typeof profiles;
export type AvatarVariant = (typeof profiles)[ProfileId]['avatar'];

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
    summary: 'Вводная встреча с Алексеем',
    details:
      'На встрече обсудите цели стажировки, задачи команды и то, как будет устроена обратная связь. Подготовь пару вопросов о продукте.',
    due: 'Сегодня, 14:00',
    owner: 'Алексей Морозов',
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
    summary: 'Канал дизайна продукта',
    details: 'В командном чате можно представиться и задать организационные вопросы.',
    due: '16 ноября',
    owner: 'Анна Ким',
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
    owner: 'Анна Ким',
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
    owner: 'Алексей Морозов',
    stage: 'role',
    icon: 'book',
    tone: 'blue',
    resource: 'product',
  },
  {
    id: 'access',
    title: 'Запросить рабочие доступы',
    summary: 'Инструменты дизайна и аналитики',
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
    owner: 'Анна Ким',
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
    owner: 'Алексей Морозов',
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

export const eventsByProfile: Record<ProfileId, Event[]> = {
  olga: [
    {
      day: '16',
      month: 'НОЯ',
      title: 'Встреча с лидом',
      detail: 'Сегодня · 14:00–14:30',
      tone: 'lilac',
      description: 'Алексей расскажет о задачах команды и обсудит твои цели на первые недели.',
    },
    {
      day: '17',
      month: 'НОЯ',
      title: 'Кофе с наставником',
      detail: 'Завтра · 11:00–11:30',
      tone: 'pink',
      description: 'Неформальное знакомство с Анной. Можно задать вопросы о команде и повседневной работе.',
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
  sasha: [
    {
      day: '13',
      month: 'ФЕВ',
      title: 'Встреча на экваторе',
      detail: 'Сегодня · 12:00–12:30',
      tone: 'lilac',
      description: 'Обсуди с наставником результаты первых месяцев и цели на вторую половину стажировки.',
    },
  ],
  maria: [
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

export const people = [
  {
    id: 'alex',
    name: 'Алексей Морозов',
    initials: 'АМ',
    role: 'Лид команды',
    group: 'Руководитель',
    tone: 'lilac',
    bio: 'Отвечает за продуктовый дизайн и помогает ставить цели на стажировку.',
    contact: 'alexey@design.example',
  },
  {
    id: 'anna',
    name: 'Анна Ким',
    initials: 'АК',
    role: 'Старший дизайнер',
    group: 'Наставник',
    tone: 'mint',
    bio: 'Поможет с первой задачей, рабочими инструментами и обратной связью по макетам.',
    contact: 'anna@design.example',
  },
  {
    id: 'dasha',
    name: 'Дарья Волкова',
    initials: 'ДВ',
    role: 'Продуктовый дизайнер',
    group: 'Команда',
    tone: 'pink',
    bio: 'Проектирует сценарии поиска и помогает с исследованиями пользователей.',
    contact: 'daria@design.example',
  },
  {
    id: 'max',
    name: 'Максим Орлов',
    initials: 'МО',
    role: 'Frontend-инженер',
    group: 'Команда',
    tone: 'blue',
    bio: 'Помогает доводить макеты до интерфейса и отвечает за компоненты в коде.',
    contact: 'max@design.example',
  },
  {
    id: 'elena',
    name: 'Елена Савина',
    initials: 'ЕС',
    role: 'Продакт-менеджер',
    group: 'Команда',
    tone: 'mint',
    bio: 'Отвечает за приоритеты продукта и помогает понять, как измеряется результат команды.',
    contact: 'elena@design.example',
  },
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
    owner: 'Анна Ким',
    instruction: 'Открой пространство дизайна продукта и найди файл «Библиотека команды».',
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
    owner: 'Алексей Морозов',
    instruction: 'В разделе «Пространства» выбери «Дизайн продукта».',
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
    owner: 'Алексей Морозов',
    instruction: 'Для работы с доской дизайна запроси доступ к проекту команды.',
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
    owner: 'Анна Ким',
    instruction: 'В поиске каналов открой «Дизайн продукта».',
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
    body: 'Команда улучшает поиск и знакомство с предложениями. В первые недели изучи пользовательский путь, текущие задачи и библиотеку компонентов.',
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
    body: 'По задачам пиши лидеру команды Алексею. По первым шагам обратись к Анне. По оформлению и обучению поможет куратор стажировки.',
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

export type Person = (typeof people)[number];
export type Service = (typeof services)[number];
export type Resource = (typeof resources)[number];

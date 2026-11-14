export const products = {
  delivery: {
    name: 'Авито Доставка',
    description: 'Доставка товаров через партнёров сервиса.',
    tone: 'mint',
    team: 'Путь заказа',
    teamDescription: 'Изучает, где покупатели прерывают оформление доставки, и помогает упростить этот путь.',
    intern: 'olga',
    mentor: 'mentor',
    manager: 'manager',
    firstStep:
      'Посмотри воронку оформления доставки и вместе с наставником выбери этап, где чаще всего прерывают заказ.',
  },
  travel: {
    name: 'Авито Путешествия',
    description: 'Поиск и онлайн-бронирование жилья.',
    tone: 'blue',
    team: 'Бронирование жилья',
    teamDescription: 'Развивает сервисы проверки доступности жилья, подтверждения и отмены брони.',
    intern: 'sasha',
    mentor: 'travel-mentor',
    manager: 'travel-manager',
    firstStep: 'Разбери с наставником, как запрос проходит от проверки свободных дат до подтверждения брони.',
  },
  autoteca: {
    name: 'Автотека',
    description: 'Проверка истории автомобиля по VIN или госномеру.',
    tone: 'lilac',
    team: 'Качество отчётов',
    teamDescription: 'Проверяет поиск по VIN и госномеру и то, как данные об автомобиле отображаются в отчёте.',
    intern: 'timur',
    mentor: 'autoteca-mentor',
    manager: 'autoteca-manager',
    firstStep: 'С наставником прогони тестовые сценарии поиска по VIN и госномеру и сверь данные в отчёте.',
  },
  help: {
    name: '#яПомогаю',
    description: 'Социальные и экологические инициативы Авито.',
    tone: 'pink',
    team: 'Участие в проектах',
    teamDescription: 'Проектирует страницы социальных и экологических инициатив и путь пользователя до участия.',
    intern: 'maria',
    mentor: 'help-mentor',
    manager: 'help-manager',
    firstStep: 'Открой с наставником макеты инициативы и пройди путь от карточки проекта до кнопки участия.',
  },
} as const;

export type ProductId = keyof typeof products;

const internshipStages = {
  first: { day: 1, stage: 'Первый день', stageDescription: 'Знакомство с командой и настройка рабочего места' },
  midpoint: { day: 90, stage: 'Экватор', stageDescription: 'Первые результаты и обратная связь от наставника' },
  final: { day: 180, stage: 'Финал', stageDescription: 'Итоги стажировки и переход к самостоятельной работе' },
} as const;

type Stage = keyof typeof internshipStages;
export type AvatarVariant =
  | 'olga'
  | 'alexander'
  | 'maria'
  | 'timur'
  | 'anna'
  | 'alexey'
  | 'ilya'
  | 'ekaterina'
  | 'nina'
  | 'roman'
  | 'daria'
  | 'mikhail';

type Intern = {
  name: string;
  fullName: string;
  initials: string;
  avatar: AvatarVariant;
  position: string;
  productId: ProductId;
  stageId: Stage;
} & (typeof internshipStages)[Stage];

export const profiles = {
  olga: {
    name: 'Оля',
    fullName: 'Ольга Соколова',
    initials: 'ОС',
    avatar: 'olga',
    position: 'Продуктовый аналитик',
    productId: 'delivery',
    stageId: 'first',
    ...internshipStages.first,
  },
  sasha: {
    name: 'Саша',
    fullName: 'Александр Ким',
    initials: 'АК',
    avatar: 'alexander',
    position: 'Бэкенд-разработчик',
    productId: 'travel',
    stageId: 'midpoint',
    ...internshipStages.midpoint,
  },
  timur: {
    name: 'Тимур',
    fullName: 'Тимур Алиев',
    initials: 'ТА',
    avatar: 'timur',
    position: 'Тестировщик',
    productId: 'autoteca',
    stageId: 'first',
    ...internshipStages.first,
  },
  maria: {
    name: 'Маша',
    fullName: 'Мария Лебедева',
    initials: 'МЛ',
    avatar: 'maria',
    position: 'Веб-дизайнер',
    productId: 'help',
    stageId: 'final',
    ...internshipStages.final,
  },
} as const satisfies Record<string, Intern>;

export type ProfileId = keyof typeof profiles;

type StaffAccount = {
  name: string;
  initials: string;
  avatar: AvatarVariant;
  position: string;
  role: 'Наставник' | 'Руководитель';
  productId: ProductId;
  tone: 'mint' | 'blue';
  bio: string;
  contact: string;
};

export const staffAccounts = {
  mentor: {
    name: 'Анна Ким',
    initials: 'АК',
    avatar: 'anna',
    position: 'Старший продуктовый аналитик',
    role: 'Наставник',
    productId: 'delivery',
    tone: 'mint',
    bio: 'Поможет разобраться в метриках доставки и подготовить первый анализ.',
    contact: 'anna@delivery.example',
  },
  manager: {
    name: 'Алексей Морозов',
    initials: 'АМ',
    avatar: 'alexey',
    position: 'Продакт-менеджер',
    role: 'Руководитель',
    productId: 'delivery',
    tone: 'blue',
    bio: 'Отвечает за оформление доставки и помогает определить цели стажировки.',
    contact: 'alexey@delivery.example',
  },
  'travel-mentor': {
    name: 'Илья Воронцов',
    initials: 'ИВ',
    avatar: 'ilya',
    position: 'Старший бэкенд-разработчик',
    role: 'Наставник',
    productId: 'travel',
    tone: 'mint',
    bio: 'Покажет сервисы бронирования и поможет подготовить первое изменение.',
    contact: 'ilya@travel.example',
  },
  'travel-manager': {
    name: 'Екатерина Павлова',
    initials: 'ЕП',
    avatar: 'ekaterina',
    position: 'Тимлид разработки',
    role: 'Руководитель',
    productId: 'travel',
    tone: 'blue',
    bio: 'Координирует разработку бронирования и согласует цели стажировки.',
    contact: 'ekaterina@travel.example',
  },
  'autoteca-mentor': {
    name: 'Нина Белова',
    initials: 'НБ',
    avatar: 'nina',
    position: 'Старший инженер по тестированию',
    role: 'Наставник',
    productId: 'autoteca',
    tone: 'mint',
    bio: 'Знакомит с тестовыми данными и помогает подготовить проверки отчётов.',
    contact: 'nina@autoteca.example',
  },
  'autoteca-manager': {
    name: 'Роман Громов',
    initials: 'РГ',
    avatar: 'roman',
    position: 'Руководитель тестирования',
    role: 'Руководитель',
    productId: 'autoteca',
    tone: 'blue',
    bio: 'Отвечает за качество отчётов и определяет приоритеты проверок.',
    contact: 'roman@autoteca.example',
  },
  'help-mentor': {
    name: 'Дарья Волкова',
    initials: 'ДВ',
    avatar: 'daria',
    position: 'Старший веб-дизайнер',
    role: 'Наставник',
    productId: 'help',
    tone: 'mint',
    bio: 'Покажет макеты инициатив и поможет с первой задачей по интерфейсу.',
    contact: 'daria@help.example',
  },
  'help-manager': {
    name: 'Михаил Орлов',
    initials: 'МО',
    avatar: 'mikhail',
    position: 'Дизайн-лид',
    role: 'Руководитель',
    productId: 'help',
    tone: 'blue',
    bio: 'Отвечает за дизайн страниц инициатив и согласует задачи стажировки.',
    contact: 'mikhail@help.example',
  },
} as const satisfies Record<string, StaffAccount>;

export type StaffId = keyof typeof staffAccounts;
export type AccountId = ProfileId | StaffId;

export function isProfileId(id: string): id is ProfileId {
  return Object.hasOwn(profiles, id);
}

export function isStaffId(id: string): id is StaffId {
  return Object.hasOwn(staffAccounts, id);
}

export function teamContacts(profileId: ProfileId) {
  const { mentor, manager } = products[profiles[profileId].productId];
  return [manager, mentor].map((id) => ({ ...staffAccounts[id], id }));
}

export type Person = ReturnType<typeof teamContacts>[number];

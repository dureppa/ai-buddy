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
  | 'delivery-alina'
  | 'delivery-denis'
  | 'delivery-vera'
  | 'travel-artem'
  | 'travel-polina'
  | 'travel-kirill'
  | 'autoteca-oleg'
  | 'autoteca-ksenia'
  | 'autoteca-maksim'
  | 'help-yulia'
  | 'help-nikita'
  | 'help-elena'
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

type TeamContact = ReturnType<typeof teamContacts>[number];
type Colleague = {
  avatar: AvatarVariant;
  id: string;
  name: string;
  initials: string;
  position: string;
  bio: string;
  contact: string;
};

const colleagues: Record<ProductId, readonly Colleague[]> = {
  delivery: [
    {
      id: 'delivery-alina',
      avatar: 'delivery-alina',
      name: 'Алина Котова',
      initials: 'АК',
      position: 'Аналитик данных',
      bio: 'Ведёт дашборд воронки доставки и подскажет, где найти события оформления заказа.',
      contact: 'alina@delivery.example',
    },
    {
      id: 'delivery-denis',
      avatar: 'delivery-denis',
      name: 'Денис Власов',
      initials: 'ДВ',
      position: 'Бэкенд-разработчик',
      bio: 'Поддерживает расчёт сроков и стоимости доставки. Подскажет, как формируются статусы заказа.',
      contact: 'denis@delivery.example',
    },
    {
      id: 'delivery-vera',
      avatar: 'delivery-vera',
      name: 'Вера Никифорова',
      initials: 'ВН',
      position: 'Продуктовый дизайнер',
      bio: 'Проектирует оформление заказа и покажет, какие варианты проверяли в экспериментах.',
      contact: 'vera@delivery.example',
    },
  ],
  travel: [
    {
      id: 'travel-artem',
      avatar: 'travel-artem',
      name: 'Артём Сидоров',
      initials: 'АС',
      position: 'Бэкенд-разработчик',
      bio: 'Развивает календарь доступности жилья. Поможет воспроизвести бронирование на тестовом стенде.',
      contact: 'artem@travel.example',
    },
    {
      id: 'travel-polina',
      avatar: 'travel-polina',
      name: 'Полина Захарова',
      initials: 'ПЗ',
      position: 'Инженер по тестированию',
      bio: 'Проверяет подтверждение и отмену брони. Поделится тестовыми сценариями и данными.',
      contact: 'polina@travel.example',
    },
    {
      id: 'travel-kirill',
      avatar: 'travel-kirill',
      name: 'Кирилл Смирнов',
      initials: 'КС',
      position: 'Фронтенд-разработчик',
      bio: 'Отвечает за форму бронирования и объяснит, как интерфейс обрабатывает ошибки API.',
      contact: 'kirill@travel.example',
    },
  ],
  autoteca: [
    {
      id: 'autoteca-oleg',
      avatar: 'autoteca-oleg',
      name: 'Олег Фёдоров',
      initials: 'ОФ',
      position: 'Инженер данных',
      bio: 'Загружает и нормализует данные об автомобилях. Подскажет, откуда берутся поля в тестовом отчёте.',
      contact: 'oleg@autoteca.example',
    },
    {
      id: 'autoteca-ksenia',
      avatar: 'autoteca-ksenia',
      name: 'Ксения Романова',
      initials: 'КР',
      position: 'Инженер по автоматизации тестирования',
      bio: 'Поддерживает автотесты поиска по VIN и госномеру. Покажет, как запускать проверки и читать отчёты.',
      contact: 'ksenia@autoteca.example',
    },
    {
      id: 'autoteca-maksim',
      avatar: 'autoteca-maksim',
      name: 'Максим Егоров',
      initials: 'МЕ',
      position: 'Фронтенд-разработчик',
      bio: 'Разрабатывает интерфейс отчёта. Поможет разобраться, где возникает ошибка отображения данных.',
      contact: 'maksim@autoteca.example',
    },
  ],
  help: [
    {
      id: 'help-yulia',
      avatar: 'help-yulia',
      name: 'Юлия Миронова',
      initials: 'ЮМ',
      position: 'Редактор',
      bio: 'Готовит тексты страниц инициатив. Поможет сформулировать условия участия и действия на кнопках.',
      contact: 'yulia@help.example',
    },
    {
      id: 'help-nikita',
      avatar: 'help-nikita',
      name: 'Никита Андреев',
      initials: 'НА',
      position: 'Фронтенд-разработчик',
      bio: 'Собирает страницы инициатив. Обсудит с тобой адаптивность макетов и подскажет, какие компоненты уже есть.',
      contact: 'nikita@help.example',
    },
    {
      id: 'help-elena',
      avatar: 'help-elena',
      name: 'Елена Громова',
      initials: 'ЕГ',
      position: 'Координатор социальных проектов',
      bio: 'Общается с организаторами и подскажет, что важно показать участникам на странице проекта.',
      contact: 'elena@help.example',
    },
  ],
};

export type Person = TeamContact | (Colleague & { tone: 'paper'; role: 'Коллега' });

export function teamColleagues(profileId: ProfileId): Person[] {
  return colleagues[profiles[profileId].productId].map((person) => ({ ...person, tone: 'paper', role: 'Коллега' }));
}

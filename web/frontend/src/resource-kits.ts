import { products, profiles, staffAccounts, type ProfileId } from './demo-accounts';
import { templates, type JobRole } from '../../../corporate-services/access/frontend/catalog';
import { accessServiceUrl, knowledgeServiceUrl } from './resource-urls';

export const profileRoles: Record<ProfileId, JobRole> = {
  olga: 'analyst',
  sasha: 'backend',
  timur: 'tester',
  maria: 'designer',
  'delivery-ivan': 'analyst',
  'delivery-elena': 'analyst',
  'travel-pavel': 'backend',
  'travel-sofia': 'backend',
  'autoteca-egor': 'tester',
  'autoteca-alisa': 'tester',
  'help-mark': 'designer',
  'help-eva': 'designer',
};
export function resourceKit(profile: ProfileId) {
  const person = profiles[profile];
  const product = products[person.productId];
  const role = profileRoles[profile];
  const link = (id: string, group: string, title: string, description: string, href: string) => ({
    id: id === 'chat' ? 'baseline-' + person.productId + '-chat' : 'baseline-' + profile + '-' + id,
    group,
    title,
    description,
    source: { kind: 'link' as const, href },
    author: 'Стартовый набор команды · учебные данные',
  });
  const messenger = import.meta.env.VITE_MESSENGER_URL || 'https://chat.example/';
  const chat = (channel: string) => {
    const url = new URL(messenger);
    url.pathname = url.pathname.replace(/\/$/, '') + '/' + person.productId + '/' + channel;
    return url.toString();
  };
  const productTitle = {
    delivery: 'Авито Доставки',
    travel: 'Авито Путешествия',
    autoteca: 'Автотеки',
    help: '#яПомогаю',
  }[person.productId];
  const mentor = staffAccounts[product.mentor].name;
  const lead = staffAccounts[product.manager].name;
  const chats: [string, string, string, string][] = [
    [
      'chat',
      'all',
      'Общий чат для всех сотрудников ' + productTitle,
      'Объявления продукта и вопросы коллегам. Учебная ссылка мессенджера.',
    ],
    ['team-chat', 'team', 'Команда «' + product.team + '»', 'Ежедневные обсуждения задач, блокеров и ревью.'],
    ['role-chat', role, 'Сообщество: ' + person.position, 'Вопросы по специальности и обмен практиками.'],
    [
      'interns-chat',
      'interns',
      'Стажёры ' + product.name,
      'Вопросы адаптации, первые задачи и взаимопомощь стажёров продукта.',
    ],
    ['mentor-chat', 'mentor', 'Чат с наставником: ' + mentor, 'Личные вопросы по задачам и разбор пунктов адаптации.'],
    [
      'lead-chat',
      'lead',
      'Чат с руководителем: ' + lead,
      'Цели стажировки, приоритеты и обратная связь от руководителя.',
    ],
    ['daily-chat', 'daily', 'Дейли «' + product.team + '»', 'Короткий статус, блокеры и договорённости на день.'],
    [
      'alerts-chat',
      'alerts',
      'Алерты ' + product.name,
      'Сигналы мониторинга и короткие сообщения о сбоях. Учебный канал.',
    ],
    [
      'releases-chat',
      'releases',
      'Релизы ' + product.name,
      'Окна выкладки, заметки к релизу и что проверить после выката.',
    ],
    [
      'questions-chat',
      'questions',
      'Вопросы новичков · ' + product.team,
      'Сюда можно спросить, как устроены процессы, если ответа нет в инструкции.',
    ],
    [
      'random-chat',
      'random',
      'Неформальный чат «' + product.team + '»',
      'Знакомство с коллегами вне задач. Учебная ссылка.',
    ],
    [
      'duty-chat',
      'duty',
      'Дежурства «' + product.team + '»',
      'Кто на смене и куда писать, если сервис ведёт себя не так.',
    ],
  ];
  return [
    ...chats.map(([id, channel, title, description]) => link(id, 'Чаты', title, description, chat(channel))),
    ...templates
      .filter((t) => t.roles.length === 0 || t.roles.includes(role))
      .map((t) => {
        const url = new URL(accessServiceUrl);
        url.searchParams.set('profile', profile);
        url.searchParams.set('template', t.id);
        return link(
          'access-' + t.id,
          'Доступы',
          t.title,
          t.description + ' Откроется заполненная учебная заявка на 30 дней; проверьте её перед отправкой.',
          url.toString(),
        );
      }),
    ...[
      ['product-' + person.productId, 'Знакомство с продуктом: ' + product.name],
      ['team-' + person.productId, 'Как работает команда «' + product.team + '»'],
      ['role-' + role, 'Первые шаги: ' + person.position],
      ['guide-access', 'Как запрашивать рабочие доступы'],
      ['guide-first-week', 'План первой недели'],
    ].map(([page, title]) => {
      const url = new URL(knowledgeServiceUrl);
      url.searchParams.set('profile', profile);
      url.searchParams.set('page', page);
      return link(
        page,
        'Документы',
        title,
        'Учебная страница Confluence для знакомства с работой команды.',
        url.toString(),
      );
    }),
  ];
}

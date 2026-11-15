import { products, profiles, type ProfileId } from './demo-accounts';
import { templates, type JobRole } from '../../../corporate-services/access/frontend/catalog';
import { accessServiceUrl, knowledgeServiceUrl } from './resource-urls';

export const profileRoles: Record<ProfileId, JobRole> = {
  olga: 'analyst',
  sasha: 'backend',
  timur: 'tester',
  maria: 'designer',
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
  return [
    link(
      'chat',
      'Чаты',
      'Общий чат для всех сотрудников ' +
        { delivery: 'Авито Доставки', travel: 'Авито Путешествия', autoteca: 'Автотеки', help: '#яПомогаю' }[
          person.productId
        ],
      'Объявления продукта и вопросы коллегам. Учебная ссылка мессенджера.',
      chat('all'),
    ),
    link(
      'team-chat',
      'Чаты',
      'Команда «' + product.team + '»',
      'Ежедневные обсуждения задач, блокеров и ревью.',
      chat('team'),
    ),
    link(
      'role-chat',
      'Чаты',
      'Сообщество: ' + person.position,
      'Вопросы по специальности и обмен практиками.',
      chat(role),
    ),
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

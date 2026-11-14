import type { IconName } from '../../../apps/web/frontend/src/ui';
export const catalogVersion = 1;
export const permissions = { read: 'Чтение', write: 'Чтение и запись', admin: 'Администрирование' } as const;
export type Permission = keyof typeof permissions;
export type JobRole = 'analyst' | 'backend' | 'tester' | 'designer';
export const roleLabels: Record<JobRole, string> = {
  analyst: 'Аналитика',
  backend: 'Разработка',
  tester: 'Тестирование',
  designer: 'Дизайн',
};
export type ExtraField = { key: string; label: string; placeholder?: string; options?: readonly string[] };
export type AccessTemplate = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  color: string;
  roles: readonly JobRole[];
  system: string;
  keyHint: string;
  levels: readonly Permission[];
  fields: readonly ExtraField[];
  owner: string;
};
export const accessService = {
  id: 'access',
  title: 'Управление доступами',
  description: 'Каталог ресурсов, заявки и согласование прав.',
  icon: 'key',
  tone: 'blue',
} as const;
export const templates: AccessTemplate[] = [
  {
    id: 'dwh',
    title: 'Витрины данных DWH',
    description: 'Схемы и таблицы для продуктовой аналитики.',
    icon: 'layers',
    color: 'green',
    roles: ['analyst'],
    system: 'DWH',
    keyHint: 'delivery.orders_mart',
    levels: ['read'],
    owner: 'Владелец данных',
    fields: [
      { key: 'usage', label: 'Цель работы с данными', options: ['Исследование', 'Отчётность', 'Проверка гипотезы'] },
    ],
  },
  {
    id: 'bi',
    title: 'BI и дашборды',
    description: 'Отчёты, метрики и рабочие пространства команды.',
    icon: 'grid',
    color: 'blue',
    roles: ['analyst'],
    system: 'BI',
    keyHint: 'delivery-funnel',
    levels: ['read', 'write'],
    owner: 'Владелец аналитического пространства',
    fields: [{ key: 'workspace', label: 'Рабочее пространство', placeholder: 'Путь заказа' }],
  },
  {
    id: 'repository',
    title: 'Репозитории кода',
    description: 'Исходники, pull request и ревью изменений.',
    icon: 'file',
    color: 'purple',
    roles: ['backend'],
    system: 'Git',
    keyHint: 'travel/booking-api',
    levels: ['read', 'write'],
    owner: 'Владелец репозитория',
    fields: [
      { key: 'repository_url', label: 'Адрес репозитория', placeholder: 'https://git.example/travel/booking-api' },
    ],
  },
  {
    id: 'environments',
    title: 'Среды разработки',
    description: 'Dev, stage, логи и тестовые стенды сервисов.',
    icon: 'settings',
    color: 'orange',
    roles: ['backend', 'tester'],
    system: 'Платформа разработки',
    keyHint: 'booking-api',
    levels: ['read', 'write', 'admin'],
    owner: 'Владелец сервиса и инфраструктуры',
    fields: [
      { key: 'environment', label: 'Окружение', options: ['dev', 'stage'] },
      { key: 'namespace', label: 'Namespace / проект', placeholder: 'travel-booking' },
    ],
  },
  {
    id: 'test-data',
    title: 'Тестовые данные',
    description: 'Обезличенные наборы и фикстуры для проверок.',
    icon: 'check',
    color: 'teal',
    roles: ['tester'],
    system: 'Тестовые наборы',
    keyHint: 'autoteca-vin-fixtures',
    levels: ['read', 'write'],
    owner: 'Владелец тестового набора',
    fields: [{ key: 'test_plan', label: 'Сценарий проверки', placeholder: 'Поиск отчёта по VIN' }],
  },
  {
    id: 'figma',
    title: 'Дизайн-проекты',
    description: 'Макеты, прототипы и библиотеки компонентов.',
    icon: 'sparkles',
    color: 'pink',
    roles: ['designer'],
    system: 'Figma',
    keyHint: 'help-initiatives',
    levels: ['read', 'write'],
    owner: 'Владелец дизайн-проекта',
    fields: [{ key: 'project_url', label: 'Адрес проекта', placeholder: 'https://figma.com/…' }],
  },
  {
    id: 'research',
    title: 'Материалы исследований',
    description: 'Обезличенные результаты и выводы команды.',
    icon: 'search',
    color: 'purple',
    roles: ['designer', 'analyst'],
    system: 'Исследования',
    keyHint: 'help-participation',
    levels: ['read'],
    owner: 'Владелец исследования',
    fields: [{ key: 'study', label: 'Исследование', placeholder: 'Путь участия в инициативе' }],
  },
  {
    id: 'jira',
    title: 'Проекты и доски Jira',
    description: 'Планирование, задачи и рабочие доски.',
    icon: 'map',
    color: 'blue',
    roles: [],
    system: 'Jira',
    keyHint: 'travel-team',
    levels: ['read', 'write'],
    owner: 'Владелец доски',
    fields: [{ key: 'space', label: 'Ключ пространства', placeholder: 'travel' }],
  },
  {
    id: 'vpn',
    title: 'Корпоративная сеть',
    description: 'VPN для подключения с рабочего устройства.',
    icon: 'key',
    color: 'teal',
    roles: [],
    system: 'VPN',
    keyHint: 'team-network',
    levels: ['read'],
    owner: 'IT-поддержка',
    fields: [{ key: 'device', label: 'Имя рабочего устройства', placeholder: 'work-laptop-123' }],
  },
];
export function recommendedTemplates(role: JobRole) {
  return templates.filter((item) => item.roles.length === 0 || item.roles.includes(role));
}

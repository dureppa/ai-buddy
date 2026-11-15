import { backendEnabled } from './backend';
import type { Tone } from './data';
import { profiles, type ProfileId } from './demo-accounts';

type ToolCard = {
  id: string;
  title: string;
  description: string;
  symbol: string;
  category: string;
  tone: Tone;
};

export type ToolGuide = ToolCard & { instruction: string };
type ToolLink = ToolCard & { url: string; action: string };
export type Tool = ToolGuide | ToolLink;

export const jiraService = {
  id: 'jira',
  title: 'Jira',
  description: 'Доски команды и ваши задачи.',
  symbol: 'J',
  category: 'Задачи',
  tone: 'blue',
  url: import.meta.env.VITE_JIRA_URL || 'http://localhost:5189/',
  action: 'Открыть доски',
} as const;

export function toolProfileUrl(base: string, profile: ProfileId) {
  const internal = base.startsWith('/');
  const url = new URL(base, 'http://localhost');
  url.searchParams.set('profile', profile);
  return internal ? url.pathname + url.search + url.hash : url.toString();
}

export const confluenceService = {
  id: 'confluence',
  title: 'Confluence',
  description: 'Продукты, команды, специальности и гайды.',
  symbol: 'C',
  category: 'Документация',
  tone: 'blue',
  url: import.meta.env.VITE_CONFLUENCE_URL || 'http://localhost:5191/',
  action: 'Открыть базу знаний',
} as const;

const mattermost: ToolGuide = {
  id: 'mattermost',
  title: 'Mattermost',
  symbol: 'M',
  category: 'Связь',
  tone: 'mint',
  description: 'Чаты, обсуждения и объявления команды.',
  instruction: 'В поиске каналов Mattermost введи название своей команды.',
};

const roleTools: Record<ProfileId, readonly ToolGuide[]> = {
  olga: [
    {
      id: 'redash',
      title: 'Redash',
      symbol: 'R',
      category: 'Продуктовая аналитика',
      tone: 'pink',
      description: 'Воронка оформления заказов Авито Доставки.',
      instruction: 'В рабочем пространстве «Путь заказа» найди дашборд воронки и сравни конверсию между этапами.',
    },
    {
      id: 'trino',
      title: 'Витрина заказов',
      symbol: 'SQL',
      category: 'SQL / Trino',
      tone: 'blue',
      description: 'Данные, по которым можно проверить расчёт метрик доставки.',
      instruction: 'Найди витрину заказов в каталоге данных команды. Начни с определения метрики и сверки с дашбордом.',
    },
    {
      id: 'trisigma',
      title: 'Trisigma',
      symbol: 'T',
      category: 'Эксперименты',
      tone: 'lilac',
      description: 'A/B-тесты и результаты экспериментов команды.',
      instruction:
        'В разделе экспериментов команды найди тест по оформлению доставки. Сверь гипотезу и основную метрику.',
    },
  ],
  sasha: [
    {
      id: 'bitbucket',
      title: 'Bitbucket',
      symbol: 'B',
      category: 'Код и ревью',
      tone: 'blue',
      description: 'Репозиторий сервиса бронирования и pull requests.',
      instruction: 'В документации команды найди репозиторий сервиса бронирования и правила отправки pull request.',
    },
    {
      id: 'paas',
      title: 'PaaS',
      symbol: 'P',
      category: 'Окружения',
      tone: 'mint',
      description: 'Dev- и stage-окружения сервиса бронирования.',
      instruction: 'Найди сервис бронирования на панели PaaS и выбери окружение, указанное в задаче.',
    },
    {
      id: 'grafana',
      title: 'Grafana',
      symbol: 'G',
      category: 'Мониторинг',
      tone: 'pink',
      description: 'Графики ошибок и задержек сервиса бронирования.',
      instruction: 'На дашборде сервиса выбери окружение и период, в котором выполнялась проверка.',
    },
  ],
  timur: [
    {
      id: 'tms',
      title: 'Тест-кейсы · TMS',
      symbol: 'T',
      category: 'Тестирование',
      tone: 'lilac',
      description: 'Сценарии поиска отчёта и результаты прогонов.',
      instruction: 'В проекте Автотеки найди тесты поиска по VIN и госномеру и выбери сценарии для текущего прогона.',
    },
    {
      id: 'postman',
      title: 'Postman',
      symbol: 'P',
      category: 'Проверка API',
      tone: 'pink',
      description: 'Коллекция запросов для проверки API отчётов.',
      instruction:
        'Импортируй коллекцию команды, выбери тестовое окружение и сравни статус и поля ответа с тест-кейсом.',
    },
    {
      id: 'test-stand',
      title: 'Тестовый стенд Автотеки',
      symbol: 'С',
      category: 'Окружения и данные',
      tone: 'mint',
      description: 'Проверка отчётов на учебных VIN и госномерах.',
      instruction: 'Открой стенд из задачи и возьми VIN или госномер из синтетического набора команды.',
    },
  ],
  maria: [
    {
      id: 'figma',
      title: 'Figma',
      symbol: 'F',
      category: 'Макеты',
      tone: 'lilac',
      description: 'Макеты и прототипы инициатив #яПомогаю.',
      instruction: 'Открой файл инициативы по ссылке из задачи и пройди путь от карточки до участия.',
    },
    {
      id: 'design-system',
      title: 'Дизайн-система Авито',
      symbol: 'Д',
      category: 'Компоненты',
      tone: 'blue',
      description: 'Веб-компоненты, стили и правила их применения.',
      instruction: 'Открой веб-библиотеку в Figma и проверь варианты компонентов для своего сценария.',
    },
    {
      id: 'design-review',
      title: 'Дизайн-ревью',
      symbol: 'Р',
      category: 'Передача в разработку',
      tone: 'pink',
      description: 'Финальные макеты и спецификация для разработчиков.',
      instruction: 'Открой задачу на дизайн-ревью. Проверь ссылки на фреймы, состояния и комментарии к поведению.',
    },
  ],
};

export function toolsFor(profileId: ProfileId): Tool[] {
  const knowledge = new URL(confluenceService.url);
  if (!knowledge.searchParams.has('page')) knowledge.searchParams.set('page', 'team-' + profiles[profileId].productId);
  const guides = [...roleTools[profileId], mattermost];
  const links = backendEnabled
    ? guides.map((tool) => ({ ...tool, url: '/work-tools/' + tool.id, action: 'Открыть сервис' }))
    : guides;
  return [...links.slice(0, -1), jiraService, { ...confluenceService, url: knowledge.toString() }, links.at(-1)!];
}

import roleChecklist from '../../backend/internal/buddy/role-checklist.json';
import { toolsFor } from './tool-links';
import { z } from 'zod';
import { tasksFor } from './checklist';
import { corporateLinks } from './corporate-links';
import { services, type Service } from './data';
import { products, profiles, teamContacts, type ProfileId } from './demo-accounts';

const requestSchema = z.object({
  id: z.string(),
  number: z.string(),
  serviceId: z.string(),
  status: z.literal('submitted'),
});
const workspaceSchema = z.object({ completed: z.array(z.string()), requests: z.array(requestSchema) });

export type AccessRequest = z.infer<typeof requestSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
function serviceUrl(id: string) {
  return corporateLinks.find((service) => service.id === id)?.url ?? '/resources';
}

export type AccessDraft = {
  id: string;
  profileId: ProfileId;
  serviceId: Service['id'];
  expiresAt: number;
};

type ReplyText = {
  references?: { title: string; url: string }[];
  text: string;
  lines?: string[];
  link?: { label: string; to: string };
};
export type BuddyReply = ReplyText &
  (
    | { kind: 'answer' | 'access_denied' }
    | { kind: 'clarification'; awaitingService: boolean }
    | { kind: 'access_confirmation_required'; draft: AccessDraft }
  );

function seedWorkspace(profile: ProfileId): Workspace {
  return {
    completed: [...roleChecklist.initialCompleted[profile]],
    requests:
      profile === 'maria' ? [{ id: 'maria-grafana', number: 'Д-001', serviceId: 'grafana', status: 'submitted' }] : [],
  };
}

export function readWorkspace(storage: StoragePort, profile: ProfileId): Workspace {
  const seeded = seedWorkspace(profile);
  try {
    const stored = storage.getItem('ai-buddy.workspace.' + profile);
    if (stored) {
      const parsed = workspaceSchema.safeParse(JSON.parse(stored));
      if (parsed.success) {
        const ids = new Set(tasksFor(profile).map((task) => task.id));
        const known = parsed.data.completed.filter((id) => ids.has(id) || id.startsWith('extra-'));
        const hasStaleIds = parsed.data.completed.some((id) => !ids.has(id) && !id.startsWith('extra-'));
        if (hasStaleIds && known.length === 0) {
          return writeWorkspace(storage, profile, { ...seeded, requests: parsed.data.requests });
        }
        return { completed: known, requests: parsed.data.requests };
      }
    }
  } catch {
    // Fall back to the initial demo when saved browser data cannot be read.
  }
  return seeded;
}

export function writeWorkspace(storage: StoragePort, profile: ProfileId, workspace: Workspace): Workspace {
  storage.setItem('ai-buddy.workspace.' + profile, JSON.stringify(workspace));
  return workspace;
}

export function progressFor(workspace: Workspace) {
  const catalog = tasksFor('olga');
  const completed = catalog.filter((task) => workspace.completed.includes(task.id)).length;
  return { completed, remaining: catalog.length - completed, percent: Math.round((completed / catalog.length) * 100) };
}

export type BuddyGrowthStage = 'baby' | 'young' | 'adult';

export function buddyGrowthStage(profile: ProfileId, workspace: Workspace): BuddyGrowthStage {
  const stage = profiles[profile].stageId;
  if (stage === 'final') return 'adult';
  if (stage === 'first' && !workspace.completed.includes('equator-meeting')) return 'baby';

  const { completed, remaining } = progressFor(workspace);
  return completed * 100 >= (completed + remaining) * 85 ? 'adult' : 'young';
}

export function toggleTask(storage: StoragePort, profile: ProfileId, taskId: string): Workspace {
  const workspace = readWorkspace(storage, profile);
  if (!tasksFor(profile).some((task) => task.id === taskId) && !taskId.startsWith('extra-')) {
    throw new Error('Задача недоступна.');
  }
  const completed = workspace.completed.includes(taskId)
    ? workspace.completed.filter((id) => id !== taskId)
    : [...workspace.completed, taskId];
  return writeWorkspace(storage, profile, { ...workspace, completed });
}

export function completeTask(storage: StoragePort, profile: ProfileId, taskId: string): Workspace {
  const workspace = readWorkspace(storage, profile);
  return workspace.completed.includes(taskId) ? workspace : toggleTask(storage, profile, taskId);
}

export function mayRequest(profile: ProfileId, service: Service) {
  return service.state === 'requestable' && !(profile === 'sasha' && service.id === 'grafana');
}

export function confirmAccess(storage: StoragePort, profile: ProfileId, draft: AccessDraft, now = Date.now()) {
  if (draft.profileId !== profile) throw new Error('Эта заявка недоступна в текущем профиле.');
  const workspace = readWorkspace(storage, profile);
  const alreadySaved = workspace.requests.find((request) => request.id === draft.id);
  if (alreadySaved) return { workspace, request: alreadySaved };

  const service = services.find((item) => item.id === draft.serviceId);
  if (!service || !mayRequest(profile, service)) throw new Error('У этого профиля нет права на заявку.');
  if (draft.expiresAt <= now) throw new Error('Черновик истёк. Подготовь заявку ещё раз.');
  const existing = workspace.requests.find((request) => request.serviceId === draft.serviceId);
  if (existing) return { workspace, request: existing };

  const request: AccessRequest = {
    id: draft.id,
    number: 'Д-' + (workspace.requests.length + 1).toString().padStart(3, '0'),
    serviceId: draft.serviceId,
    status: 'submitted',
  };
  const updated = writeWorkspace(storage, profile, { ...workspace, requests: [...workspace.requests, request] });
  return { workspace: updated, request };
}

export function absenceServiceLink(text: string): { label: string; to: string } | undefined {
  if (/календар|расписан|событи|встреч|созвон|напоминан/i.test(text))
    return { label: 'Открыть календарь событий', to: '/events' };
  const question = text.toLowerCase().replaceAll('ё', 'е');
  if (!/отгул|отпуск|отсутстви/.test(question) || !/оформ|подать|заявк|откр|взять|хочу|нужен/.test(question))
    return undefined;
  return { label: 'Открыть «Отсутствия»', to: serviceUrl('absences') };
}

export function answerBuddy(
  text: string,
  workspace: Workspace,
  profile: ProfileId,
  awaitingService = false,
  now = Date.now(),
): BuddyReply {
  const question = text.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const service = services.find((item) => item.aliases.some((alias) => question.includes(alias)));
  const requestAccess = /запрос|подай|оформи|нужен доступ|получить доступ/.test(question) && /доступ/.test(question);

  if (requestAccess || (awaitingService && service)) {
    if (!service)
      return {
        kind: 'clarification',
        awaitingService: true,
        text: 'К какому сервису нужен доступ? Например, к Grafana или Jira.',
      };
    if (service.state === 'available')
      return {
        kind: 'answer',
        text: 'У тебя уже есть доступ к ' + service.title + '. ' + service.instruction,
        link: { label: 'Открыть инструменты', to: '/tools' },
      };
    if (!mayRequest(profile, service))
      return {
        kind: 'access_denied',
        text:
          'Для этого профиля заявка на ' + service.title + ' недоступна. Уточни порядок доступа у владельца сервиса.',
        link: { label: 'Открыть управление доступами', to: serviceUrl('access') },
      };
    const existing = workspace.requests.find((request) => request.serviceId === service.id);
    if (existing)
      return {
        kind: 'answer',
        text: 'Заявка ' + existing.number + ' на ' + service.title + ' уже отправлена.',
      };
    return {
      kind: 'access_confirmation_required',
      text: 'Подготовила заявку на ' + service.title + '. Проверь сервис и подтверди отправку.',
      draft: {
        id: profile + '-' + service.id + '-' + now,
        profileId: profile,
        serviceId: service.id,
        expiresAt: now + 15 * 60_000,
      },
    };
  }

  if (/отгул|отпуск|выходн/.test(question))
    return {
      kind: 'answer',
      text: 'В этом учебном сценарии сначала согласуй дату с лидом и уточни дальнейшие шаги в сервисе отсутствий.',
      link: { label: 'Открыть отсутствия', to: serviceUrl('absences') },
    };
  const tools = toolsFor(profile);
  if (/инструмент/.test(question))
    return {
      kind: 'answer',
      text: 'Вот инструменты для твоих задач.',
      lines: tools.slice(0, 3).map((tool) => tool.title + ' — ' + tool.description),
      link: { label: 'Открыть инструменты', to: '/tools' },
    };
  const tool = tools.find((item) => question.includes(item.title.toLocaleLowerCase('ru')) || item.id === service?.id);
  if (tool)
    return {
      kind: 'answer',
      text: tool.title + ' — ' + tool.description,
      link: { label: 'Открыть инструменты', to: 'instruction' in tool ? '/tools?service=' + tool.id : '/tools' },
    };
  const intern = profiles[profile];
  const product = products[intern.productId];
  const context =
    product.name +
    ' · команда «' +
    product.team +
    '». Твоя должность — ' +
    intern.position.toLocaleLowerCase('ru') +
    '.';
  if (/наставник|бадди|руководител|лид|команд|коллег/.test(question))
    return {
      kind: 'answer',
      text: context + ' ' + product.teamDescription,
      lines: teamContacts(profile).map(
        (person) => person.name + ' — ' + person.role.toLocaleLowerCase('ru') + ' · ' + person.contact,
      ),
      link: /продукт/.test(question)
        ? { label: 'Открыть путеводитель по продукту', to: '/product-guide' }
        : { label: 'Познакомиться с командой', to: '/team' },
    };
  if (/документ|подпис/.test(question))
    return {
      kind: 'answer',
      text: 'Начни с сервиса «Документы и инструкции». В нём есть памятка об оформлении и следующий шаг.',
      link: { label: 'Открыть документы', to: serviceUrl('documents') },
    };
  if (/продукт|професси|проект|должност|моя роль/.test(question))
    return {
      kind: 'answer',
      text: context + ' ' + product.teamDescription + ' ' + product.firstStep,
      link: { label: 'Открыть путеводитель по продукту', to: '/product-guide' },
    };
  if (/сегодня|начат|задач|план|остал/.test(question)) {
    const pending = tasksFor(profile).filter((task) => !workspace.completed.includes(task.id));
    return {
      kind: 'answer',
      text:
        context +
        ' ' +
        (pending.length
          ? product.firstStep + ' В плане адаптации ещё есть эти задачи:'
          : 'Все шаги адаптации уже выполнены. Если нужно освежить контекст проекта, начни с этого: ' +
            product.firstStep),
      lines: pending.slice(0, 4).map((task) => task.title + ' · ' + task.due),
      link: { label: 'Посмотреть план адаптации', to: '/onboarding' },
    };
  }
  return {
    kind: 'clarification',
    awaitingService: false,
    text: 'У меня пока нет подходящей инструкции. Можешь уточнить вопрос или спросить про задачи, команду и рабочие доступы.',
  };
}

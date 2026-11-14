import { z } from 'zod';
import { resources, services, tasks, type Service } from './data';
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

export function readWorkspace(storage: StoragePort, profile: ProfileId): Workspace {
  try {
    const stored = storage.getItem('ai-buddy.workspace.' + profile);
    if (stored) {
      const parsed = workspaceSchema.safeParse(JSON.parse(stored));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Fall back to the initial demo when saved browser data cannot be read.
  }
  const completedByStage: Record<(typeof profiles)[ProfileId]['stageId'], string[]> = {
    first: ['welcome', 'account', 'chat-join'],
    midpoint: tasks.slice(0, 10).map((task) => task.id),
    final: tasks.map((task) => task.id),
  };
  return {
    completed: completedByStage[profiles[profile].stageId],
    requests:
      profile === 'maria' ? [{ id: 'maria-grafana', number: 'Д-001', serviceId: 'grafana', status: 'submitted' }] : [],
  };
}

export function writeWorkspace(storage: StoragePort, profile: ProfileId, workspace: Workspace): Workspace {
  storage.setItem('ai-buddy.workspace.' + profile, JSON.stringify(workspace));
  return workspace;
}

export function progressFor(workspace: Workspace) {
  const completed = tasks.filter((task) => workspace.completed.includes(task.id)).length;
  return { completed, remaining: tasks.length - completed, percent: Math.round((completed / tasks.length) * 100) };
}

export function toggleTask(storage: StoragePort, profile: ProfileId, taskId: string): Workspace {
  const workspace = readWorkspace(storage, profile);
  if (!tasks.some((task) => task.id === taskId)) throw new Error('Задача недоступна.');
  const completed = workspace.completed.includes(taskId)
    ? workspace.completed.filter((id) => id !== taskId)
    : [...workspace.completed, taskId];
  return writeWorkspace(storage, profile, { ...workspace, completed });
}

export function serviceStatus(workspace: Workspace, service: Service) {
  return workspace.requests.some((request) => request.serviceId === service.id) ? 'submitted' : service.state;
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
        link: { label: 'Посмотреть владельца сервиса', to: '/tools?service=' + service.id },
      };
    const existing = workspace.requests.find((request) => request.serviceId === service.id);
    if (existing)
      return {
        kind: 'answer',
        text: 'Заявка ' + existing.number + ' на ' + service.title + ' уже отправлена и ждёт подтверждения.',
        link: { label: 'Посмотреть статус', to: '/tools?service=' + service.id },
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
      text: resources.find((resource) => resource.id === 'timeoff')!.body,
      link: { label: 'Открыть памятку', to: '/resources?article=timeoff' },
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
        ? { label: 'Открыть путеводитель по продукту', to: '/resources?article=product' }
        : { label: 'Познакомиться с командой', to: '/team' },
    };
  if (/документ|подпис/.test(question))
    return {
      kind: 'answer',
      text: 'Начни с раздела «Документы и инструкции». В нём есть памятка об оформлении и следующий шаг.',
      link: { label: 'Открыть документы', to: '/resources?article=documents' },
    };
  if (/продукт|професси|проект|должност|моя роль/.test(question))
    return {
      kind: 'answer',
      text: context + ' ' + product.teamDescription + ' ' + product.firstStep,
      link: { label: 'Открыть путеводитель по продукту', to: '/resources?article=product' },
    };
  if (service)
    return {
      kind: 'answer',
      text: service.title + ' — ' + service.description + ' ' + service.instruction,
      link: { label: 'Карточка сервиса', to: '/tools?service=' + service.id },
    };
  if (/сегодня|начат|задач|план|остал/.test(question)) {
    const pending = tasks.filter((task) => !workspace.completed.includes(task.id));
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

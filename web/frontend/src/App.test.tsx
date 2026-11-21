// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { apiFetch, askBackend, readBackendConversation } from './backend';
import { readWorkspace, writeWorkspace } from './demo';
import { tasksFor } from './checklist';
import { demoSessionKey } from './demo-session';
import { profiles, type ProfileId } from './demo-accounts';
import { surveyForTask, surveyTaskId, surveys, type SurveyStage } from './surveys';
import { changeTeamPlan, readRoleMarks, readTeamPlans, saveRoleMark, type ChecklistPlan } from './role-checklist-api';
import { readServiceQuestions } from './service-questions';
import { readMaterials, saveMaterial, setTaskMaterials } from './staff-data';
import { toolViews } from '../../../tools/shared/frontend/WorkToolViews';
import { scheduleKey, type ScheduleEvent } from './schedule';

vi.mock('./role-checklist-api', () => ({
  readRoleMarks: vi.fn(),
  saveRoleMark: vi.fn(),
  readTeamPlans: vi.fn(),
  changeTeamPlan: vi.fn(),
}));

const backendMode = vi.hoisted(() => ({ enabled: true }));
vi.mock('./backend', () => ({
  get backendEnabled() {
    return backendMode.enabled;
  },
  askBackend: vi.fn(),
  readBackendConversation: vi.fn(),
  apiFetch: vi.fn(async (_profile, path) => defaultAPIResponse(path)),
}));

function defaultAPIResponse(path: string) {
  if (path === '/api/v1/schedule/events') return Response.json({ events: [], has_more: false });
  return Response.json(
    path === '/api/v1/onboarding/surveys' || path === '/api/v1/notifications' ? [] : { events: [], unavailable: [] },
  );
}

it('saves calendar events through Go and reuses the event ID after an uncertain response', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  const serverEvents = new Map<string, ScheduleEvent>();
  const sentIds: string[] = [];
  vi.mocked(apiFetch).mockImplementation(async (_profile, path, options) => {
    if (path === '/api/v1/schedule/events')
      return Response.json({ events: [...serverEvents.values()], has_more: false });
    if (path.startsWith('/api/v1/schedule/events/') && options?.method === 'PUT') {
      const event = JSON.parse(String(options.body)) as ScheduleEvent;
      sentIds.push(event.id);
      serverEvents.set(event.id, event);
      if (sentIds.length === 1) throw new Error('response lost');
      return Response.json(event);
    }
    return defaultAPIResponse(path);
  });
  await mount('/events');
  await click(await button('Создать событие'));
  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const starts = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="startsAt"]'));
  title.value = 'Проверка серверного календаря';
  starts.value = '2080-01-01T12:00';
  await click(await button('Сохранить'));
  expect(container.textContent).toContain('Не удалось сохранить событие');
  await click(await button('Сохранить'));
  expect(sentIds).toHaveLength(2);
  expect(sentIds[0]).toBe(sentIds[1]);
  expect(serverEvents.size).toBe(1);
  expect(localStorage.getItem(scheduleKey('olga'))).toBeNull();
  await waitForElement(() => (container.textContent?.includes('Проверка серверного календаря') ? true : null));
  expect(container.textContent).toContain('Проверка серверного календаря');
});

let root: Root;
let client: QueryClient;
let container: HTMLDivElement;

function snapshot(profile: ProfileId, completed: string[], extras: ChecklistPlan['extras'] = []): ChecklistPlan {
  const total = tasksFor(profile).length + extras.length;
  return { profile_id: profile, completed, extras, total, percent: Math.round((completed.length / total) * 100) };
}

async function serverPlan(profile: ProfileId, completed: string[]) {
  const response = await vi.mocked(apiFetch).getMockImplementation()?.(profile, '/api/v1/onboarding/surveys');
  const stages = (await response?.json()) as SurveyStage[] | undefined;
  return snapshot(profile, [...completed.filter((id) => !surveyForTask(id)), ...(stages ?? []).map(surveyTaskId)]);
}

beforeEach(() => {
  backendMode.enabled = true;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => undefined;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.mocked(apiFetch)
    .mockReset()
    .mockImplementation(async (_profile, path) => defaultAPIResponse(path));
  vi.mocked(readBackendConversation).mockReset().mockResolvedValue([]);
  vi.mocked(readRoleMarks)
    .mockReset()
    .mockImplementation(async (profile) => serverPlan(profile, readWorkspace(localStorage, profile).completed));
  vi.mocked(readTeamPlans).mockReset().mockResolvedValue([]);
  vi.mocked(changeTeamPlan).mockReset();
  vi.mocked(saveRoleMark)
    .mockReset()
    .mockImplementation(async (profile, id, done) => {
      const workspace = readWorkspace(localStorage, profile);
      const completed = workspace.completed.filter((entry) => entry !== id);
      if (done) completed.push(id);
      writeWorkspace(localStorage, profile, { ...workspace, completed });
      return serverPlan(profile, completed);
    });
  vi.mocked(askBackend).mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(path: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

async function waitForElement<T>(find: () => T | null | undefined): Promise<T> {
  return vi.waitFor(async () => {
    await act(async () => {});
    const element = find();
    if (!element) throw new Error('Expected element is not visible');
    return element;
  });
}

function button(name: string) {
  return waitForElement(() =>
    [...container.querySelectorAll('button')].find(
      (item) => (item.getAttribute('aria-label') || item.textContent?.trim()) === name,
    ),
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function enterMessage(text: string) {
  const input = await waitForElement(() =>
    container.querySelector<HTMLInputElement>('input[aria-label="Сообщение для Buddy"]'),
  );
  await fill(input, text);
}

async function fill(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('redirects a signed-out visitor to sign-in and opens their workspace after account selection', async () => {
  await mount('/chat');
  await click(await waitForElement(() => container.querySelector<HTMLElement>('#product-delivery')));
  await click(await waitForElement(() => container.querySelector<HTMLElement>('#account-olga')));

  await waitForElement(() => container.querySelector<HTMLElement>('a[href="/chat"]'));
  expect(localStorage.getItem(demoSessionKey)).toBe('olga');
  expect(readBackendConversation).toHaveBeenCalledWith('olga');
});

it('restores the current profile history and clears it when another profile becomes active', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(readBackendConversation).mockImplementation(async (profile) => [
    { role: 'assistant', content: profile === 'olga' ? 'Документы Доставки' : 'Документы Путешествий' },
  ]);
  await mount('/chat');
  const history = () => container.querySelector<HTMLElement>('[role="log"]');
  await waitForElement(() => (history()?.textContent?.includes('Документы Доставки') ? history() : null));

  await act(async () => {
    localStorage.setItem(demoSessionKey, 'sasha');
    window.dispatchEvent(new StorageEvent('storage', { key: demoSessionKey }));
  });
  const current = await waitForElement(() =>
    history()?.textContent?.includes('Документы Путешествий') ? history() : null,
  );
  expect(current.textContent).not.toContain('Документы Доставки');
});

it('submits one message while a reply is pending and offers a new attempt after a server error', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  let rejectReply!: (error: Error) => void;
  const pending = new Promise<Awaited<ReturnType<typeof askBackend>>>((_, reject) => {
    rejectReply = reject;
  });
  vi.mocked(askBackend)
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce({ kind: 'answer', text: 'Заявка ДОС-000001 на согласовании.' });
  await mount('/chat');

  const question = 'Оформи доступ к витрине';
  await enterMessage(question);
  const send = await button('Отправить сообщение');
  expect(send.disabled).toBe(false);
  await click(send);
  await waitForElement(() => container.querySelector<HTMLElement>('[aria-label="Buddy думает"]'));
  expect(send.disabled).toBe(true);
  await click(send);
  expect(askBackend).toHaveBeenCalledTimes(1);
  expect(askBackend).toHaveBeenCalledWith('olga', question, expect.objectContaining({ checklist: expect.any(Object) }));

  await act(async () => rejectReply(new Error('Сервис недоступен')));
  const error = await waitForElement(() => container.querySelector<HTMLElement>('[role="alert"]'));
  expect(error.textContent).toContain('Buddy временно недоступен');

  await enterMessage(question);
  await click(await button('Отправить сообщение'));
  const answer = await waitForElement(() => {
    const log = container.querySelector<HTMLElement>('[role="log"]');
    return log?.textContent?.includes('ДОС-000001') ? log : null;
  });
  expect(answer.textContent).toContain('на согласовании');
  expect(askBackend).toHaveBeenCalledTimes(2);
});

it('toggles an onboarding task and restores the completion mark from storage', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/onboarding');
  const taskSelector = 'button[aria-label="Принципы продуктовой аналитики"]';
  const task = await waitForElement(() => container.querySelector<HTMLButtonElement>(taskSelector));
  expect(task.getAttribute('aria-checked')).toBe('false');
  await click(task);
  await vi.waitFor(() =>
    expect(container.querySelector<HTMLButtonElement>(taskSelector)?.getAttribute('aria-checked')).toBe('true'),
  );

  await act(async () => root.unmount());
  root = createRoot(container);
  client.clear();
  await mount('/onboarding');
  expect(
    (await waitForElement(() => container.querySelector<HTMLButtonElement>(taskSelector))).getAttribute('aria-checked'),
  ).toBe('true');
});

it.each([
  ['Созвон', 'blue'],
  ['Встреча', 'mint'],
  ['Напоминание', 'lilac'],
] as const)('creates a %s in %s and deletes it after confirmation', async (kind, tone) => {
  backendMode.enabled = false;
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/events');
  await click(await button('Создать событие'));
  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const startsAt = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="startsAt"]'));
  title.value = 'Встреча с командой теста';
  startsAt.value = '2099-06-16T10:00';
  container.querySelector<HTMLSelectElement>('select[name="kind"]')!.value = kind;
  await click(await button('Сохранить'));

  const created = await waitForElement(() =>
    container.querySelector<HTMLElement>('button[title="Встреча с командой теста"]'),
  );
  expect(created.classList.contains('tone-' + tone)).toBe(true);
  expect(JSON.parse(localStorage.getItem(scheduleKey('olga')) ?? '[]')).toContainEqual(
    expect.objectContaining({ title: 'Встреча с командой теста', kind, tone }),
  );

  await click(
    await waitForElement(() => container.querySelector<HTMLElement>('button[title="Встреча с командой теста"]')),
  );
  await click(await button('Удалить'));
  expect(container.textContent).toContain('Удалить событие?');
  await click(await button('Удалить'));
  await vi.waitFor(() => expect(container.textContent).not.toContain('Встреча с командой теста'));
});

it('shares staff edits and intern marks across profiles and reloads', async () => {
  localStorage.setItem(demoSessionKey, 'mentor');
  let olga = snapshot('olga', ['meet-team', surveyTaskId('first')]);
  const sasha = snapshot(
    'sasha',
    tasksFor('sasha').map(({ id }) => id),
  );
  vi.mocked(readTeamPlans).mockImplementation(async () => [olga, sasha]);
  vi.mocked(readRoleMarks).mockImplementation(async () => olga);
  vi.mocked(changeTeamPlan).mockImplementation(async (staff, profile, change) => {
    expect(staff).toBe('mentor');
    expect(profile).toBe('olga');
    if (typeof change === 'string') {
      olga = snapshot(
        'olga',
        olga.completed.filter((id) => id !== change),
      );
    } else {
      olga = snapshot('olga', olga.completed, [{ ...change, id: 'extra-server' }]);
    }
    return olga;
  });
  vi.mocked(saveRoleMark).mockImplementation(async (profile, id, done) => {
    expect(profile).toBe('olga');
    expect(done).toBe(true);
    olga = snapshot('olga', [...olga.completed, id], olga.extras);
    return olga;
  });
  async function reopen(account: 'mentor' | 'olga', route: string) {
    await act(async () => root.unmount());
    root = createRoot(container);
    client.clear();
    localStorage.setItem(demoSessionKey, account);
    await mount(route);
  }
  saveMaterial(localStorage, 'mentor', {
    title: 'Учебный отчёт',
    description: 'Пример для стажёра.',
    group: 'Документы',
    audience: ['olga'],
    source: { kind: 'link', href: 'https://example.com/report' },
  });
  await mount('/staff');
  const internCard = (name: string) =>
    waitForElement(() =>
      [...container.querySelectorAll<HTMLButtonElement>('.staff-intern')].find((item) =>
        item.textContent?.includes(name),
      ),
    );
  expect((await internCard(profiles.sasha.fullName)).textContent).toContain('100%');
  await click(await internCard(profiles.sasha.fullName));
  expect(container.querySelector('.staff-checklist')?.textContent).toContain('100% выполнено');
  await click(await button('Мои стажёры'));
  expect((await internCard(profiles.olga.fullName)).textContent).toContain(
    `${olga.completed.length} из ${olga.total} задач`,
  );
  await click(await internCard(profiles.olga.fullName));
  await click(await button('Добавить пункт'));

  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const summary = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('textarea[name="summary"]'));
  title.value = 'Проверить витрину заказов';
  summary.value = 'Сравни итог с учебным отчётом.';
  await click(await button('Добавить в чек-лист'));
  expect(container.textContent).toContain('Пункт добавлен в чек-лист.');
  await click(
    await waitForElement(() =>
      [...container.querySelectorAll<HTMLButtonElement>('.task-link')].find((item) =>
        item.textContent?.includes(title.value),
      ),
    ),
  );
  await click(await button('Прикрепить материал'));
  const search = await waitForElement(() =>
    container.querySelector<HTMLInputElement>('.material-picker input[type="search"]'),
  );
  await fill(search, 'Учебный отчёт');
  await click(await button('Прикрепить Учебный отчёт'));
  expect(container.querySelector('[role="status"].toast')?.textContent).toBe('Материал прикреплён.');

  await click(await button('Выйти из аккаунта'));
  await click(await waitForElement(() => container.querySelector<HTMLElement>('#product-delivery')));
  await click(await waitForElement(() => container.querySelector<HTMLElement>('#account-olga')));
  await click(await waitForElement(() => container.querySelector<HTMLElement>('a[href="/onboarding"]')));
  const task = await waitForElement(() =>
    container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Проверить витрину заказов"]'),
  );
  expect(task.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('.progress-number')?.textContent).toContain(`${olga.percent}%`);
  await click(task);
  await vi.waitFor(() => expect(task.getAttribute('aria-checked')).toBe('true'));
  await click(await waitForElement(() => task.closest('li')?.querySelector<HTMLButtonElement>('.task-link')));
  await waitForElement(() => container.querySelector<HTMLAnchorElement>('dialog a[href="https://example.com/report"]'));
  await reopen('mentor', '/staff');
  expect((await internCard(profiles.olga.fullName)).textContent).toContain(
    `${olga.completed.length} из ${olga.total} задач`,
  );
  await click(await internCard(profiles.olga.fullName));
  const customTask = await waitForElement(() =>
    [...container.querySelectorAll<HTMLButtonElement>('.task-link')].find((item) =>
      item.textContent?.includes('Проверить витрину заказов'),
    ),
  );
  expect(customTask.closest('li')?.classList.contains('task-row--done')).toBe(true);
  await click(customTask);
  await click(await button('Удалить пункт'));
  await reopen('olga', '/onboarding');
  await waitForElement(() => container.querySelector('.adaptation-layout'));
  expect(container.textContent).not.toContain('Проверить витрину заказов');
  expect(container.querySelector('.progress-number')?.textContent).toContain(`${olga.percent}%`);
});

it('retries the team guide after a failed generation and shows the team-specific cards', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  const cards = [
    { title: 'Команда доставки', text: 'Работает с заказами' },
    { title: 'Метрики доставки', text: 'Измеряет конверсию' },
    { title: 'Первые шаги', text: 'Изучает витрины' },
  ];
  vi.mocked(apiFetch).mockImplementation(async (_profile, path, options) => {
    if (path !== '/api/v1/product-guide/team') return Response.json({ events: [], unavailable: [] });
    return Response.json(options?.body ? { status: 'ready', cards } : { status: 'failed' });
  });
  await mount('/product-guide');
  await click(await button('Повторить'));
  const heading = await waitForElement(() =>
    [...container.querySelectorAll('h3')].find((item) => item.textContent === cards[0].title),
  );
  expect(heading.parentElement?.textContent).toContain(cards[0].text);
  expect(apiFetch).toHaveBeenCalledWith('olga', '/api/v1/product-guide/team', {
    method: 'POST',
    body: '{"retry":true}',
  });
});

it('finds a task by name and opens its details from the search results', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/home');
  await click(await button('Поиск'));
  const input = await waitForElement(() =>
    container.querySelector<HTMLInputElement>('input[aria-label="Поиск по AI-buddy"]'),
  );
  await fill(input, 'несуществующая задача');
  expect(container.textContent).toContain('Ничего не найдено.');
  await fill(input, 'Принципы продуктовой аналитики');
  const result = await waitForElement(() =>
    [...container.querySelectorAll<HTMLAnchorElement>('[role="dialog"] a, dialog a')].find((link) =>
      link.textContent?.includes('Принципы продуктовой аналитики'),
    ),
  );
  await click(result);
  await waitForElement(() =>
    container.querySelector<HTMLElement>('dialog[aria-label="Принципы продуктовой аналитики"]'),
  );
  expect(container.querySelector('input[aria-label="Поиск по AI-buddy"]')).toBeNull();
});

it('publishes, edits and removes a link in the mentor’s materials', async () => {
  localStorage.setItem(demoSessionKey, 'mentor');
  await mount('/staff');
  await click(await button('Материалы для стажёров'));
  await click(await button('Добавить материал'));

  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const description = await waitForElement(() =>
    container.querySelector<HTMLTextAreaElement>('textarea[name="description"]'),
  );
  const url = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="url"]'));
  title.value = 'Руководство по витринам';
  description.value = 'Данные для первой задачи.';
  url.value = 'https://example.com/guide';
  expect(container.querySelectorAll('input[name="audience"]')).toHaveLength(3);
  await click(container.querySelector<HTMLInputElement>('input[name="audience"][value="olga"]')!);
  await click(await button('Опубликовать материал'));
  expect(readMaterials(localStorage)[0].audience).toEqual(['delivery-ivan', 'delivery-elena']);
  await waitForElement(() => container.querySelector<HTMLAnchorElement>('a[href="https://example.com/guide"]'));

  await click(await button('Редактировать'));
  const editTitle = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  expect(editTitle.value).toBe('Руководство по витринам');
  expect(container.querySelector<HTMLInputElement>('input[name="audience"][value="olga"]')?.checked).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[name="audience"][value="delivery-ivan"]')?.checked).toBe(
    true,
  );
  editTitle.value = 'Обновлённое руководство';
  await click(await button('Сохранить изменения'));
  expect(container.textContent).toContain('Обновлённое руководство');

  await click(await button('Удалить'));
  await click(await button('Удалить публикацию'));
  expect(container.querySelector('a[href="https://example.com/guide"]')).toBeNull();
});

it('shows fetched HR events alongside a partial outage without hiding the calendar', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) =>
    path === '/api/v1/schedule/hr-today'
      ? Response.json({
          events: [{ id: 'leave', title: 'Отпуск', detail: 'До пятницы', service: 'absences' }],
          unavailable: ['trips'],
        })
      : defaultAPIResponse(path),
  );
  await mount('/events');
  const leave = await waitForElement(() =>
    [...container.querySelectorAll<HTMLAnchorElement>('a')].find((item) => item.textContent?.includes('До пятницы')),
  );
  expect(leave.href).toContain('5181');
  expect(container.textContent).toContain('Не удалось обновить часть данных HR.');
  expect(container.querySelector('[aria-label="Расписание на неделю"]')).not.toBeNull();
});

it('opens the role-specific Grafana guide without a request action', async () => {
  localStorage.setItem(demoSessionKey, 'sasha');
  await mount('/tools?service=grafana');
  const guide = await waitForElement(() =>
    container.querySelector<HTMLDialogElement>('dialog[open][aria-label="Grafana"]'),
  );
  expect(guide.textContent).toContain('Графики ошибок и задержек сервиса бронирования.');
  expect(guide.textContent).not.toContain('Подготовить заявку');
  expect(askBackend).not.toHaveBeenCalled();
});

it('shows history-loading errors and keeps the chat available for a new question', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(readBackendConversation).mockRejectedValueOnce(new Error('Недоступно'));
  await mount('/home');
  await click(await button('Открыть панель Buddy'));
  const alert = await waitForElement(() => container.querySelector<HTMLElement>('[role="alert"]'));
  expect(alert.textContent).toContain('Не удалось загрузить историю диалога.');
  await enterMessage('Где документация?');
  await vi.waitFor(async () => expect((await button('Отправить сообщение')).disabled).toBe(false));
});

it('shows the first-day reminder and navigates to the onboarding plan', async () => {
  backendMode.enabled = false;
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/home');
  await click(await button('Уведомления'));
  const plan = await waitForElement(() =>
    [...container.querySelectorAll<HTMLAnchorElement>('dialog a')].find((link) =>
      link.textContent?.includes('Посмотреть план'),
    ),
  );
  expect(container.textContent).toContain('знакомство с лидом');
  await click(plan);
  await waitForElement(() => container.querySelector<HTMLElement>('[aria-label="Фильтр задач"]'));
  expect(container.querySelector('dialog[aria-label="Уведомления"]')).toBeNull();
});

it('opens the midpoint survey from the chat', async () => {
  backendMode.enabled = false;
  localStorage.setItem(demoSessionKey, 'sasha');
  await mount('/chat');
  await click(await button('Пройти опрос'));
  expect((await button('Далее')).disabled).toBe(true);
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe(surveys.midpoint.title);
});

it('persists a confirmed demo request and leaves the tools page free of requests', async () => {
  backendMode.enabled = false;
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/chat');
  await enterMessage('Запроси доступ к Grafana');
  await click(await button('Отправить сообщение'));
  await click(await button('Подтвердить'));
  await waitForElement(() => {
    const log = container.querySelector<HTMLElement>('[role="log"]');
    return log?.textContent?.includes('Д-001') ? log : null;
  });
  expect(readWorkspace(localStorage, 'olga').requests).toMatchObject([{ number: 'Д-001', serviceId: 'grafana' }]);
  await click(await waitForElement(() => container.querySelector<HTMLAnchorElement>('a[href="/tools"]')));
  await waitForElement(() =>
    [...container.querySelectorAll('h1')].find((heading) => heading.textContent === 'Инструменты'),
  );
  expect(container.querySelector('main')?.textContent).not.toMatch(/Мои заявки|Д-001/);
  expect(askBackend).not.toHaveBeenCalled();
});

it('copies the selected teammate address and reports clipboard failures', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Clipboard denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    await mount('/team?person=mentor');
    const copy = await button('Скопировать адрес');
    const link = await waitForElement(() => container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]'));
    const address = link.getAttribute('href')?.slice('mailto:'.length);
    await click(copy);
    expect(writeText).toHaveBeenCalledWith(address);
    expect(container.textContent).toContain('Адрес скопирован.');
    await click(copy);
    expect(container.textContent).toContain('Не удалось скопировать. Адрес: ' + address);
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('stops and resumes the start-screen animation when the reduced-motion preference changes', async () => {
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const compact = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', (query: string) => (query.includes('reduced-motion') ? reduced : compact));
  const program = {};
  const buffer = {};
  const draw = vi.fn();
  const setWake = vi.fn((_location: string, values: Float32Array) => Array.from(values));
  const deleteBuffer = vi.fn();
  const deleteProgram = vi.fn();
  const gl = {
    createProgram: () => program,
    createShader: () => ({}),
    getProgramParameter: () => true,
    createBuffer: () => buffer,
    isContextLost: () => false,
    shaderSource() {},
    compileShader() {},
    attachShader() {},
    linkProgram() {},
    deleteShader() {},
    useProgram() {},
    bindBuffer() {},
    bufferData() {},
    getAttribLocation: () => 0,
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation: (_program: object, name: string) => name,
    uniform1f() {},
    uniform2f() {},
    uniform3f() {},
    uniform4fv: setWake,
    viewport() {},
    drawArrays: draw,
    deleteBuffer,
    deleteProgram,
  };
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(gl as unknown as WebGLRenderingContext);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  await mount('/');
  const canvas = await waitForElement(() => container.querySelector<HTMLCanvasElement>('canvas'));
  const tick = () => {
    const frame = frames.get(frameId);
    frames.delete(frameId);
    frame?.(performance.now());
  };

  tick();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(canvas.dataset.ready).toBe('true');

  const screen = await waitForElement(() => container.querySelector<HTMLElement>('.start-screen'));
  for (const x of [20, 140]) {
    screen.dispatchEvent(
      Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: 50 }), { pointerType: 'mouse' }),
    );
  }
  tick();
  expect(setWake.mock.results.at(-1)?.value?.some((value: number) => value !== 0)).toBe(true);
  screen.dispatchEvent(new Event('pointerleave'));

  reduced.matches = true;
  reduced.dispatchEvent(new Event('change'));
  expect(frames.size).toBe(0);
  expect(canvas.dataset.ready).toBeUndefined();

  reduced.matches = false;
  reduced.dispatchEvent(new Event('change'));
  tick();
  expect(draw).toHaveBeenCalledTimes(3);
  expect(canvas.dataset.ready).toBe('true');

  await act(async () => root.unmount());
  root = createRoot(container);
  expect(frames.size).toBe(0);
  expect(deleteBuffer).toHaveBeenCalledWith(buffer);
  expect(deleteProgram).toHaveBeenCalledWith(program);
});

it('opens settings from the profile button and leaves service feedback in the sidebar', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/home');
  const feedback = await button('Задать вопрос по работе сервиса');
  const sidebarButtons = feedback.closest('aside')?.querySelectorAll('button') ?? [];
  expect([...sidebarButtons].map((item) => item.textContent?.trim())).toEqual(['Задать вопрос по работе сервиса']);

  await click(await button('Профиль'));
  const settings = await waitForElement(() =>
    container.querySelector<HTMLDialogElement>('dialog[open][aria-label="Настройки"]'),
  );
  expect(settings.textContent).toContain('Выйти из аккаунта');
});

it('saves a valid service question for the active profile and blocks an empty submission', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/home');
  await click(await button('Задать вопрос по работе сервиса'));
  const submit = await button('Отправить вопрос');
  expect(submit.disabled).toBe(true);
  const input = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('textarea[name="question"]'));
  await fill(input, '  Где посмотреть статус заявки?  ');
  await click(submit);
  expect(container.textContent).toContain('Вопрос сохранён.');
  expect(readServiceQuestions(localStorage, 'olga')).toMatchObject([{ text: 'Где посмотреть статус заявки?' }]);
  expect(readServiceQuestions(localStorage, 'sasha')).toEqual([]);
});

it.each([
  ['Созвон', 'blue'],
  ['Встреча', 'mint'],
  ['Напоминание', 'lilac'],
] as const)('validates dates and updates an existing event to %s in %s', async (kind, tone) => {
  backendMode.enabled = false;
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/events');
  await click(await button('Создать событие'));
  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const date = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="startsAt"]'));
  title.value = 'Планирование';
  date.value = '2000-02-01T12:00';
  await click(await button('Сохранить'));
  expect(container.textContent).toContain('Укажи название, тип и время в будущем.');
  date.value = '2099-06-16T10:00';
  await click(await button('Сохранить'));
  await click(await waitForElement(() => container.querySelector<HTMLButtonElement>('button[title="Планирование"]')));
  (await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'))).value =
    'Синхронизация';
  container.querySelector<HTMLSelectElement>('select[name="kind"]')!.value = kind;
  await click(await button('Сохранить'));
  const updated = await waitForElement(() =>
    container.querySelector<HTMLButtonElement>('button[title="Синхронизация"]'),
  );
  expect(updated.classList.contains('tone-' + tone)).toBe(true);
  const saved = JSON.parse(localStorage.getItem(scheduleKey('olga')) ?? '[]');
  expect(saved.filter((event: { title: string }) => event.title === 'Синхронизация')).toEqual([
    expect.objectContaining({ kind, tone }),
  ]);
  expect(container.querySelector('button[title="Планирование"]')).toBeNull();
});

it('opens an API record from a work tool reference', async () => {
  localStorage.setItem(demoSessionKey, 'timur');
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) =>
    Response.json(
      path === '/api/v1/work-tools/test-stand'
        ? {
            name: 'Стенд Автотеки',
            area: 'Учебные отчёты',
            records: [
              { id: 'missing', title: 'Отчёт отсутствует', status: '404', description: 'Учебный ответ', fields: {} },
              { id: 'found', title: 'Отчёт найден', status: '200', description: 'Учебный результат', fields: {} },
            ],
          }
        : { events: [], unavailable: [] },
    ),
  );
  await mount('/work-tools/test-stand#found');
  const selected = await waitForElement(() => container.querySelector<HTMLElement>('article#found'));
  expect(selected.textContent).toContain('Учебный результат');
  expect(container.querySelector('article#missing')).toBeNull();
});

function mockToolRecords(
  records: Array<{ id: string; title: string; status: string; description: string; fields: Record<string, string> }>,
) {
  localStorage.setItem(demoSessionKey, 'timur');
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ name: 'Учебный сервис', area: 'Рабочая область', records }));
}

it.each(Object.keys(toolViews))('opens %s without a link back to the tools catalog', async (service) => {
  mockToolRecords([]);
  await mount('/work-tools/' + service);
  await vi.waitFor(() => expect(container.querySelector('.work-tool h1')?.textContent).toBe('Учебный сервис'));
  expect(container.querySelector('.work-tool a[href="/tools"]')).toBeNull();
});

it('shows fresh Postman responses from the stand and clears old results for unknown VINs', async () => {
  localStorage.setItem(demoSessionKey, 'timur');
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) =>
    Response.json({
      name: 'Учебный API',
      area: 'Коллекции',
      records: path.endsWith('/postman')
        ? [
            {
              id: 'request',
              title: 'Поиск отчёта',
              status: '404',
              description: '',
              fields: { Метод: 'GET', Сценарий: 'DEMO-VIN-017' },
            },
          ]
        : [{ id: 'found', title: 'DEMO-VIN-018', status: '200', description: '', fields: { Ответ: 'REPORT_FOUND' } }],
    }),
  );
  await mount('/work-tools/postman');
  const vin = await waitForElement(() => container.querySelector<HTMLInputElement>('input[aria-label="Учебный VIN"]'));
  await fill(vin, ' demo-vin-018 ');
  await click(await button('Отправить'));
  const response = await waitForElement(() => container.querySelector<HTMLElement>('.tool-response'));
  expect(response.textContent).toContain('HTTP 200');
  expect(response.textContent).toContain('REPORT_FOUND');
  await fill(vin, 'unknown');
  await click(await button('Отправить'));
  await vi.waitFor(() => expect(container.textContent).toContain('Для этого VIN нет учебной фикстуры.'));
  expect(container.querySelector<HTMLElement>('.tool-response')).toBeNull();
});

it.each([
  ['redash', 'Таблица', '1000'],
  ['grafana', 'Таблица', '3%'],
  ['trisigma', 'Гипотеза', 'Описание записи'],
  ['trino', '▶ Выполнить выборку', 'Результат выборки'],
  ['bitbucket', 'Комментарии ревью', 'Проверить даты'],
  ['tms', 'Пройден', 'Результат учебного прогона · Пройден'],
  ['test-stand', 'Показать ответ стенда', 'REPORT_FOUND'],
  ['figma', 'Ошибка', 'Не получилось отправить заявку'],
  ['design-system', 'Ошибка', 'Не получилось отправить заявку'],
  ['design-review', 'Отметить решённым', 'Открыть замечание снова'],
])('supports the primary interaction for %s', async (service, action, visible) => {
  mockToolRecords([
    {
      id: 'record',
      title: 'Учебная запись',
      status: '200',
      description: 'Описание записи',
      fields: {
        Сессии: '1000',
        'До релиза': '1%',
        'После релиза': '3%',
        Контроль: '68%',
        'Вариант B': '72%',
        Ответ: 'REPORT_FOUND',
        Замечание: 'Проверить даты',
      },
    },
  ]);
  await mount('/work-tools/' + service);
  await click(await button(action));
  expect(container.querySelector('article')?.textContent).toContain(visible);
});

it('filters channel navigation and posts a message in the open demo channel', async () => {
  mockToolRecords([
    { id: 'delivery', title: 'Доставка', status: 'Закреплено', description: 'Состояние релиза', fields: {} },
    { id: 'travel', title: 'Бронирование', status: 'Закреплено', description: 'План работ', fields: {} },
  ]);
  await mount('/work-tools/mattermost');
  const search = await waitForElement(() =>
    container.querySelector<HTMLInputElement>('input[aria-label="Поиск записей"]'),
  );
  await fill(search, 'брони');
  const links = container.querySelectorAll<HTMLAnchorElement>('.work-tool__sidebar nav a');
  expect(links).toHaveLength(1);
  await click(links[0]);
  const draft = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('textarea'));
  await fill(draft, 'Готово к проверке');
  await click(await button('Отправить'));
  expect(container.querySelector('.tool-channel ul')?.textContent).toContain('Готово к проверке');
  expect(draft.value).toBe('');
});

it('switches between the current and previous PaaS releases', async () => {
  mockToolRecords([
    {
      id: 'stage',
      title: 'booking-api · stage',
      status: 'Развёрнуто',
      description: 'Текущий релиз',
      fields: {
        Версия: '1.8.4',
        Предыдущая: '1.8.3',
      },
    },
  ]);
  await mount('/work-tools/paas');
  const select = await waitForElement(() =>
    container.querySelector<HTMLSelectElement>('select[aria-label="Версия релиза"]'),
  );
  await act(async () => {
    select.value = 'previous';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('.tool-thread h3')?.textContent).toBe('1.8.3');
  expect(container.querySelector('.tool-thread')?.textContent).toContain('Предыдущий релиз окружения');
});

it.each(Object.entries(profiles).map(([id, profile]) => ({ id: id as ProfileId, ...profile })))(
  'shows three outlined surveys for $name and opens the stage reminder',
  async (profile) => {
    backendMode.enabled = false;
    localStorage.setItem(demoSessionKey, profile.id);
    await mount('/onboarding');

    const rows = await waitForElement(() => {
      const cards = container.querySelectorAll('.task-row--survey');
      return cards.length === 3 ? cards : null;
    });
    expect([...rows].map((row) => row.querySelector('strong')?.textContent)).toEqual([
      surveys.first.title,
      surveys.midpoint.title,
      surveys.final.title,
    ]);
    expect([...rows].every((row) => !row.querySelector('[role="checkbox"], .task-ask'))).toBe(true);
    expect([...rows].every((row) => row.querySelector('.task-check')?.getAttribute('data-checked') === 'false')).toBe(
      true,
    );

    const bell = await button('Уведомления');
    expect(bell.querySelector('span')).not.toBeNull();
    await click(bell);
    const reminder = await button('Пройти опрос');
    await vi.waitFor(() => expect(bell.querySelector('span')).toBeNull());
    await click(reminder);
    expect(container.querySelector(`dialog[aria-label="${surveys[profile.stageId].title}"]`)).not.toBeNull();
    for (const question of surveys[profile.stageId].questions) {
      if (!('options' in question)) break;
      await click(
        await waitForElement(() =>
          container.querySelector<HTMLInputElement>(`input[name="${question.id}"][value="1"]`),
        ),
      );
      await click(await button('Далее'));
    }
    await click(await button('Отправить ответы'));
    await waitForElement(() => container.querySelector('.toast--top-right'));
    const saved = localStorage.getItem('ai-buddy.survey-answers.' + profile.id + '.' + profile.stageId);
    expect(Object.keys(JSON.parse(saved ?? '{}'))).toEqual(
      surveys[profile.stageId].questions.filter((question) => 'options' in question).map((question) => question.id),
    );
    const completedRow = container.querySelector('.task-row--survey.task-row--done');
    expect(completedRow?.textContent).toContain(surveys[profile.stageId].title);
    expect(completedRow?.querySelector('.task-check')?.getAttribute('data-checked')).toBe('true');
    expect(container.querySelectorAll('.task-row--survey .task-check[data-checked="false"]')).toHaveLength(2);

    await act(async () => root.unmount());
    client.clear();
    root = createRoot(container);
    await mount('/onboarding');
    const restoredCheck = await waitForElement(() =>
      container.querySelector('.task-row--survey.task-row--done .task-check[data-checked="true"]'),
    );
    expect(restoredCheck.closest('.task-row')?.textContent).toContain(surveys[profile.stageId].title);
    expect(restoredCheck.tagName).toBe('SPAN');
    expect(restoredCheck.getAttribute('role')).toBeNull();
  },
);

it('keeps survey answers when going back or retrying and marks the task only after success', async () => {
  localStorage.setItem(demoSessionKey, 'sasha');
  let complete = false;
  let attempts = 0;
  let read = false;
  vi.mocked(apiFetch).mockImplementation(async (_profile, path, options) => {
    if (path === '/api/v1/onboarding/surveys') return Response.json(complete ? ['midpoint'] : []);
    if (path === '/api/v1/notifications') {
      return Response.json(
        complete
          ? []
          : [
              {
                id: 'midpoint-reminder',
                title: surveys.midpoint.title,
                text: 'Поделись впечатлениями',
                action_title: 'Пройти опрос',
                action_url: '/onboarding?survey=midpoint',
                read,
              },
            ],
      );
    }
    if (path === '/api/v1/notifications/read') {
      expect(options?.body).toBe('{"ids":["midpoint-reminder"]}');
      read = true;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/v1/onboarding/surveys/midpoint') {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      expect(JSON.parse(String(options?.body))).toEqual({
        answers: {
          mentor: '2',
          hr_bp: '1',
          buddy: '1',
          frequency: '1',
          feedback: '1',
          goals: '1',
          comment: 'Комментарий',
        },
      });
      complete = true;
      return new Response(null, { status: 204 });
    }
    return defaultAPIResponse(path);
  });

  await mount('/onboarding');
  const bell = await button('Уведомления');
  await waitForElement(() => bell.querySelector('span'));
  await click(bell);
  await click(await button('Закрыть'));
  await vi.waitFor(() => expect(bell.querySelector('span')).toBeNull());
  await click(bell);
  await click(await button('Пройти опрос'));
  expect((await button('Далее')).disabled).toBe(true);

  await click(await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="mentor"][value="2"]')));
  await click(await button('Далее'));
  await click(await button('Назад'));
  expect(container.querySelector<HTMLInputElement>('input[name="mentor"][value="2"]')?.checked).toBe(true);
  await click(await button('Далее'));

  for (const question of ['hr_bp', 'buddy', 'frequency', 'feedback', 'goals']) {
    await click(
      await waitForElement(() => container.querySelector<HTMLInputElement>(`input[name="${question}"][value="1"]`)),
    );
    await click(await button('Далее'));
  }

  const comment = await waitForElement(() => container.querySelector<HTMLTextAreaElement>('dialog textarea'));
  await fill(comment, 'Комментарий');
  await click(await button('Отправить ответы'));
  await waitForElement(() => container.querySelector('dialog [role="alert"]'));
  expect(comment.value).toBe('Комментарий');
  expect(container.querySelector('.task-row--survey.task-row--done')).toBeNull();
  expect(container.querySelector('.task-row--survey .task-check[data-checked="true"]')).toBeNull();

  await click(await button('Отправить ответы'));
  const toast = await waitForElement(() => container.querySelector('.toast--top-right'));
  expect(toast.textContent).toContain('Ответы получены, спасибо за прохождение!');
  expect(container.querySelector('.task-row--survey.task-row--done')?.textContent).toContain(surveys.midpoint.title);
  expect(container.querySelector('.task-row--survey.task-row--done .task-check')?.getAttribute('data-checked')).toBe(
    'true',
  );
  expect(container.querySelector('dialog')).toBeNull();
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Текущий пункт после анкеты' });
  const visibleCurrent = await waitForElement(() =>
    [...container.querySelectorAll<HTMLElement>('.task-row')].find(
      (row) => row.querySelector('.task-time')?.textContent === 'В процессе',
    ),
  );
  await click(await button('Спросить Buddy'));
  await enterMessage('Что делать дальше?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
  expect(vi.mocked(askBackend).mock.calls[0][2]?.checklist).toMatchObject({
    status: 'in_progress',
    task: { label: visibleCurrent.querySelector('strong')!.textContent },
  });
  await click(await button('Закрыть панель Buddy'));
  await click(
    await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('.task-row--survey.task-row--done .task-link'),
    ),
  );
  expect(container.textContent).toContain('Опрос уже заполнен.');

  await act(async () => root.unmount());
  client.clear();
  root = createRoot(container);
  await mount('/onboarding?survey=midpoint');
  await waitForElement(() =>
    [...container.querySelectorAll('dialog p')].find((p) => p.textContent === 'Опрос уже заполнен.'),
  );
  expect(attempts).toBe(2);
  expect(container.querySelector('.task-row--survey.task-row--done .task-check')?.getAttribute('data-checked')).toBe(
    'true',
  );
});

it('opens the shared panel and asks once about the exact checklist item without completing it', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  let resolve!: (value: Awaited<ReturnType<typeof askBackend>>) => void;
  vi.mocked(askBackend).mockReturnValue(
    new Promise((value) => {
      resolve = value;
    }),
  );
  await mount('/onboarding');
  const ask = await button('Разобрать пункт');
  const row = ask.closest('li')!;
  const title = row.querySelector('strong')!.textContent!;
  const completed = [...readWorkspace(localStorage, 'olga').completed];
  await act(async () => {
    ask.click();
    ask.click();
  });
  await waitForElement(() => container.querySelector<HTMLInputElement>('input[aria-label="Сообщение для Buddy"]'));
  expect(container.querySelector('aside[aria-label="Чат с Buddy"]')).toBeTruthy();
  expect(container.querySelector('.chat-hero')).toBeNull();
  expect(container.querySelector('a[href="/onboarding"][aria-current="page"]')).toBeTruthy();
  expect(askBackend).toHaveBeenCalledTimes(1);
  expect(askBackend).toHaveBeenCalledWith(
    'olga',
    expect.stringContaining(title),
    expect.objectContaining({
      selection: expect.objectContaining({ resource: expect.objectContaining({ kind: 'task', label: title }) }),
    }),
  );
  expect(readWorkspace(localStorage, 'olga').completed).toEqual(completed);
  await act(async () => resolve({ kind: 'answer', text: 'Смысл пункта, шаги, инструменты и наставник.' }));
  await waitForElement(
    () =>
      [...container.querySelectorAll('[role="log"]')].find((element) =>
        element.textContent?.includes('Смысл пункта'),
      ) as HTMLElement,
  );
});

it('opens the same general panel from the help card and the floating Buddy without sending', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/onboarding');
  await click(await button('Спросить Buddy'));
  expect(container.querySelectorAll('aside[aria-label="Чат с Buddy"]')).toHaveLength(1);
  expect(container.querySelector('.buddy-task-context')).toBeNull();
  expect(askBackend).not.toHaveBeenCalled();
  await click(await button('Закрыть панель Buddy'));
  await click(await button('Открыть панель Buddy'));
  expect(container.querySelectorAll('aside[aria-label="Чат с Buddy"]')).toHaveLength(1);
  expect(askBackend).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector<HTMLElement>('.buddy-panel')).toBeNull();
});

it('preserves task context and history across panel, full chat and follow-ups, then clears it explicitly', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({
    kind: 'answer',
    text: 'Начни с инструкции',
    references: [{ title: 'Гайд', url: 'http://localhost:5191/?page=guide-access' }],
  });
  await mount('/onboarding');
  await click(await button('Разобрать пункт'));
  await waitForElement(() => container.querySelector<HTMLElement>('.buddy-panel .agent-sources a'));
  const context = vi.mocked(askBackend).mock.calls[0][2];
  await enterMessage('Какой первый шаг?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]).toEqual(context);
  await click(await waitForElement(() => container.querySelector<HTMLAnchorElement>('.buddy-panel__expand')));
  expect(container.querySelector<HTMLElement>('.buddy-panel')).toBeNull();
  expect(container.querySelector('.chat-hero')).toBeTruthy();
  expect(container.querySelector('.buddy-task-context')).toBeTruthy();
  expect(container.querySelector('[role="log"]')?.textContent).toContain('Какой первый шаг?');
  await enterMessage('А зачем?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(3));
  expect(vi.mocked(askBackend).mock.calls[2][2]).toEqual(context);
  await click(await button('Общий вопрос'));
  expect(container.querySelector('.buddy-task-context')).toBeNull();
  await enterMessage('Кто мой наставник?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(4));
  expect(vi.mocked(askBackend).mock.calls[3]).toEqual([
    'olga',
    'Кто мой наставник?',
    expect.objectContaining({ checklist: expect.any(Object) }),
  ]);
  expect(vi.mocked(askBackend).mock.calls[3][2]?.selection).toBeUndefined();
});

it('retries a failed task question with the same context without duplicating the user message', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend)
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({ kind: 'answer', text: 'Инструкция найдена' });
  await mount('/onboarding');
  await click(await button('Разобрать пункт'));
  await waitForElement(() => container.querySelector<HTMLElement>('.buddy-panel [role="alert"]'));
  const first = vi.mocked(askBackend).mock.calls[0];
  await click(await button('Повторить'));
  await waitForElement(() =>
    container.querySelector<HTMLElement>('.buddy-panel .chat-entry:not(.chat-entry--user) .bubble'),
  );
  expect(vi.mocked(askBackend).mock.calls[1]).toEqual(first);
  expect(container.querySelectorAll('.chat-entry--user')).toHaveLength(1);
});

it('switches selected tasks inside the one panel and returns to general mode through the help button', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Разбор пункта' });
  await mount('/onboarding');
  await button('Разобрать пункт');
  const asks = [...container.querySelectorAll<HTMLButtonElement>('.task-ask')];
  await click(asks[0]);
  await waitForElement(() =>
    container.querySelector<HTMLElement>('.buddy-panel .chat-entry:not(.chat-entry--user) .bubble'),
  );
  await click(asks[1]);
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(container.querySelectorAll('.buddy-panel')).toHaveLength(1);
  expect(container.querySelector('.buddy-task-context strong')?.textContent).toBe(
    asks[1].closest('li')!.querySelector('strong')!.textContent,
  );
  await click(await button('Спросить Buddy'));
  expect(container.querySelector('.buddy-task-context')).toBeNull();
});

it('shows attached material links in the panel and transmits their Confluence ids', async () => {
  localStorage.setItem(demoSessionKey, 'mentor');
  saveMaterial(localStorage, 'mentor', {
    title: 'Инструкция по задаче',
    description: 'Краткий гайд',
    group: 'Документы',
    audience: ['olga'],
    source: { kind: 'link', href: 'http://localhost:5191/?page=guide-access' },
  });
  const material = readMaterials(localStorage).find((item) => item.title === 'Инструкция по задаче')!;
  setTaskMaterials(localStorage, 'mentor', 'meet-team', [material.id]);
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Разбор' });
  await mount('/onboarding?task=meet-team');
  const dialog = await waitForElement(() => container.querySelector<HTMLDialogElement>('dialog[open]'));
  await click(
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Разобрать пункт')!,
  );
  expect(container.querySelector<HTMLDialogElement>('dialog[open]')).toBeNull();
  const link = await waitForElement(() => container.querySelector<HTMLAnchorElement>('.buddy-materials a'));
  expect(link.textContent).toContain('Инструкция по задаче');
  expect(new URL(link.href).searchParams.get('page')).toBe('guide-access');
  expect(vi.mocked(askBackend).mock.calls[0][2]?.selection?.resource).toMatchObject({
    kind: 'task',
    id: 'meet-team',
    page_ids: ['guide-access'],
  });
});

it('does not show the obsolete selection UI when ordinary page text is highlighted', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/onboarding');
  const node = await waitForElement(() => container.querySelector<HTMLParagraphElement>('.aside-note p'));
  const range = document.createRange();
  range.selectNodeContents(node);
  window.getSelection()?.addRange(range);
  await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  expect(document.querySelector('[data-selection-assistant]')).toBeNull();
  expect(askBackend).not.toHaveBeenCalled();
  window.getSelection()?.removeAllRanges();
});

it('does not show a late task response after the active profile changes', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  let resolve!: (value: Awaited<ReturnType<typeof askBackend>>) => void;
  vi.mocked(askBackend).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await mount('/onboarding');
  await click(await button('Разобрать пункт'));
  await act(async () => {
    localStorage.setItem(demoSessionKey, 'sasha');
    window.dispatchEvent(new StorageEvent('storage', { key: demoSessionKey }));
  });
  await act(async () => resolve({ kind: 'answer', text: 'Private reply for olga' }));
  expect(container.querySelector<HTMLElement>('.buddy-panel')).toBeNull();
  expect(container.textContent).not.toContain('Private reply for olga');
});

it('opens the general panel from the dashboard Buddy card without changing the page', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/home');
  await click(await waitForElement(() => container.querySelector<HTMLButtonElement>('button.quick-card')));
  expect(container.querySelector('.buddy-panel')).toBeTruthy();
  expect(container.querySelector('a[href="/home"][aria-current="page"]')).toBeTruthy();
  expect(askBackend).not.toHaveBeenCalled();
});

it('sends exactly the visible in-progress task and updates it after checking the task', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Начни с текущего пункта' });
  await mount('/onboarding');
  const current = await waitForElement(() =>
    [...container.querySelectorAll<HTMLElement>('.task-row')].find(
      (row) => row.querySelector('.task-time')?.textContent === 'В процессе',
    ),
  );
  const title = current.querySelector('strong')!.textContent!;
  await click(await button('Спросить Buddy'));
  await enterMessage('С чего начать сегодня?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
  expect(vi.mocked(askBackend).mock.calls[0][2]?.checklist).toMatchObject({
    status: 'in_progress',
    task: { label: title },
  });
  await click(await button('Закрыть панель Buddy'));
  await click(current.querySelector<HTMLButtonElement>('[role=checkbox]')!);
  const next = await waitForElement(() =>
    [...container.querySelectorAll<HTMLElement>('.task-row')].find(
      (row) =>
        row.querySelector('.task-time')?.textContent === 'В процессе' &&
        row.querySelector('strong')?.textContent !== title,
    ),
  );
  await click(await button('Спросить Buddy'));
  await enterMessage('Какая задача дальше?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]?.checklist).toMatchObject({
    status: 'in_progress',
    task: { label: next.querySelector('strong')!.textContent },
  });
});

it('uses the same current plan for the suggestion button and the typed current-task question', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Текущий пункт' });
  await mount('/chat');
  await vi.waitFor(async () => expect((await button('С чего начать сегодня?')).disabled).toBe(false));
  await click(await button('С чего начать сегодня?'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
  await enterMessage('какая задача сейчас?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  const [suggested, typed] = vi.mocked(askBackend).mock.calls;
  expect(typed[2]).toEqual(suggested[2]);
  expect(typed[2]?.selection).toBeUndefined();
  expect(typed[2]?.checklist?.status).toBe('in_progress');
});

it.each(['olga', 'sasha', 'timur', 'maria'] as ProfileId[])(
  'switches from a selected old task to the current plan on a typed question for %s',
  async (profile) => {
    localStorage.setItem(demoSessionKey, profile);
    vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Ответ о пункте' });
    await mount('/onboarding');
    const current = await waitForElement(() =>
      [...container.querySelectorAll<HTMLElement>('.task-row')].find(
        (row) => row.querySelector('.task-time')?.textContent === 'В процессе',
      ),
    );
    const currentTitle = current.querySelector('strong')!.textContent!;
    const completedBefore = [...readWorkspace(localStorage, profile).completed];
    const other = await waitForElement(() =>
      [...container.querySelectorAll<HTMLElement>('.task-row')].find(
        (row) => row !== current && row.querySelector('button.task-ask'),
      ),
    );
    const ask = [...other.querySelectorAll('button')].find((item) => item.textContent === 'Разобрать пункт')!;
    await click(ask);
    await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
    expect(vi.mocked(askBackend).mock.calls[0][2]?.selection?.resource?.label).not.toBe(currentTitle);
    await enterMessage('С чего начать этот пункт?');
    await click(await button('Отправить сообщение'));
    await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
    expect(vi.mocked(askBackend).mock.calls[1][2]?.selection).toEqual(
      vi.mocked(askBackend).mock.calls[0][2]?.selection,
    );
    await enterMessage('какая задача сейчас?');
    await click(await button('Отправить сообщение'));
    await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(3));
    const context = vi.mocked(askBackend).mock.calls[2][2];
    expect(context?.selection).toBeUndefined();
    expect(context?.checklist).toMatchObject({ status: 'in_progress', task: { label: currentTitle } });
    expect(context?.checklist?.status).toBe('in_progress');
    if (context?.checklist?.status !== 'in_progress') throw new Error('Expected current task');
    expect(readWorkspace(localStorage, profile).completed).toEqual(completedBefore);
  },
);

it('completes the last practice memo by text, keeps retries idempotent and tells the next request the plan is complete', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  writeWorkspace(localStorage, 'olga', {
    completed: tasksFor('olga')
      .filter((t) => t.id !== 'practice-memo')
      .map((t) => t.id),
    requests: [],
  });
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) =>
    path === '/api/v1/onboarding/surveys' ? Response.json(['first', 'midpoint', 'final']) : defaultAPIResponse(path),
  );
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Изучи памятку по закрытию практики.' });
  await mount('/chat');
  await enterMessage('С чего начать сегодня?');
  await click(await button('Отправить сообщение'));
  await waitForElement(() => container.querySelector('.suggestions button[title*="закрытию практики"]'));
  await vi.waitFor(async () => expect((await button('Отметить текущую задачу выполненной')).disabled).toBe(false));
  await enterMessage('ознакомился');
  await click(await button('Отправить сообщение'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('отмечен выполненным'));
  const completed = readWorkspace(localStorage, 'olga');
  expect(completed.completed).toContain('practice-memo');
  expect(completed.requests).toEqual([]);
  expect(askBackend).toHaveBeenCalledTimes(1);
  await enterMessage('готово');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(readWorkspace(localStorage, 'olga')).toEqual(completed));
  await enterMessage('Что делать дальше?');
  await vi.waitFor(async () => expect((await button('Отправить сообщение')).disabled).toBe(false));
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]?.checklist).toEqual({ status: 'completed' });
});

it('completes a task from the Buddy panel and restores its actual checklist checkbox after reload', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Твой текущий пункт — принципы аналитики.' });
  await mount('/home');
  await click(await button('Открыть панель Buddy'));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  await enterMessage('Какое у меня текущее задание?');
  const send = await button('Отправить сообщение');
  await vi.waitFor(() => expect(send.disabled).toBe(false));
  await click(send);
  await click(await button('Отметить текущую задачу выполненной'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('отмечен выполненным'));
  expect(readWorkspace(localStorage, 'olga').completed).toContain('dev-principles');
  expect(askBackend).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  client.clear();
  await mount('/onboarding');
  const checkbox = await waitForElement(() =>
    container.querySelector('[role="checkbox"][aria-label="Принципы продуктовой аналитики"]'),
  );
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
});

it('completes the real current task after discussing a different one and restores the result', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  const tasks = tasksFor('olga');
  const first = tasks.findIndex(({ id }) => id === 'avito-numbers');
  let serverMarks = tasks.slice(0, first).map(({ id }) => id);
  vi.mocked(readRoleMarks).mockImplementation(async () => snapshot('olga', serverMarks));
  vi.mocked(saveRoleMark).mockImplementationOnce(async (_profile, id) => {
    serverMarks = [...serverMarks, id];
    return snapshot('olga', serverMarks);
  });
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Прочитай памятку.' });
  await mount('/onboarding?task=practice-memo');
  const detail = await waitForElement(() => container.querySelector('dialog'));
  await click([...detail.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Разобрать пункт')!);
  const action = await button('Отметить текущую задачу выполненной');
  expect(action.title).toBe('Изучи Авито в цифрах');
  await enterMessage('А какие материалы нужны для этого пункта?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]).toMatchObject({
    selection: { resource: { id: 'practice-memo' } },
    checklist: { task: { id: 'avito-numbers' } },
  });
  await enterMessage('готово');
  await click(await button('Отправить сообщение'));
  await waitForElement(() =>
    container.querySelector('[role="log"]')?.textContent?.includes('Сейчас мы обсуждаем другой пункт'),
  );
  expect(saveRoleMark).not.toHaveBeenCalled();
  await click(await button('Отметить текущую задачу выполненной'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('отмечен выполненным'));
  expect(saveRoleMark).toHaveBeenCalledExactlyOnceWith('olga', 'avito-numbers', true, true);
  expect(serverMarks).not.toContain('practice-memo');
  expect(readWorkspace(localStorage, 'olga').completed).not.toContain('avito-numbers');
  writeWorkspace(localStorage, 'olga', { completed: [], requests: [] });
  await act(async () => root.unmount());
  root = createRoot(container);
  client.clear();
  await mount('/onboarding');
  const checked = await waitForElement(() =>
    container.querySelector('[role="checkbox"][aria-label="Изучи Авито в цифрах"]'),
  );
  expect(checked.getAttribute('aria-checked')).toBe('true');
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/chat"]')!.click());
  await enterMessage('Какая задача сейчас?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(3));
  expect(vi.mocked(askBackend).mock.calls[2][2]).toMatchObject({
    checklist: { task: { id: tasks[first + 1].id } },
  });
  expect(vi.mocked(askBackend).mock.calls[2][2]?.selection).toBeUndefined();
});

it('refreshes the plan after a rejected stale confirmation without sending the next task', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Текущий пункт.' });
  vi.mocked(saveRoleMark).mockImplementationOnce(async () => {
    const completed = [...readWorkspace(localStorage, 'olga').completed, 'dev-principles'];
    vi.mocked(readRoleMarks).mockResolvedValue(snapshot('olga', completed));
    throw new Error('stale_checklist');
  });
  await mount('/chat');
  await enterMessage('Какая задача сейчас?');
  await click(await button('Отправить сообщение'));
  await click(await button('Отметить текущую задачу выполненной'));
  await waitForElement(() =>
    container.querySelector('[role="log"]')?.textContent?.includes('Не удалось сохранить отметку'),
  );
  await vi.waitFor(() => expect(readRoleMarks).toHaveBeenCalledTimes(2));
  expect(saveRoleMark).toHaveBeenCalledExactlyOnceWith('olga', 'dev-principles', true, true);
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
});

it('does not report success after a storage failure and allows a successful retry', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Твой пункт — принципы аналитики.' });
  await mount('/chat');
  await enterMessage('С чего начать сегодня?');
  await click(await button('Отправить сообщение'));
  const confirm = await button('Отметить текущую задачу выполненной');
  const save = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw new Error('Storage unavailable');
  });
  await click(confirm);
  await waitForElement(() =>
    container.querySelector('[role="log"]')?.textContent?.includes('Не удалось сохранить отметку'),
  );
  expect(readWorkspace(localStorage, 'olga').completed).not.toContain('dev-principles');
  save.mockRestore();
  await click(await button('Отметить текущую задачу выполненной'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('отмечен выполненным'));
  expect(readWorkspace(localStorage, 'olga').completed).toContain('dev-principles');
});

it('opens the required survey instead of faking its completion from chat', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  writeWorkspace(localStorage, 'olga', {
    completed: tasksFor('olga')
      .filter((t) => !t.id.startsWith('internship-survey'))
      .map((t) => t.id),
    requests: [],
  });
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Твой пункт — опрос.' });
  await mount('/chat');
  await enterMessage('Какое у меня задание?');
  await click(await button('Отправить сообщение'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('Твой пункт — опрос.'));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  await enterMessage('готово');
  await click(await button('Отправить сообщение'));
  await button('Далее');
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe(surveys.first.title);
  expect(readWorkspace(localStorage, 'olga').completed).not.toContain('internship-survey-first');
  expect(askBackend).toHaveBeenCalledTimes(1);
  expect(vi.mocked(apiFetch).mock.calls.some(([, , init]) => init?.method === 'PUT')).toBe(false);
});

it('opens the absence service from a task discussion even without an LLM and never marks that task complete', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  const before = readWorkspace(localStorage, 'olga');
  vi.mocked(askBackend).mockResolvedValueOnce({ kind: 'answer', text: 'Прочитай памятку.' });
  await mount('/onboarding?task=practice-memo');
  const detail = await waitForElement(() =>
    container.querySelector('dialog[aria-label="Изучи памятку по закрытию практики"]'),
  );
  await click([...detail.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Разобрать пункт')!);
  await waitForElement(() => container.querySelector('.suggestions button[title*="продуктовой аналитики"]'));
  vi.mocked(askBackend).mockRejectedValue(new Error('LLM unavailable'));
  await enterMessage('Как оформить отгул?');
  await vi.waitFor(async () => expect((await button('Отправить сообщение')).disabled).toBe(false));
  await click(await button('Отправить сообщение'));
  const service = await waitForElement(() =>
    container.querySelector<HTMLAnchorElement>('a[href^="http://localhost:5181/"]'),
  );
  expect(new URL(service.href).searchParams.get('profile')).toBe('olga');
  await waitForElement(() => container.querySelector('.buddy-chat-error'));
  expect(askBackend).toHaveBeenCalledTimes(2);
  expect(vi.mocked(askBackend).mock.calls[1][2]?.selection).toBeUndefined();
  expect(container.querySelector('.buddy-task-context')).toBeNull();
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  await enterMessage('готово');
  await click(await button('Отправить сообщение'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('Выбери задачу в плане'));
  expect(readWorkspace(localStorage, 'olga')).toEqual(before);
  expect(askBackend).toHaveBeenCalledTimes(2);
});

it('shows completion only for a task question and removes it after saving', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Да, я тут.' });
  await mount('/chat');
  await enterMessage('ты тут?');
  await click(await button('Отправить сообщение'));
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('Да, я тут.'));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  await enterMessage('Какое у меня задание?');
  await click(await button('Отправить сообщение'));
  const confirm = await button('Отметить текущую задачу выполненной');
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  await waitForElement(() => container.querySelector('[role="log"]')?.textContent?.includes('отмечен выполненным'));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  expect(container.querySelector('[role="log"]')?.textContent?.match(/отмечен выполненным/g)).toHaveLength(1);
  const saved = readWorkspace(localStorage, 'olga');
  await enterMessage('готово');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(readWorkspace(localStorage, 'olga')).toEqual(saved));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
});

it('updates both suggestion lists and sends the freshly selected task after checklist completion', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Вот текущий пункт.' });
  await mount('/chat');
  const topics = () => [...container.querySelectorAll<HTMLButtonElement>('.chat-topic')];
  const chips = () => [...container.querySelectorAll<HTMLButtonElement>('.suggestions .filter')];
  const labels = (buttons: HTMLButtonElement[]) => buttons.map((item) => item.textContent?.trim());

  const question = await waitForElement(() => {
    const first = topics()[0];
    return first?.textContent?.includes('С чего начать сегодня?') && !first.disabled ? first : null;
  });
  expect(labels(chips())).toEqual(labels(topics()).slice(0, chips().length));
  await click(question);
  const firstContext = vi.mocked(askBackend).mock.calls[0][2];
  expect(firstContext?.checklist).toMatchObject({ task: { id: 'dev-principles' } });

  await click(await button('Отметить текущую задачу выполненной'));
  const nextHelp = await waitForElement(() =>
    chips().find((item) => item.textContent?.includes('Изучи Авито в цифрах')),
  );
  expect(labels(chips())).toEqual(labels(topics()).slice(0, chips().length));
  expect(nextHelp.textContent).toContain('Изучи Авито в цифрах');
  await click(nextHelp);
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  const nextContext = vi.mocked(askBackend).mock.calls[1][2];
  expect(nextContext?.selection?.resource).toMatchObject({ kind: 'task', label: 'Изучи Авито в цифрах' });
  expect(nextContext?.checklist).toMatchObject({ task: { label: 'Изучи Авито в цифрах' } });
});

it('offers only general questions and sends an unavailable snapshot when survey API fails', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Анна Ким.' });
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) => {
    if (path === '/api/v1/onboarding/surveys') throw new Error('Service unavailable');
    return defaultAPIResponse(path);
  });
  await mount('/chat');
  const mentorQuestion = await button('Кто мой наставник?');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(mentorQuestion.disabled).toBe(false);
  });
  expect([...container.querySelectorAll('.chat-topic')].map((button) => button.textContent?.trim())).toEqual([
    'Кто мой наставник?',
    'Какие инструменты нужны моей команде?',
    'Где найти документы?',
  ]);
  await click(mentorQuestion);
  expect(vi.mocked(askBackend).mock.calls[0][2]).toMatchObject({ checklist: { status: 'unavailable' } });
  await enterMessage('Какая задача сейчас?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
});

it('switches to work questions after the API confirms the last survey', async () => {
  localStorage.setItem(demoSessionKey, 'maria');
  let submitted = false;
  vi.mocked(apiFetch).mockImplementation(async (_profile, path) =>
    path === '/api/v1/onboarding/surveys'
      ? Response.json(submitted ? ['first', 'midpoint', 'final'] : ['first', 'midpoint'])
      : defaultAPIResponse(path),
  );
  await mount('/chat');
  await waitForElement(() =>
    container.querySelector('.chat-topic')?.textContent?.includes(surveys.final.title) ? true : null,
  );
  submitted = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['role-checklist', 'maria'] });
  });
  await waitForElement(() =>
    container.querySelector('.chat-topic')?.textContent?.includes('Какие инструменты нужны моей команде?')
      ? true
      : null,
  );
  expect(container.querySelector('.suggestions button')?.textContent).toBe('Какие инструменты нужны моей команде?');
  expect(container.querySelector('.chat-aside')?.textContent).not.toContain(surveys.final.title);
  expect(askBackend).not.toHaveBeenCalled();
});

it('replaces task suggestions in both places after a topic switch and sends no old selection', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Ответ.' });
  await mount('/chat');
  await click(await button('С чего начать сегодня?'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
  await enterMessage('Что может помешать выполнить задачу?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]?.selection?.resource?.kind).toBe('task');
  await enterMessage('Где найти документы?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(3));
  expect(vi.mocked(askBackend).mock.calls[2][2]?.selection).toBeUndefined();
  await waitForElement(
    () => container.querySelector('.chat-topic')?.textContent?.includes('Где найти путеводитель') || null,
  );
  expect(container.querySelector('.suggestions button')?.textContent).toBe('Где найти путеводитель по продукту?');
});

it.each(['Как создать задачу в Jira?', 'Как запросить доступ к BI?'])(
  'keeps a related question across chats and detaches the task for %s',
  async (independent) => {
    localStorage.setItem(demoSessionKey, 'olga');
    vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Ответ.' });
    const before = readWorkspace(localStorage, 'olga');
    await mount('/onboarding?task=practice-memo');
    const detail = await waitForElement(() => container.querySelector('dialog'));
    await click([...detail.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Разобрать пункт')!);
    await waitForElement(() => container.querySelector('.suggestions button[title]'));
    const link = await waitForElement(() => container.querySelector<HTMLAnchorElement>('aside a[href="/chat"]'));
    await click(link);
    await enterMessage('А какие материалы нужны для этого пункта?');
    await click(await button('Отправить сообщение'));
    await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
    expect(vi.mocked(askBackend).mock.calls[1][2]?.selection?.resource).toMatchObject({ id: 'practice-memo' });
    await enterMessage(independent);
    await click(await button('Отправить сообщение'));
    await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(3));
    expect(vi.mocked(askBackend).mock.calls[2][2]?.selection).toBeUndefined();
    expect(container.querySelector('.buddy-task-context')).toBeNull();
    expect(container.querySelector('.suggestions button[title]')).toBeNull();
    expect(readWorkspace(localStorage, 'olga')).toEqual(before);
  },
);

it('restores saved messages without reviving an old task selection or completion action', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(readBackendConversation).mockResolvedValue([
    { role: 'user', content: 'Объясни пункт моего чек-листа «Изучи продуктовые алерты»' },
    { role: 'assistant', content: 'Описание пункта из истории.' },
  ]);
  vi.mocked(askBackend).mockResolvedValue({ kind: 'answer', text: 'Инструкция Jira.' });
  await mount('/chat');
  await waitForElement(() =>
    container.querySelector('[role="log"]')?.textContent?.includes('Описание пункта из истории.'),
  );
  expect(container.querySelector('.buddy-task-context')).toBeNull();
  expect(container.querySelector('.suggestions button[title]')).toBeNull();
  await enterMessage('Как создать задачу в Jira?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(1));
  expect(vi.mocked(askBackend).mock.calls[0][2]?.selection).toBeUndefined();
});

it.each([false, true])('switches between team interns and edits only the selected checklist (API=%s)', async (api) => {
  backendMode.enabled = api;
  localStorage.setItem(demoSessionKey, 'manager');
  const second: ProfileId = 'delivery-ivan';
  const third: ProfileId = 'delivery-elena';
  const plans = [snapshot('olga', []), snapshot(second, []), snapshot(third, [])];
  vi.mocked(readTeamPlans).mockResolvedValue(plans);
  vi.mocked(changeTeamPlan).mockImplementation(async (_staff, profile, change) =>
    snapshot(profile, [], typeof change === 'string' ? [] : [{ ...change, id: 'extra-test-person' }]),
  );
  saveMaterial(localStorage, 'manager', {
    title: 'Личный учебник',
    description: 'Материал второго стажёра',
    group: 'Документы',
    audience: [second],
    source: { kind: 'link', href: 'https://example.com/personal' },
  });
  await mount('/staff');
  const card = (name: string) =>
    waitForElement(() =>
      [...container.querySelectorAll<HTMLButtonElement>('.staff-intern')].find((item) =>
        item.textContent?.includes(name),
      ),
    );
  await click(await card(profiles[second].fullName));
  await click(await button('Добавить пункт'));
  container.querySelector<HTMLInputElement>('input[name="title"]')!.value = 'Личное задание Ивана';
  container.querySelector<HTMLTextAreaElement>('textarea[name="summary"]')!.value = 'Прочитать свой учебник';
  await click(await button('Добавить в чек-лист'));
  const task = () =>
    waitForElement(() =>
      [...container.querySelectorAll<HTMLButtonElement>('.task-link')].find((item) =>
        item.textContent?.includes('Личное задание Ивана'),
      ),
    );
  await click(await task());
  await click(await button('Прикрепить материал'));
  await fill(
    await waitForElement(() => container.querySelector<HTMLInputElement>('.material-picker input[type="search"]')),
    'Личный учебник',
  );
  await click(await button('Прикрепить Личный учебник'));
  await click(await button('Мои стажёры'));
  await click(await card(profiles[third].fullName));
  expect(container.textContent).not.toContain('Личное задание Ивана');
  expect(container.textContent).not.toContain('Личный учебник');
  await click(await button('Мои стажёры'));
  await click(await card(profiles[second].fullName));
  await click(await task());
  expect(container.textContent).toContain('Личный учебник');
  if (api)
    expect(changeTeamPlan).toHaveBeenCalledWith(
      'manager',
      second,
      expect.objectContaining({ title: 'Личное задание Ивана' }),
    );
});

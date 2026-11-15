// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { apiFetch, askBackend, readBackendConversation } from './backend';
import { readWorkspace } from './demo';
import { demoSessionKey } from './demo-session';
import { profiles, type ProfileId } from './demo-accounts';
import { surveys } from './surveys';
import { readServiceQuestions } from './service-questions';
import { readMaterials, saveMaterial, setTaskMaterials } from './staff-data';
import { toolViews } from '../../../tools/shared/frontend/WorkToolViews';

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
  return Response.json(
    path === '/api/v1/onboarding/surveys' || path === '/api/v1/notifications' ? [] : { events: [], unavailable: [] },
  );
}

let root: Root;
let client: QueryClient;
let container: HTMLDivElement;

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

it('adds a personal calendar event and deletes it after confirmation', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  await mount('/events');
  await click(await button('Создать событие'));
  const title = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  const startsAt = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="startsAt"]'));
  title.value = 'Встреча с командой теста';
  startsAt.value = '2099-06-16T10:00';
  await click(await button('Сохранить'));

  await click(
    await waitForElement(() => container.querySelector<HTMLElement>('button[title="Встреча с командой теста"]')),
  );
  await click(await button('Удалить'));
  expect(container.textContent).toContain('Удалить событие?');
  await click(await button('Удалить'));
  await vi.waitFor(() => expect(container.textContent).not.toContain('Встреча с командой теста'));
});

it('shows the task a mentor adds in the intern’s workspace after signing out', async () => {
  localStorage.setItem(demoSessionKey, 'mentor');
  saveMaterial(localStorage, 'mentor', {
    title: 'Учебный отчёт',
    description: 'Пример для стажёра.',
    group: 'Документы',
    audience: ['olga'],
    source: { kind: 'link', href: 'https://example.com/report' },
  });
  await mount('/staff');
  await click(await waitForElement(() => container.querySelector<HTMLButtonElement>('.staff-intern')));
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
  await click(await waitForElement(() => task.closest('li')?.querySelector<HTMLButtonElement>('.task-link')));
  await waitForElement(() => container.querySelector<HTMLAnchorElement>('dialog a[href="https://example.com/report"]'));
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
  await click(await button('Опубликовать материал'));
  await waitForElement(() => container.querySelector<HTMLAnchorElement>('a[href="https://example.com/guide"]'));

  await click(await button('Редактировать'));
  const editTitle = await waitForElement(() => container.querySelector<HTMLInputElement>('input[name="title"]'));
  expect(editTitle.value).toBe('Руководство по витринам');
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

it('keeps an invalid event in the editor, then updates an existing event without creating a second one', async () => {
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
  await click(await button('Сохранить'));
  await waitForElement(() => container.querySelector<HTMLButtonElement>('button[title="Синхронизация"]'));
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
  await enterMessage('что делать дальше?');
  await click(await button('Отправить сообщение'));
  await vi.waitFor(() => expect(askBackend).toHaveBeenCalledTimes(2));
  expect(vi.mocked(askBackend).mock.calls[1][2]?.checklist).toMatchObject({
    status: 'in_progress',
    task: { label: next.querySelector('strong')!.textContent },
  });
});

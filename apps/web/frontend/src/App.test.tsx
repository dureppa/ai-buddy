// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { apiFetch, askBackend, readBackendConversation } from './backend';
import { demoSessionKey } from './demo-session';
import { readServiceQuestions } from './service-questions';
import { saveMaterial } from './staff-data';

const backendMode = vi.hoisted(() => ({ enabled: true }));
vi.mock('./backend', () => ({
  get backendEnabled() {
    return backendMode.enabled;
  },
  askBackend: vi.fn(),
  readBackendConversation: vi.fn(),
  apiFetch: vi.fn(async () => Response.json({ events: [], unavailable: [] })),
}));

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
    .mockImplementation(async () => Response.json({ events: [], unavailable: [] }));
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

async function waitForElement<T extends HTMLElement>(find: () => T | null | undefined): Promise<T> {
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
  expect(askBackend).toHaveBeenCalledWith('olga', question);

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
  await click(await button('Добавить материалы'));
  const search = await waitForElement(() =>
    container.querySelector<HTMLInputElement>('dialog[open] input[aria-label="Поиск материалов"]'),
  );
  await fill(search, 'Учебный отчёт');
  await click(await button('Добавить Учебный отчёт'));
  await click(await button('Сохранить материалы'));
  expect(container.textContent).toContain('Материалы пункта сохранены.');

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
  vi.mocked(apiFetch).mockResolvedValueOnce(
    Response.json({
      events: [{ id: 'leave', title: 'Отпуск', detail: 'До пятницы', service: 'absences' }],
      unavailable: ['trips'],
    }),
  );
  await mount('/events');
  const leave = await waitForElement(() =>
    [...container.querySelectorAll<HTMLAnchorElement>('a')].find((item) => item.textContent?.includes('До пятницы')),
  );
  expect(leave.href).toContain('5181');
  expect(container.textContent).toContain('Не удалось обновить часть данных HR.');
  expect(container.querySelector('[aria-label="Расписание на неделю"]')).not.toBeNull();
});

it('opens a service request from the tools page and hands it to the chat', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(askBackend).mockResolvedValueOnce({ kind: 'answer', text: 'Уточни причину запроса.' });
  await mount('/tools?service=grafana');
  await click(await button('Подготовить заявку'));
  expect(askBackend).toHaveBeenCalledWith('olga', 'Запроси доступ к Grafana');
  const message = await waitForElement(() =>
    [...container.querySelectorAll<HTMLElement>('[role="log"] .bubble')].find((item) =>
      item.textContent?.includes('Уточни причину запроса.'),
    ),
  );
  expect(message.textContent).toContain('Уточни причину запроса.');
});

it('shows history-loading errors and keeps the chat available for a new question', async () => {
  localStorage.setItem(demoSessionKey, 'olga');
  vi.mocked(readBackendConversation).mockRejectedValueOnce(new Error('Недоступно'));
  await mount('/home');
  await click(await button('Открыть быстрый чат'));
  const alert = await waitForElement(() => container.querySelector<HTMLElement>('[role="alert"]'));
  expect(alert.textContent).toContain('Не удалось загрузить историю диалога.');
  await enterMessage('Где документация?');
  expect((await button('Отправить сообщение')).disabled).toBe(false);
});

it('shows the first-day reminder and navigates to the onboarding plan', async () => {
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

it('records the midpoint survey and removes the reminder on the next visit', async () => {
  localStorage.setItem(demoSessionKey, 'sasha');
  await mount('/chat');
  await click(await button('Пройти опрос'));
  const submit = await button('Отправить ответ');
  expect(submit.disabled).toBe(true);
  await click(await waitForElement(() => container.querySelector<HTMLInputElement>('input[value="Нужна помощь"]')));
  await click(submit);
  expect(container.textContent).toContain('Спасибо! Ответ записан в демо.');
  expect(container.textContent).not.toContain('Пройти опрос');
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount('/chat');
  await waitForElement(() => container.querySelector<HTMLElement>('[role="log"]'));
  expect(container.textContent).not.toContain('Пройти опрос');
});

it('persists a confirmed demo request and shows its number on the tools page', async () => {
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
  await click(await waitForElement(() => container.querySelector<HTMLAnchorElement>('a[href="/tools"]')));
  await waitForElement(() =>
    [...container.querySelectorAll('h2')].find((heading) => heading.textContent === 'Мои заявки'),
  );
  expect(container.textContent).toContain('Д-001');
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

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { demoSessionKey } from './demo-session';
import { materialsForTask, saveMaterial, setTaskMaterials, type MaterialInput } from './staff-data';
import type { AccountId } from './demo-accounts';

vi.mock('./backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backend')>()),
  backendEnabled: false,
}));

const storage = new Map<string, string>();
const writeStorage = vi.fn((key: string, value: string) => storage.set(key, value));

const task = { id: 'meet-team', title: 'Познакомься с командой' };
const chat = 'Общий чат для всех сотрудников Авито Доставки';
const documentTitle = 'Учебный отчёт';
const fileName = 'report.txt';
const fileHref = 'data:text/plain;base64,dGVzdA==';
const report: MaterialInput = {
  group: 'Документы',
  title: documentTitle,
  description: 'Пример для стажёра.',
  audience: ['olga'],
  source: { kind: 'file', name: fileName, href: fileHref },
};

let root: Root;
let client: QueryClient;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  storage.clear();
  writeStorage.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: writeStorage,
    removeItem: (key: string) => storage.delete(key),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(profile: AccountId, path: string) {
  localStorage.setItem(demoSessionKey, profile);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter key={profile} initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

function button(name: string, scope: ParentNode = container) {
  return [...scope.querySelectorAll('button')].find(
    (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name,
  );
}

async function click(target: HTMLElement | null | undefined) {
  expect(target).toBeTruthy();
  await act(async () => target?.click());
}

function picker() {
  const dialog = container.querySelector<HTMLDialogElement>('dialog[open]');
  if (!dialog) throw new Error('Панель выбора материалов закрыта');
  return dialog;
}

function currentTaskButton() {
  return [...container.querySelectorAll<HTMLButtonElement>('.task-link')].find(
    (candidate) => candidate.querySelector('strong')?.textContent === task.title,
  );
}

async function openStaffTask() {
  await click(container.querySelector('.staff-intern'));
  await click(currentTaskButton());
}

async function openInternTask() {
  await mount('olga', '/onboarding');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(currentTaskButton()).toBeTruthy();
  });
  await click(currentTaskButton());
}

async function search(value: string) {
  const input = picker().querySelector('input[type="search"]');
  if (!input) throw new Error('Поле поиска материалов не найдено');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it.each(['mentor', 'manager'] as const)(
  'selects materials from several groups as %s and shows them to the intern',
  async (staff) => {
    saveMaterial(localStorage, 'mentor', report);
    saveMaterial(localStorage, 'travel-mentor', { ...report, title: 'Отчёт другой команды', audience: ['sasha'] });
    await mount(staff, '/staff');
    await openStaffTask();
    expect(container.textContent).not.toContain(documentTitle);
    await click(button('Добавить материалы'));

    expect(picker().querySelector('[aria-label="Группы материалов"]')?.textContent).toContain('Документы');
    expect(picker().textContent).not.toContain(documentTitle);
    expect(button('Сохранить материалы', picker())?.disabled).toBe(true);

    await click(button('Чаты · 1', picker()));
    await click(button('Добавить ' + chat, picker()));
    expect(picker().textContent).not.toContain(documentTitle);
    await click(button('Все группы', picker()));
    await click(button('Документы · 1', picker()));
    expect(button('Добавить ' + documentTitle, picker())).toBeTruthy();
    expect(picker().textContent).not.toContain(chat);

    await search('ДРУГОЙ КОМАНДЫ');
    expect(picker().textContent).toContain('Материалы не найдены.');
    await search('  УЧЕБНЫЙ  ');
    await click(button('Добавить ' + documentTitle, picker()));
    await search('для всех сотрудников');
    expect(button('Убрать ' + chat, picker())).toBeTruthy();

    await click(button('Выбрано (2)', picker()));
    const selection = picker().querySelector('[aria-label="Выбранные материалы"]');
    expect(selection?.textContent).toContain(documentTitle);
    expect(selection?.textContent).toContain(chat);
    expect(materialsForTask(localStorage, 'olga', task.id)).toEqual([]);
    await click(button('Сохранить материалы', picker()));

    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Материалы пункта сохранены.');
    expect(button('Изменить материалы')).toBeTruthy();

    await openInternTask();
    const attached = container.querySelector('.task-materials');
    expect(attached?.querySelector('h3')?.textContent).toBe('Материалы к заданию');
    expect(attached?.querySelectorAll('.task-material')).toHaveLength(2);
    expect(attached?.textContent).toContain(report.description);
    expect(attached?.textContent).toContain('Документы · Анна Ким');
    const link = attached?.querySelector('a[target="_blank"]');
    expect(link?.textContent?.trim()).toBe('Открыть ссылку');
    expect(link?.getAttribute('href')).toBe('https://chat.delivery.example/all');
    const file = attached?.querySelector('a[download]');
    expect(file?.textContent?.trim()).toBe('Скачать файл');
    expect(file?.getAttribute('download')).toBe(fileName);
    expect(file?.getAttribute('href')).toBe(fileHref);
  },
);

it('discards unsaved changes on cancel and Escape, then saves removal of the last attachment', async () => {
  setTaskMaterials(localStorage, 'mentor', task.id, ['baseline-delivery-chat']);
  await mount('mentor', '/staff');
  await openStaffTask();
  expect(container.querySelector('.checklist-materials')?.textContent).toContain(chat);

  for (const close of [
    () => click(button('Отмена', picker())),
    () => act(async () => picker().dispatchEvent(new Event('cancel', { cancelable: true }))),
  ]) {
    await click(button('Изменить материалы'));
    await click(button('Выбрано (1)', picker()));
    await click(button('Убрать ' + chat, picker()));
    expect(picker().textContent).toContain('Материалы пока не выбраны.');
    await close();
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('.checklist-materials')?.textContent).toContain(chat);
  }

  await click(button('Изменить материалы'));
  await click(button('Выбрано (1)', picker()));
  await click(button('Убрать ' + chat, picker()));
  await click(button('Сохранить материалы', picker()));
  expect(button('Добавить материалы')).toBeTruthy();
  expect(materialsForTask(localStorage, 'olga', task.id)).toEqual([]);
  await openInternTask();
  expect(container.querySelector('dialog[open]')).toBeTruthy();
  expect(container.querySelector('.task-materials')).toBeNull();
});

it('keeps the draft available when writing the new selection fails', async () => {
  await mount('mentor', '/staff');
  await openStaffTask();
  await click(button('Добавить материалы'));
  await click(button('Чаты · 1', picker()));
  await click(button('Добавить ' + chat, picker()));
  writeStorage.mockImplementationOnce(() => {
    throw new Error('Хранилище недоступно.');
  });

  await click(button('Сохранить материалы', picker()));
  expect(picker().querySelector('[role="alert"]')?.textContent).toBe('Хранилище недоступно.');
  expect(button('Выбрано (1)', picker())).toBeTruthy();
  expect(materialsForTask(localStorage, 'olga', task.id)).toEqual([]);
  await click(button('Сохранить материалы', picker()));
  expect(container.querySelector('dialog')).toBeNull();
  expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual([chat]);
});

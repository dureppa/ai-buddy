// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { demoSessionKey } from './demo-session';
import {
  checklistEditsKey,
  materialsForTask,
  publishedForIntern,
  saveMaterial,
  setTaskMaterials,
  type MaterialInput,
} from './staff-data';
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
  vi.useRealTimers();
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

function expectSuccessToast(message: string) {
  const toast = container.querySelector('.toast--top-right[role="status"]');
  expect(toast?.textContent).toBe(message);
  expect(toast?.parentElement).toBe(container.querySelector('.staff-workspace'));
}

function dialog() {
  const dialog = container.querySelector<HTMLDialogElement>('dialog[open]');
  if (!dialog) throw new Error('Диалог закрыт');
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

async function openInternAdaptation() {
  await mount('olga', '/onboarding');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(currentTaskButton()).toBeTruthy();
  });
}

async function openInternTask() {
  await openInternAdaptation();
  await click(currentTaskButton());
}

function catalog() {
  const panel = container.querySelector<HTMLElement>('.material-picker');
  if (!panel) throw new Error('Каталог материалов закрыт');
  return panel;
}

async function chooseGroup(group: string) {
  const select = catalog().querySelector('select')!;
  await act(async () => {
    select.value = group;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function search(value: string) {
  const input = catalog().querySelector('input[type="search"]');
  if (!input) throw new Error('Поле поиска материалов не найдено');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it.each(['mentor', 'manager'] as const)(
  'keeps the material form and its fields when file selection is cancelled as %s',
  async (staff) => {
    await mount(staff, '/staff');
    await click(button('Материалы для стажёров'));
    await click(button('Добавить материал'));
    const formDialog = dialog();
    const title = formDialog.querySelector<HTMLInputElement>('input[name="title"]')!;
    const description = formDialog.querySelector<HTMLTextAreaElement>('textarea[name="description"]')!;
    title.value = 'Материалы первой недели';
    description.value = 'Памятка для стажёра';
    const source = formDialog.querySelectorAll('select')[1];
    await act(async () => {
      source.value = 'file';
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const input = formDialog.querySelector<HTMLInputElement>('input[type="file"]')!;

    await act(async () => input.dispatchEvent(new Event('cancel', { bubbles: true })));
    expect(dialog()).toBe(formDialog);
    expect(title.value).toBe('Материалы первой недели');
    expect(description.value).toBe('Памятка для стажёра');
    expect(input.files?.length).toBe(0);
    expect(publishedForIntern(localStorage, 'olga')).toHaveLength(0);

    const files = [new File(['Памятка'], 'guide.txt', { type: 'text/plain' })];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => input.dispatchEvent(new Event('cancel', { bubbles: true })));
    expect(dialog()).toBe(formDialog);
    expect(input.files?.[0]).toBe(files[0]);
    expect(title.value).toBe('Материалы первой недели');

    // Escape while the dialog itself is active must still dismiss it.
    await act(async () => formDialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(container.querySelector('dialog[open]')).toBeNull();
    await click(button('Добавить материал'));
    await click(button('Закрыть', dialog()));
    expect(container.querySelector('dialog[open]')).toBeNull();
  },
);

it.each(['mentor', 'manager'] as const)(
  'attaches materials immediately from groups and search as %s and shows them to the intern',
  async (staff) => {
    saveMaterial(localStorage, 'mentor', report);
    saveMaterial(localStorage, 'travel-mentor', { ...report, title: 'Отчёт другой команды', audience: ['sasha'] });
    await mount(staff, '/staff');
    await openStaffTask();
    expect(container.textContent).not.toContain(documentTitle);
    await click(button('Прикрепить материал'));
    expect(button('Свернуть каталог')?.getAttribute('aria-controls')).toBe(catalog().id);
    expect(container.querySelector('[aria-label="Материалы пункта"]')?.contains(catalog())).toBe(true);
    expect(container.querySelector('dialog')).toBeNull();
    expect(button('Прикрепить ' + documentTitle, catalog())).toBeUndefined();

    await chooseGroup('Чаты');
    await click(button('Прикрепить ' + chat, catalog()));
    expectSuccessToast('Материал прикреплён.');
    expect(catalog().textContent).toContain('Прикреплён');
    expect(catalog().textContent).not.toContain(documentTitle);
    expect(button('Прикрепить ' + chat, catalog())).toBeUndefined();
    expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual([chat]);

    await search('ДРУГОЙ КОМАНДЫ');
    expect(catalog().textContent).toContain('Материалы не найдены.');
    await search('  УЧЕБНЫЙ  ');
    await click(button('Прикрепить ' + documentTitle, catalog()));
    expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual([chat, documentTitle]);
    expect(container.querySelector('[aria-label="Прикреплённые материалы"]')?.textContent).toContain(documentTitle);

    await chooseGroup('Документы');
    expect(catalog().textContent).not.toContain(chat);
    expect(catalog().textContent).toContain(documentTitle);
    expect(catalog().textContent).toContain('Прикреплён');
    await click(button('Свернуть каталог'));
    expect(container.querySelector('.material-picker')).toBeNull();
    expect(button('Открепить ' + documentTitle)).toBeTruthy();

    await openInternTask();
    const attached = container.querySelector('.task-materials');
    expect(attached?.querySelector('h3')?.textContent).toBe('Материалы к заданию');
    expect(attached?.querySelectorAll('.task-material')).toHaveLength(2);
    expect(attached?.textContent).toContain(report.description);
    expect(attached?.textContent).toContain('Документы · Анна Ким');
    const link = attached?.querySelector('a[target="_blank"]');
    expect(link?.textContent?.trim()).toBe('Открыть ссылку');
    expect(link?.getAttribute('href')).toBe('https://chat.example/delivery/all');
    const file = attached?.querySelector('a[download]');
    expect(file?.textContent?.trim()).toBe('Скачать файл');
    expect(file?.getAttribute('download')).toBe(fileName);
    expect(file?.getAttribute('href')).toBe(fileHref);
  },
);

it('detaches the last attachment directly and makes it possible to add again', async () => {
  setTaskMaterials(localStorage, 'mentor', task.id, ['baseline-delivery-chat']);
  await mount('mentor', '/staff');
  await openStaffTask();
  await click(button('Прикрепить материал'));
  await chooseGroup('Чаты');
  expect(catalog().textContent).toContain('Прикреплён');

  await click(button('Открепить ' + chat));
  expectSuccessToast('Материал откреплён.');
  expect(container.textContent).toContain('К этому пункту пока не прикреплены материалы.');
  expect(button('Прикрепить ' + chat, catalog())).toBeTruthy();
  expect(materialsForTask(localStorage, 'olga', task.id)).toEqual([]);
  await openInternTask();
  expect(container.querySelector('dialog[open]')).toBeTruthy();
  expect(container.querySelector('.task-materials')).toBeNull();
});

it.each(['Прикрепить', 'Открепить'] as const)(
  'keeps the saved state and can retry %s after a write fails',
  async (action) => {
    const attaching = action === 'Прикрепить';
    if (!attaching) setTaskMaterials(localStorage, 'mentor', task.id, ['baseline-delivery-chat']);
    await mount('mentor', '/staff');
    await openStaffTask();
    if (attaching) {
      await click(button('Прикрепить материал'));
      await chooseGroup('Чаты');
    }
    writeStorage.mockImplementationOnce(() => {
      throw new Error('Хранилище недоступно.');
    });

    await click(button(action + ' ' + chat));
    const scope = attaching ? catalog() : container.querySelector('[aria-label="Материалы пункта"]');
    expect(scope?.querySelector('[role="alert"]')?.textContent).toBe('Хранилище недоступно.');
    expect(container.querySelector('.toast')).toBeNull();
    expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual(attaching ? [] : [chat]);

    await click(button(action + ' ' + chat));
    expect(scope?.querySelector('[role="alert"]')).toBeNull();
    expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual(attaching ? [chat] : []);
    expectSuccessToast(attaching ? 'Материал прикреплён.' : 'Материал откреплён.');
  },
);

it('preserves a recent attachment from another tab and refreshes on checklist storage events', async () => {
  saveMaterial(localStorage, 'mentor', report);
  const [saved] = publishedForIntern(localStorage, 'olga');
  await mount('mentor', '/staff');
  await openStaffTask();
  await click(button('Прикрепить материал'));
  await chooseGroup('Чаты');

  setTaskMaterials(localStorage, 'manager', task.id, [saved.id]);
  await click(button('Прикрепить ' + chat, catalog()));
  expect(materialsForTask(localStorage, 'olga', task.id).map(({ title }) => title)).toEqual([documentTitle, chat]);

  setTaskMaterials(localStorage, 'manager', task.id, [saved.id]);
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: checklistEditsKey })));
  expect(button('Открепить ' + chat)).toBeUndefined();
  expect(button('Прикрепить ' + chat, catalog())).toBeTruthy();
});

it('renders team materials after both the checklist and progress, including when filtered', async () => {
  await openInternAdaptation();
  const tasks = container.querySelector('.adaptation-layout');
  const materials = container.querySelector('.intern-materials');
  expect(tasks?.nextElementSibling).toBe(materials);
  expect(materials?.textContent).toContain(chat);
  await click(button('Осталось'));
  expect(button('Осталось')?.getAttribute('aria-pressed')).toBe('true');
  expect(tasks?.nextElementSibling).toBe(materials);
  expect(materials?.textContent).toContain(chat);
});

it('shows checklist confirmations across navigation and expires the newest toast', async () => {
  await mount('mentor', '/staff');
  await click(container.querySelector('.staff-intern'));
  vi.useFakeTimers();
  await click(button('Добавить пункт'));

  const form = dialog().querySelector('form')!;
  form.querySelector<HTMLInputElement>('input[name="title"]')!.value = 'Проверить отчёт';
  form.querySelector<HTMLTextAreaElement>('textarea[name="summary"]')!.value = 'Учебное задание';
  await click(button('Добавить в чек-лист', form));
  expectSuccessToast('Пункт добавлен в чек-лист.');
  await act(async () => vi.advanceTimersByTimeAsync(2500));

  await click(
    [...container.querySelectorAll<HTMLButtonElement>('.task-link')].find(
      (candidate) => candidate.querySelector('strong')?.textContent === 'Проверить отчёт',
    ),
  );
  expectSuccessToast('Пункт добавлен в чек-лист.');
  await click(button('Удалить пункт'));
  expectSuccessToast('Пункт удалён.');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expectSuccessToast('Пункт удалён.');
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(container.querySelector('.toast')).toBeNull();
});

it('shows publication, edit and removal confirmations in the same corner', async () => {
  await mount('manager', '/staff');
  await click(button('Материалы для стажёров'));
  await click(button('Добавить материал'));

  const form = dialog().querySelector('form')!;
  form.querySelector<HTMLInputElement>('input[name="title"]')!.value = 'Гайд по аналитике';
  form.querySelector<HTMLTextAreaElement>('textarea[name="description"]')!.value = 'Учебный материал';
  form.querySelector<HTMLInputElement>('input[name="url"]')!.value = 'https://example.com/guide';
  await click(button('Опубликовать материал', form));
  expectSuccessToast('Материал опубликован.');

  await click(button('Редактировать'));
  const edit = dialog().querySelector('form')!;
  edit.querySelector<HTMLInputElement>('input[name="title"]')!.value = 'Новый гайд по аналитике';
  await click(button('Сохранить изменения', edit));
  expectSuccessToast('Изменения сохранены.');

  await click(button('Удалить'));
  await click(button('Удалить публикацию', dialog()));
  expectSuccessToast('Материал удалён.');
});

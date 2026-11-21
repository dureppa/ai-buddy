// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JiraPage } from './page';
import { jiraClient } from './api';

vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), jiraClient: vi.fn() }));
const board = { id: 'board-a', name: 'First board', key: 'A', space_id: 'space-a', members: [], issues: [] };
const api = { spaces: vi.fn(), boards: vi.fn(), board: vi.fn(), save: vi.fn(), mine: vi.fn() };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/');
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  api.spaces.mockReset().mockResolvedValue([{ id: 'space-a', name: 'Space' }]);
  api.boards.mockReset().mockResolvedValue([board, { ...board, id: 'board-b', name: 'Second board' }]);
  api.board
    .mockReset()
    .mockImplementation(async (id: string) => ({ ...board, id, name: id === board.id ? board.name : 'Second board' }));
  api.save.mockReset().mockResolvedValue({ id: 'issue' });
  vi.mocked(jiraClient).mockReturnValue(api);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(profile: 'olga' | 'maria' = 'olga') {
  await act(async () =>
    root.render(
      <StrictMode>
        <JiraPage profile={profile} />
      </StrictMode>,
    ),
  );
}
async function text(value: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain(value);
    if (value === 'First board') expect(container.querySelector('h1')?.textContent).toBe(value);
  });
}
async function click(value: string) {
  const button = await vi.waitFor(async () => {
    await act(async () => {});
    const node = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(value));
    if (!node || node.disabled) throw new Error('Button unavailable: ' + value);
    return node;
  });
  await act(async () => button.click());
}
async function create() {
  await text('First board');
  await click('Создать задачу');
  const input = container.querySelector('dialog input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'New task');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('loads the initial catalog once under StrictMode and only fetches a board on navigation', async () => {
  await mount();
  await text('First board');
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(1);
  expect(api.board).toHaveBeenCalledTimes(1);
  expect(window.location.search).toContain('board=board-a');
  await click('Second board');
  await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Second board'));
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(1);
  expect(api.board).toHaveBeenCalledTimes(2);
  await click('First board');
  await text('First board');
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(1);
  expect(api.board).toHaveBeenCalledTimes(3);
});
it('confirms a saved task before a slow board refresh and never repeats the write after a read failure', async () => {
  await mount();
  await text('First board');
  let reject!: (reason: Error) => void;
  api.board.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await create();
  await text('Задача сохранена.');
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('h1')?.textContent).toBe('First board');
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(1);
  expect(api.board).toHaveBeenCalledTimes(2);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save).toHaveBeenCalledWith('board-a', expect.objectContaining({ title: 'New task' }), undefined);
  await act(async () => reject(new Error('Read failed')));
  await text('Read failed');
  expect(container.textContent).toContain('Задача сохранена.');
  await click('Повторить');
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeNull());
  expect(api.save).toHaveBeenCalledTimes(1);
});
it('keeps the editor on write failure without automatic retry', async () => {
  api.save.mockRejectedValue(new Error('Версия изменена'));
  await mount();
  await create();
  await text('Версия изменена');
  expect(container.querySelector('dialog')).not.toBeNull();
  expect(container.querySelector<HTMLInputElement>('dialog input')?.value).toBe('New task');
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.board).toHaveBeenCalledTimes(1);
});
it.each(['spaces', 'boards'] as const)('finishes loading an empty %s catalog', async (kind) => {
  api[kind].mockResolvedValue([]);
  await mount();
  await text('Пока нет доступных досок');
  expect(container.textContent).not.toContain('Загружаем');
  expect(api.board).not.toHaveBeenCalled();
});
it('rejects a board outside the selected space', async () => {
  api.board.mockResolvedValue({ ...board, space_id: 'foreign' });
  await mount();
  await text('Доска не относится');
  expect(container.querySelector('.jira-kanban')).toBeNull();
});
it('isolates a new profile from an open editor and previous board', async () => {
  await mount();
  await text('First board');
  await click('Создать задачу');
  api.spaces.mockResolvedValue([]);
  await mount('maria');
  await text('Пока нет доступных досок');
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('.jira-kanban')).toBeNull();
  expect(jiraClient).toHaveBeenLastCalledWith('maria');
});
it('ignores a late response after unmounting a profile', async () => {
  let resolve!: (value: typeof board) => void;
  api.board.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  await vi.waitFor(() => expect(api.board).toHaveBeenCalledTimes(1));
  api.spaces.mockResolvedValue([]);
  await mount('maria');
  await act(async () => resolve(board));
  await text('Пока нет доступных досок');
  expect(container.querySelector('.jira-kanban')).toBeNull();
});
it('loads a linked board once and reports a missing linked issue', async () => {
  window.history.replaceState(null, '', '/?space=space-a&board=board-b&issue=missing');
  await mount();
  await text('Задача не найдена на доске.');
  expect(api.board).toHaveBeenCalledExactlyOnceWith('board-b');
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(1);
});
it('fetches the new space catalog once and selects its first board', async () => {
  api.spaces.mockResolvedValue([
    { id: 'space-a', name: 'Space A' },
    { id: 'space-b', name: 'Space B' },
  ]);
  await mount();
  await text('First board');
  api.boards.mockResolvedValue([{ ...board, id: 'board-c', space_id: 'space-b' }]);
  api.board.mockResolvedValue({ ...board, id: 'board-c', space_id: 'space-b', name: 'Third board' });
  const select = container.querySelector('select')!;
  await act(async () => {
    select.value = 'space-b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await text('Third board');
  expect(api.spaces).toHaveBeenCalledTimes(1);
  expect(api.boards).toHaveBeenCalledTimes(2);
  expect(api.boards).toHaveBeenLastCalledWith('space-b');
  expect(api.board).toHaveBeenCalledTimes(2);
  expect(api.board).toHaveBeenLastCalledWith('board-c');
});

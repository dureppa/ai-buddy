// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { currentChecklistTask, chatPageContext, isTaskCompletionMessage } from './current-task';
import { readWorkspace } from './demo';
import { checklistFor, addChecklistItem } from './staff-data';
import { demoSessionKey } from './demo-session';
import type { ProfileId } from './demo-accounts';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/chat?private=x#fragment');
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

it.each(['olga', 'sasha', 'timur', 'maria'] as ProfileId[])(
  'uses the exact first unfinished role task for %s',
  (profile) => {
    const tasks = checklistFor(localStorage, profile);
    const workspace = readWorkspace(localStorage, profile);
    const expected = tasks.find((task) => !workspace.completed.includes(task.id));
    expect(currentChecklistTask(tasks, workspace.completed)).toEqual(expected);
    const context = chatPageContext(profile, workspace);
    expect(context.url).not.toMatch(/[?#]/);
    expect(context.selection).toBeUndefined();
    expect(context.checklist).toEqual(
      expected
        ? { status: 'in_progress', task: expect.objectContaining({ id: expected.id, label: expected.title }) }
        : { status: 'completed' },
    );
  },
);

it('advances after completion and handles an entirely finished or empty plan', () => {
  const tasks = checklistFor(localStorage, 'olga');
  const workspace = readWorkspace(localStorage, 'olga');
  const first = currentChecklistTask(tasks, workspace.completed)!;
  const updated = { ...workspace, completed: [...workspace.completed, first.id] };
  expect(chatPageContext('olga', updated).checklist).not.toMatchObject({ task: { id: first.id } });
  expect(chatPageContext('olga', { ...workspace, completed: tasks.map((task) => task.id) }).checklist).toEqual({
    status: 'completed',
  });
  expect(currentChecklistTask([], [])).toBeUndefined();
});

it('keeps an explicitly selected task separate from the current in-progress task', () => {
  const workspace = readWorkspace(localStorage, 'olga');
  const task = checklistFor(localStorage, 'olga')[0];
  const selection = {
    text: task.title,
    title: 'Выбранный пункт',
    resource: { kind: 'task' as const, id: task.id, label: task.title },
  };
  const context = chatPageContext('olga', workspace, { url: 'http://localhost/onboarding', selection });
  expect(context.selection).toEqual(selection);
  expect(context.checklist).toMatchObject({ status: 'in_progress' });
});

it('uses mentor-added tasks once the preceding tasks are complete', () => {
  localStorage.setItem(demoSessionKey, 'mentor');
  addChecklistItem(localStorage, 'mentor', {
    title: 'Новый пункт',
    summary: 'Разбор',
    stage: 'week-1',
  });
  const tasks = checklistFor(localStorage, 'olga');
  const extra = tasks.find((task) => task.custom)!;
  const workspace = readWorkspace(localStorage, 'olga');
  expect(
    chatPageContext('olga', { ...workspace, completed: tasks.filter((task) => !task.custom).map((task) => task.id) })
      .checklist,
  ).toMatchObject({ status: 'in_progress', task: { id: extra.id, label: extra.title } });
});

it('does not report completion when the survey state is unavailable', () => {
  expect(chatPageContext('olga', readWorkspace(localStorage, 'olga'), undefined, false).checklist).toEqual({
    status: 'unavailable',
  });
});

it.each(['ознакомился', 'Я уже ознакомилась!', 'прочитал.', 'готово', 'Отметь задачу выполненной', 'задача выполнена'])(
  'recognizes explicit task completion: %s',
  (text) => {
    expect(isTaskCompletionMessage(text)).toBe(true);
  },
);
it.each([
  'не ознакомился',
  'готово?',
  'как отметить выполненной?',
  'прочитал, но не понял',
  'ознакомился с другой задачей',
  '',
])('does not treat a question, denial or unrelated report as confirmation: %s', (text) => {
  expect(isTaskCompletionMessage(text)).toBe(false);
});

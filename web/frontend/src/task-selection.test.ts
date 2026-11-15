// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { taskSelectionResource } from './task-selection';
import { tasksFor } from './checklist';
const mocks = vi.hoisted(() => ({ materials: [] as { source: { kind: string; href: string } }[] }));
vi.mock('./staff-data', () => ({ materialsForTask: () => mocks.materials }));
beforeEach(() => {
  mocks.materials = [];
});
it('keeps the selected local task and does not invent attachments', () => {
  const task = tasksFor('olga')[0];
  expect(taskSelectionResource('olga', task)).toEqual({
    kind: 'task',
    id: task.id,
    label: task.title,
    description: [...task.details].slice(0, 800).join(''),
  });
});
it('uses up to three distinct attached Confluence page ids, ignoring other hosts and files', () => {
  mocks.materials = [
    { source: { kind: 'file', href: 'data:text/plain;base64,eA==' } },
    { source: { kind: 'link', href: 'https://other.example/?page=secret' } },
    { source: { kind: 'link', href: 'not a URL' } },
    ...['first', 'first', 'second', 'third', 'fourth'].map((id) => ({
      source: { kind: 'link', href: 'http://localhost:5191/?page=' + id },
    })),
  ];
  const value = taskSelectionResource('olga', tasksFor('olga')[0]);
  expect('page_ids' in value && value.page_ids).toEqual(['first', 'second', 'third']);
});
it('does not treat unrelated routes or malformed ids as Confluence pages', () => {
  mocks.materials = [
    { source: { kind: 'link', href: 'http://localhost:5191/private?page=first' } },
    { source: { kind: 'link', href: 'http://localhost:5191/?page=bad%20id' } },
  ];
  expect(taskSelectionResource('olga', tasksFor('olga')[0])).not.toHaveProperty('page_ids');
});

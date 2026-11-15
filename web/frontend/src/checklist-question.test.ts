// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { checklistQuestion } from './checklist-question';
import { tasksFor } from './checklist';
import { selectionResourceSchema } from './selection-context';
it('includes the selected role-specific task and sanitizes the source URL', () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  window.history.replaceState(null, '', '/onboarding?token=secret#task');
  for (const profile of ['olga', 'sasha', 'timur', 'maria'] as const) {
    const task = tasksFor(profile)[0];
    const value = checklistQuestion(profile, task);
    expect(value.text).toContain(task.title);
    expect(value.text).toContain(task.owner);
    expect(value.context.url).not.toMatch(/[?#]/);
    expect(selectionResourceSchema.parse(value.context.selection.resource)).toMatchObject({
      id: task.id,
      kind: 'task',
    });
  }
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

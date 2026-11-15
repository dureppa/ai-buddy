import type { Task } from './checklist';
import type { ProfileId } from './demo-accounts';
import type { Workspace } from './demo';
import { checklistFor } from './staff-data';
import { taskSelectionResource } from './task-selection';
import type { ChatPageContext, ExplanationContext } from './selection-context';

export function currentChecklistTask<T extends Task>(tasks: readonly T[], completed: readonly string[]): T | undefined {
  return tasks.find((task) => !completed.includes(task.id));
}

export function chatPageContext(
  profile: ProfileId,
  workspace: Workspace,
  selected?: ExplanationContext,
  available = true,
): ChatPageContext {
  const task = currentChecklistTask(checklistFor(localStorage, profile), workspace.completed);
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return {
    url: url.toString(),
    ...(selected ? { selection: selected.selection } : {}),
    checklist: !available
      ? { status: 'unavailable' }
      : task
        ? { status: 'in_progress', task: taskSelectionResource(profile, task) }
        : { status: 'completed' },
  };
}

export function isTaskCompletionMessage(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[.!]+$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^я (?:уже )?/, '');
  return new Set([
    'ознакомился',
    'ознакомилась',
    'прочитал',
    'прочитала',
    'изучил',
    'изучила',
    'выполнил',
    'выполнила',
    'сделал',
    'сделала',
    'готово',
    'сделано',
    'выполнено',
    'задача выполнена',
    'задачу выполнил',
    'задачу выполнила',
    'пункт выполнен',
    'отметь выполненной',
    'отметь выполненным',
    'отметь задачу выполненной',
    'подтверждаю выполнение',
  ]).has(normalized);
}

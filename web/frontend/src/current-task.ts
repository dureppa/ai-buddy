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

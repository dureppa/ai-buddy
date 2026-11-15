import type { Task } from './checklist';
import type { ProfileId } from './demo-accounts';
import { materialsForTask } from './staff-data';
import { confluenceService } from './tool-links';
import type { SelectionResource } from './selection-context';

export function taskSelectionResource(profile: ProfileId, task: Task): Extract<SelectionResource, { kind: 'task' }> {
  const pages = new Set<string>();
  const known = new URL(confluenceService.url, window.location.origin);
  for (const material of materialsForTask(localStorage, profile, task.id)) {
    if (material.source.kind !== 'link') continue;
    try {
      const url = new URL(material.source.href);
      const page = url.searchParams.get('page');
      if (
        url.origin === known.origin &&
        url.pathname === known.pathname &&
        page &&
        /^[A-Za-z0-9_.:-]{1,128}$/.test(page)
      )
        pages.add(page);
    } catch {
      /* An attachment is not an instruction to fetch an arbitrary URL. */
    }
    if (pages.size === 3) break;
  }
  return {
    kind: 'task',
    id: task.id,
    label: task.title,
    description: [...task.details].slice(0, 800).join(''),
    ...(pages.size ? { page_ids: [...pages] } : {}),
  };
}

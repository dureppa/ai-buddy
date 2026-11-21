import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId } from './demo-accounts';

const path = '/api/v1/onboarding/role-checklist';
const marks = z.object({ completed: z.array(z.string()) });

export async function readRoleMarks(profile: ProfileId, legacy?: string[]) {
  const response = legacy
    ? await apiFetch(profile, path + '/import', { method: 'POST', body: JSON.stringify({ completed: legacy }) })
    : await apiFetch(profile, path);
  return marks.parse(await response.json()).completed;
}

export async function saveRoleMark(profile: ProfileId, id: string, done: boolean, currentOnly: boolean) {
  const response = await apiFetch(profile, path + '/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify({ done, current_only: currentOnly }),
  });
  return marks.parse(await response.json()).completed;
}

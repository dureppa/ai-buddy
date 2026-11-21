import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId, StaffId } from './demo-accounts';
import type { ChecklistItemInput } from './staff-data';

const path = '/api/v1/onboarding/role-checklist';
export const checklistPlan = z.object({
  profile_id: z.string(),
  completed: z.array(z.string()),
  extras: z.array(
    z.object({
      id: z.string(),
      stage: z.enum(['week-1', 'week-2', 'month-1', 'month-2', 'month-3', 'after-3']),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  total: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
});

export type ChecklistPlan = z.infer<typeof checklistPlan>;

export async function readRoleMarks(profile: ProfileId, legacy?: string[]) {
  const response = legacy
    ? await apiFetch(profile, path + '/import', { method: 'POST', body: JSON.stringify({ completed: legacy }) })
    : await apiFetch(profile, path);
  return checklistPlan.parse(await response.json());
}

export async function saveRoleMark(profile: ProfileId, id: string, done: boolean, currentOnly: boolean) {
  const response = await apiFetch(profile, path + '/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify({ done, current_only: currentOnly }),
  });
  return checklistPlan.parse(await response.json());
}

export async function readTeamPlans(staff: StaffId) {
  const response = await apiFetch(staff, path);
  return z.object({ plans: z.array(checklistPlan) }).parse(await response.json()).plans;
}

export async function changeTeamPlan(staff: StaffId, intern: ProfileId, change: ChecklistItemInput | string) {
  const scope = '?profile_id=' + encodeURIComponent(intern);
  const response =
    typeof change === 'string'
      ? await apiFetch(staff, path + '/' + encodeURIComponent(change) + scope, { method: 'DELETE' })
      : await apiFetch(staff, path + scope, { method: 'POST', body: JSON.stringify(change) });
  return checklistPlan.parse(await response.json());
}

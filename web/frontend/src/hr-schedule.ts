import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId } from './demo-accounts';

const request = z.object({ id: z.string(), status: z.string() });
const absence = z.object({
  earliest_vacation: z.iso.date(),
  vacation_notice_days: z.number(),
  vacation_left: z.number(),
  requests: z.array(request.extend({ start: z.iso.date(), end: z.iso.date(), days: z.number() })),
});
const travel = z.object({
  earliest_trip: z.iso.date(),
  travel_enabled: z.boolean(),
  travel_budget: z.number(),
  destinations: z.array(z.object({ id: z.string(), title: z.string(), estimate: z.number() })),
  requests: z.array(request.extend({ date: z.iso.date(), destination: z.string(), budget: z.number() })),
});
const paths = {
  absence: '/hr-api/v1/me/',
  travel: '/hr-api/v1/me/',
};

export async function readAbsences(profile: ProfileId, signal?: AbortSignal) {
  return absence.parse(await (await apiFetch(profile, paths.absence + 'absence-summary', { signal })).json());
}

export async function readTrips(profile: ProfileId, signal?: AbortSignal) {
  return travel.parse(await (await apiFetch(profile, paths.travel + 'travel-summary', { signal })).json());
}

export async function submitHrRequest(
  profile: ProfileId,
  action: { start: string; end: string } | { date: string; destination: string; budget: number },
) {
  const path = 'start' in action ? paths.absence + 'absence-requests' : paths.travel + 'trip-requests';
  await apiFetch(profile, path, { method: 'POST', body: JSON.stringify(action) });
}

export const hrStatus = (status: string) =>
  status === 'approved' ? 'Согласовано' : status === 'pending' ? 'На согласовании' : status;

export const hrTodaySchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      service: z.enum(['absences', 'trips']),
    }),
  ),
  unavailable: z.array(z.enum(['absences', 'trips'])),
});
export type HrToday = z.infer<typeof hrTodaySchema>;

export async function readHrToday(profile: ProfileId, signal?: AbortSignal) {
  return hrTodaySchema.parse(await (await apiFetch(profile, '/api/v1/schedule/hr-today', { signal })).json());
}

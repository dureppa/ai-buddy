import { beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from './backend';
import { hrStatus, readAbsences, readTrips, submitHrRequest } from './hr-schedule';

vi.mock('./backend', () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

it('validates the absence summary and forwards cancellation to the API', async () => {
  const signal = new AbortController().signal;
  const summary = {
    earliest_vacation: '2026-12-01',
    vacation_notice_days: 14,
    vacation_left: 12,
    requests: [{ id: 'leave-1', status: 'pending', start: '2026-12-02', end: '2026-12-04', days: 3 }],
  };
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(Response.json(summary))
    .mockResolvedValueOnce(Response.json({ ...summary, vacation_left: 'many' }));

  expect(await readAbsences('olga', signal)).toEqual(summary);
  expect(apiFetch).toHaveBeenCalledWith('olga', '/hr-api/v1/me/absence-summary', { signal });
  await expect(readAbsences('olga')).rejects.toThrow();
});

it('returns the trip policy and translates known application statuses', async () => {
  const policy = {
    earliest_trip: '2026-12-01',
    travel_enabled: true,
    travel_budget: 50000,
    destinations: [{ id: 'kazan', title: 'Казань', estimate: 18000 }],
    requests: [],
  };
  vi.mocked(apiFetch).mockResolvedValueOnce(Response.json(policy));
  expect(await readTrips('sasha')).toEqual(policy);
  expect(apiFetch).toHaveBeenCalledWith('sasha', '/hr-api/v1/me/travel-summary', { signal: undefined });
  expect(hrStatus('approved')).toBe('Согласовано');
  expect(hrStatus('pending')).toBe('На согласовании');
  expect(hrStatus('unknown')).toBe('unknown');
});

it.each([
  ['absence-requests', { start: '2026-12-01', end: '2026-12-03' }],
  ['trip-requests', { date: '2026-12-01', destination: 'kazan', budget: 18000 }],
] as const)('posts a request to the matching HR endpoint (%s)', async (endpoint, request) => {
  vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 201 }));
  await submitHrRequest('olga', request);
  expect(apiFetch).toHaveBeenCalledWith('olga', '/hr-api/v1/me/' + endpoint, {
    method: 'POST',
    body: JSON.stringify(request),
  });
});

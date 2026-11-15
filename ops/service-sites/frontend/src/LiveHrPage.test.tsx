// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../web/frontend/src/backend';
import { LiveHrPage } from './LiveHrPage';

vi.mock('../../../../web/frontend/src/backend', () => ({ apiFetch: vi.fn() }));

const fetchApi = vi.mocked(apiFetch);
const option = { id: 'demo', title: 'Из каталога сервера', description: 'Описание' };
let element: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchApi.mockReset();
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it('saves a referral and keeps form values after the API rejects it', async () => {
  fetchApi.mockResolvedValueOnce(
    Response.json({ referral_slots: 2, referral_left: 2, vacancies: [option], referrals: [] }),
  );
  await act(() => root.render(<LiveHrPage service="hiring" profileId="maria" />));
  const form = element.querySelector('form')!;
  form.querySelector<HTMLInputElement>('[name=name]')!.value = 'Кандидат';
  form.querySelector<HTMLInputElement>('[name=email]')!.value = 'person@example.com';

  fetchApi.mockRejectedValueOnce(new Error('rejected'));
  await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(element.querySelector('[role=alert]')).not.toBeNull();
  expect(new FormData(form).get('name')).toBe('Кандидат');

  fetchApi.mockResolvedValueOnce(new Response(null, { status: 201 })).mockResolvedValueOnce(
    Response.json({
      referral_slots: 2,
      referral_left: 1,
      vacancies: [option],
      referrals: [{ vacancy: option.id, name: 'Кандидат', email: 'person@example.com' }],
    }),
  );
  await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetchApi).toHaveBeenCalledWith('maria', '/hr-api/v1/me/referrals', {
    method: 'POST',
    body: JSON.stringify({ vacancy: option.id, name: 'Кандидат', email: 'person@example.com' }),
  });
  expect(element.querySelector('.hr-history')?.textContent).toContain('Кандидат');
  expect(new FormData(form).get('name')).toBe('');
});

it('stores offboarding checklist changes in the service', async () => {
  const summary = { exit_notice_days: 14, earliest_exit: '2026-12-01', checklist: [], steps: [option], draft: null };
  fetchApi.mockResolvedValueOnce(Response.json(summary));
  await act(() => root.render(<LiveHrPage service="offboarding" profileId="maria" />));
  const checkbox = element.querySelector<HTMLInputElement>('[type=checkbox]')!;
  expect(checkbox.checked).toBe(false);
  fetchApi
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ ...summary, checklist: [option.id] }));
  await act(() => checkbox.click());
  expect(fetchApi).toHaveBeenCalledWith('maria', '/hr-api/v1/me/offboarding/checklist/demo', {
    method: 'PUT',
    body: JSON.stringify({ checked: true }),
  });
  expect(checkbox.checked).toBe(true);
});

it('refreshes the compensation balance after submitting a request', async () => {
  const summary = {
    benefit_budget: 5000,
    benefit_left: 5000,
    options: [{ ...option, amount: 2000, available: true }],
    requests: [],
  };
  fetchApi.mockResolvedValueOnce(Response.json(summary));
  await act(() => root.render(<LiveHrPage service="benefits" profileId="maria" />));
  const button = element.querySelector('button')!;
  fetchApi.mockResolvedValueOnce(new Response(null, { status: 201 })).mockResolvedValueOnce(
    Response.json({
      ...summary,
      benefit_left: 3000,
      requests: [{ benefit: option.id, amount: 2000 }],
    }),
  );
  await act(() => button.click());
  expect(fetchApi).toHaveBeenCalledWith('maria', '/hr-api/v1/me/benefit-requests', {
    method: 'POST',
    body: JSON.stringify({ benefit: option.id }),
  });
  expect(button.disabled).toBe(true);
  expect(element.querySelector('.hr-metric__value')?.textContent?.replace(/\s/g, '')).toBe('3000₽');
});

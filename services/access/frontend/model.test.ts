import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { templates, recommendedTemplates } from './catalog';
import {
  accountContext,
  changeRequest,
  createRequest,
  readAccessAccount,
  parseInput,
  readRequests,
  saveRequests,
  storageKey,
  visibleRequests,
  type RequestInput,
} from './model';
import { AccessForm, RequestSummary } from './page';
const now = '2026-11-15T10:00:00.000Z';
const id = '2b8c77a4-2132-44be-976e-eb113fe3d099';
const input: RequestInput = {
  template_id: 'dwh',
  catalog_version: 1,
  system: 'DWH',
  resource_key: 'delivery.orders',
  justification: 'Изучить воронку оформления заказа',
  permission: 'read',
  duration_days: 30,
  fields: { usage: 'Исследование' },
};
it('recommends role-specific resources with shared tools', () => {
  for (const [role, resource] of [
    ['analyst', 'dwh'],
    ['backend', 'repository'],
    ['tester', 'test-data'],
    ['designer', 'figma'],
  ] as const) {
    const ids = recommendedTemplates(role).map((item) => item.id);
    expect(ids).toContain(resource);
    expect(ids).toContain('jira');
    expect(ids).toContain('vpn');
  }
  expect(recommendedTemplates('designer').map((item) => item.id)).not.toContain('dwh');
});
it('reads demo identity and distinguishes reviewers from mentors', () => {
  expect(readAccessAccount('other=1; ai_buddy_account=sasha')).toBe('sasha');
  expect(readAccessAccount('ai_buddy_account=manager')).toBe('manager');
  expect(readAccessAccount('ai_buddy_account=bad')).toBe(null);
  expect(readAccessAccount('')).toBe(null);
  expect(accountContext('olga').role).toBe('analyst');
  expect(accountContext('manager').canReview).toBe(true);
  expect(accountContext('mentor').canReview).toBe(false);
});
it('validates configured fields, levels, version and boundaries', () => {
  expect(parseInput(input)).toEqual(input);
  for (const raw of [
    { ...input, permission: 'write' },
    { ...input, duration_days: 0 },
    { ...input, duration_days: 91 },
    { ...input, justification: 'short' },
    { ...input, system: ' ' },
    { ...input, resource_key: ' ' },
    { ...input, fields: {} },
    { ...input, fields: { usage: 'unknown' } },
    { ...input, fields: { usage: 'Исследование', unknown: 'value' } },
    { ...input, catalog_version: 2 },
    { ...input, template_id: 'missing' },
    { ...input, profile_id: 'manager' },
  ])
    expect(() => parseInput(raw)).toThrow();
  const repository = { ...input, template_id: 'repository', fields: { repository_url: 'javascript:alert(1)' } };
  expect(() => parseInput(repository)).toThrow('HTTPS');
  expect(
    parseInput({ ...repository, fields: { repository_url: 'https://git.example/repo' } }).fields.repository_url,
  ).toContain('https:');
});
it('creates a scoped request, prevents duplicates and allows resubmission after rejection', () => {
  const requests = createRequest([], input, 'olga', id, now);
  expect(requests[0].product_id).toBe('delivery');
  expect(requests[0].status).toBe('submitted');
  expect(() =>
    createRequest(requests, { ...input, system: ' dwh ', resource_key: 'DELIVERY.ORDERS' }, 'olga', id, now),
  ).toThrow('уже существует');
  const rejected = changeRequest(requests, id, 'manager', 'rejected', 'Уточните витрину', now);
  expect(createRequest(rejected, input, 'olga', '86e2b6a2-cf72-4d68-bb60-6837cb41be7f', now)).toHaveLength(2);
});
it('restricts decisions to the own product manager and rejects stale actions', () => {
  const requests = createRequest([], input, 'olga', id, now);
  for (const actor of ['olga', 'mentor', 'travel-manager'] as const)
    expect(() => changeRequest(requests, id, actor, 'approved', '', now)).toThrow();
  expect(() => changeRequest(requests, id, 'manager', 'rejected', '', now)).toThrow('причину');
  const approved = changeRequest(requests, id, 'manager', 'approved', 'Согласовано', now);
  expect(approved[0].status).toBe('approved');
  expect(() => changeRequest(approved, id, 'manager', 'rejected', 'Причина', now)).toThrow('уже изменена');
  expect(() => changeRequest(requests, id, 'sasha', 'cancelled', '', now)).toThrow();
  expect(changeRequest(requests, id, 'olga', 'cancelled', '', now)[0].status).toBe('cancelled');
  expect(visibleRequests(requests, 'travel-manager')).toEqual([]);
  expect(visibleRequests(requests, 'manager')).toHaveLength(1);
  expect(visibleRequests(requests, 'sasha')).toEqual([]);
});
it('persists requests and reports corrupt or unavailable storage', () => {
  let saved: string | null = null;
  const storage = {
    getItem: () => saved,
    setItem: (key: string, value: string) => {
      expect(key).toBe(storageKey);
      saved = value;
    },
  };
  expect(readRequests(storage)).toEqual([]);
  const requests = createRequest([], input, 'olga', id, now);
  saveRequests(storage, requests);
  expect(readRequests(storage)).toEqual(requests);
  saved = '';
  expect(() => readRequests(storage)).toThrow('не перезаписаны');
  saved = 'invalid';
  expect(() => readRequests(storage)).toThrow('не перезаписаны');
  expect(() =>
    saveRequests(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      requests,
    ),
  ).toThrow('quota');
});
it('renders flexible fields and a complete summary without claiming granted rights', () => {
  const template = templates.find((item) => item.id === 'environments')!;
  const html = renderToStaticMarkup(createElement(AccessForm, { template, onClose: () => {}, onSubmit: () => {} }));
  expect(html).toContain('Namespace / проект');
  expect(html).toContain('Администрирование');
  expect(html).toContain('Обоснование доступа');
  const summary = renderToStaticMarkup(createElement(RequestSummary, { input }));
  expect(summary).toContain('delivery.orders');
  expect(summary).toContain('Исследование');
  expect(summary).toContain('30 дней');
});

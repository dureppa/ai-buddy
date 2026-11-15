import { afterEach, expect, it, vi } from 'vitest';
import { filterIssues, issueSchema, jiraClient } from './api';
const issue = issueSchema.parse({
  id: '3cf6b43f-2d93-4a9d-8548-7433ebd067ac',
  board_id: 'help-team',
  space_id: 'help',
  key: 'HELP-1',
  title: 'Макет',
  description: '',
  status: 'todo',
  priority: 'medium',
  assignee_id: 'maria',
  reporter_id: 'help-mentor',
  due_date: null,
  version: 1,
  created_at: '',
  updated_at: '',
});
afterEach(() => vi.unstubAllGlobals());
it('filters by key, title and current assignee', () => {
  const issues = [issue, { ...issue, id: 'other', assignee_id: 'other' }];
  expect(filterIssues(issues, ' help-1 ', true, 'maria')).toEqual([issue]);
  expect(filterIssues(issues, 'МАКЕТ', false, 'maria')).toHaveLength(2);
  expect(filterIssues(issues, 'missing', false, 'maria')).toEqual([]);
  expect(filterIssues([], '', true, 'maria')).toEqual([]);
});
it('authenticates once and uses the token for requests', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'maria', name: 'Мария' }))
    .mockImplementation(async () => Response.json([]));
  vi.stubGlobal('fetch', fetcher);
  const api = jiraClient('maria');
  await api.spaces();
  await api.mine();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[0][1].body).toBe('{"profile_id":"maria"}');
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer token');
});
it('rejects a mismatched session and allows login retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'sasha', name: 'Саша' }))
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'maria', name: 'Мария' }))
    .mockResolvedValueOnce(Response.json([]));
  vi.stubGlobal('fetch', fetcher);
  const api = jiraClient('maria');
  await expect(api.spaces()).rejects.toThrow('Профиль');
  await expect(api.spaces()).resolves.toEqual([]);
});
it('reports conflicts and validates API payloads', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'maria', name: 'Мария' }))
    .mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(Response.json({ invalid: true }));
  vi.stubGlobal('fetch', fetcher);
  const api = jiraClient('maria');
  await expect(api.save('help-team', issue, issue.id)).rejects.toThrow('уже изменена');
  await expect(api.spaces()).rejects.toThrow();
});
it('renders new and existing task fields', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IssueEditor } = await import('./page');
  const { createElement } = await import('react');
  const html = renderToStaticMarkup(
    createElement(IssueEditor, {
      issue,
      members: [{ id: 'maria', name: 'Мария' }],
      onClose: () => {},
      onSave: async () => {},
    }),
  );
  expect(html).toContain('HELP-1');
  expect(html).toContain('Макет');
  expect(html).toContain('Мария');
  const fresh = renderToStaticMarkup(
    createElement(IssueEditor, { issue: 'new', members: [], onClose: () => {}, onSave: async () => {} }),
  );
  expect(fresh).toContain('Новая задача');
});

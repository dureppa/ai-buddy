import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { knowledgeClient, pageSchema, sections } from './api';
import { KnowledgeArticle } from './page';
afterEach(() => vi.unstubAllGlobals());
it('renders structured text safely without interpreting source HTML', () => {
  const page = pageSchema.parse({
    id: 'guide-access',
    product_id: null,
    parent_id: null,
    kind: 'guide',
    title: 'Доступы',
    body: 'Введение\n\n## Чтение\n<script>alert(1)</script>',
    version: 1,
    updated_at: '2026-11-15T10:00:00Z',
  });
  expect(sections(page.body)).toHaveLength(2);
  const html = renderToStaticMarkup(createElement(KnowledgeArticle, { page }));
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Чтение');
});
it('validates server page payloads and preserves scoped endpoints', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'knowledge-token', profile_id: 'timur' }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json({ wrong: true }));
  vi.stubGlobal('fetch', fetcher);
  const api = knowledgeClient('timur');
  expect(await api.list('доступы')).toEqual([]);
  expect(fetcher.mock.calls[1][0]).toContain('/api/v1/confluence/pages?query=');
  await expect(api.read('team-autoteca')).rejects.toThrow();
  expect(fetcher.mock.calls[2][0]).toContain('team-autoteca');
});

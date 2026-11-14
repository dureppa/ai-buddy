import { afterEach, expect, it, vi } from 'vitest';
import { accessClient, portalFetch } from './api';
const input = {
  template_id: 'dwh',
  catalog_version: 1 as const,
  system: 'DWH',
  resource_key: 'delivery.orders_mart',
  justification: 'Исследовать воронку заказа',
  permission: 'read' as const,
  duration_days: 30,
  fields: { usage: 'Исследование' },
};
afterEach(() => vi.unstubAllGlobals());
it('submits the form through the server with a stable operation key', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'portal-token', profile_id: 'olga' }))
    .mockResolvedValueOnce(
      Response.json({
        id: '0e1bc47b-1e0b-43c6-9d09-e9173a8d933d',
        number: 'ДОС-000001',
        profile_id: 'olga',
        product_id: 'delivery',
        input,
        status: 'submitted',
        created_at: '2026-11-15T10:00:00Z',
        decision_by: null,
        decision_note: '',
        decided_at: null,
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const client = accessClient('olga');
  const result = await client.submit(input, 'operation-1');
  expect(result.number).toBe('ДОС-000001');
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/portal-access/requests');
  expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe('operation-1');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty('profile_id');
});
it('rejects a wrong session owner and does not invent local requests on failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'maria' }))
    .mockResolvedValueOnce(Response.json({ access_token: 'token', profile_id: 'sasha' }))
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(accessClient('sasha').list()).rejects.toThrow('не совпадает');
  await expect(portalFetch('sasha', '/api/v1/portal-access/catalog')).rejects.toThrow('не разрешён');
});

import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ServiceActionCard } from './ServiceActionPage';
import {
  actionMessage,
  decideServiceAction,
  readServiceAction,
  serviceActionSchema,
  type ServiceAction,
} from './service-actions';

const id = '11111111-1111-4111-8111-111111111111';
const draft: ServiceAction = {
  id,
  service: 'jira',
  operation: 'update_jira_issue',
  state: 'prepared',
  title: 'Изменить задачу Jira',
  fields: [{ label: 'Название', value: '<script>test</script>' }],
  expires_at: '2099-01-01T00:00:00Z',
  service_url: 'https://jira.example/',
  result: '',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function render(value: ServiceAction, busy = false) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ServiceActionCard
        draft={value}
        busy={busy}
        onDecide={() => {
          throw new Error('Rendering must not write');
        }}
      />
    </MemoryRouter>,
  );
}
it('shows exact fields and explicit confirmation without executing on open', () => {
  const html = render(draft);
  expect(html).toContain('Подтвердить');
  expect(html).toContain('Отменить');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('только после подтверждения');
  expect(render(draft, true)).toContain('disabled');
});
it.each(['executing', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired'] as const)(
  'disables confirmation in %s',
  (state) => {
    const value = { ...draft, state };
    expect(render(value)).not.toContain('>Подтвердить<');
    expect(actionMessage(value).length).toBeGreaterThan(0);
  },
);
it('disables an expired draft without waiting for polling', () => {
  const html = render({ ...draft, expires_at: '2020-01-01T00:00:00Z' });
  expect(html).toContain('Срок подтверждения истёк');
  expect(html).not.toContain('>Подтвердить<');
});
it.each(['javascript:alert(1)', 'https://user:pass@example.com/', '//example.com/', 'https://example.com/\\evil'])(
  'rejects unsafe service link %s',
  (service_url) => {
    expect(() => serviceActionSchema.parse({ ...draft, service_url })).toThrow();
  },
);
it('reads using the active session and sends a decision only on explicit call', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', profile_id: 'olga' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(draft)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...draft, state: 'succeeded' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...draft, state: 'cancelled' })));
  vi.stubGlobal('fetch', fetch);
  expect((await readServiceAction('olga', id)).state).toBe('prepared');
  expect(fetch.mock.calls[1][1].method).toBeUndefined();
  expect((await decideServiceAction('olga', id, true)).state).toBe('succeeded');
  expect(fetch.mock.calls[2][0]).toBe('/api/v1/service-actions/' + id + '/confirm');
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer token');
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ confirm: true });
  await decideServiceAction('olga', id, false);
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ confirm: false });
});
it('rejects an invalid draft id before fetching', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(readServiceAction('olga', '../foreign')).rejects.toThrow();
  await expect(decideServiceAction('olga', '../foreign', true)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a response for a different draft and does not retry automatically', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ...draft, id: '22222222-2222-4222-8222-222222222222' })));
  vi.stubGlobal('fetch', fetch);
  await expect(readServiceAction('olga', id)).rejects.toThrow('Неверное');
  expect(fetch).toHaveBeenCalledTimes(1);
});

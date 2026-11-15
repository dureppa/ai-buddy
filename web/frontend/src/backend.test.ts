import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  storage.clear();
});

describe('live backend client', () => {
  it('binds sessions to profiles and persists the conversation id', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token', profile_id: 'olga' }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation_id: '22222222-2222-4222-8222-222222222222',
            kind: 'answer',
            text: 'Ответ',
            references: [{ title: 'Источник', url: 'https://example.com' }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conversation_id: '22222222-2222-4222-8222-222222222222',
            messages: [{ role: 'assistant', content: 'Ответ' }],
          }),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const api = await import('./backend');
    expect((await api.askBackend('olga', 'Вопрос')).text).toBe('Ответ');
    expect(storage.get('ai-buddy.conversation.olga')).toBe('22222222-2222-4222-8222-222222222222');
    expect((await api.readBackendConversation('olga'))[0].content).toBe('Ответ');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects a session for a different profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ access_token: 'wrong', profile_id: 'maria' }), { status: 201 }),
        ),
    );
    const api = await import('./backend');
    await expect(api.sessionToken('olga')).rejects.toThrow('Профиль');
  });
  it('does not replace service errors with a demo answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'token', profile_id: 'sasha' }), { status: 201 }),
        )
        .mockResolvedValueOnce(new Response('', { status: 503 })),
    );
    const api = await import('./backend');
    await expect(api.apiFetch('sasha', '/api/v1/chat/messages')).rejects.toThrow('недоступен');
  });
});

it('uses Buddy API on external services and keeps explanation conversations separate', async () => {
  const storage = new Map<string, string>([['ai-buddy.conversation.olga', 'main-conversation']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: vi.fn() });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'buddy-token', profile_id: 'olga' })))
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          conversation_id: '22222222-2222-4222-8222-222222222222',
          kind: 'answer',
          text: 'Пояснение',
          references: [],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const api = await import('./backend');
  const context = { url: 'https://service.example/', selection: { text: 'Фрагмент', title: 'Страница' } };
  const controller = new AbortController();
  await api.askSelectionBackend('olga', 'Что это?', context, undefined, controller.signal, '/buddy-api');
  expect(fetch.mock.calls[0][0]).toBe('/buddy-api/v1/demo/sessions');
  expect(fetch.mock.calls[1][0]).toBe('/buddy-api/v1/chat/messages');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ text: 'Что это?', page_context: context });
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer buddy-token');
  expect(fetch.mock.calls[1][1].signal).toBe(controller.signal);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it('sends checklist context alongside the question in the primary conversation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'context-token', profile_id: 'olga' }))
    .mockResolvedValueOnce(
      Response.json({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        kind: 'answer',
        text: 'Ответ',
        references: [],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const api = await import('./backend');
  const context = {
    url: 'http://localhost/onboarding',
    selection: {
      title: 'Пункт',
      text: 'Команда',
      resource: { kind: 'task' as const, id: 'meet-team', label: 'Команда', description: 'Описание' },
    },
  };
  await api.askBackend('olga', 'Объясни пункт', context);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ text: 'Объясни пункт', page_context: context });
});

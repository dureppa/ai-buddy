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

// @vitest-environment jsdom
import { Socket } from 'node:net';
import { env } from 'node:process';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatWindow, type ChatEntry, type ChatProps } from './Chat';
import type { ProfileId } from './data';

function loadSize(name: string, fallback: number, maximum: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > maximum)
    throw new Error(`${name} must be an integer in [1, ${maximum}]`);
  return Number(raw);
}

async function runLoad(scenario: string, operation: (index: number) => Promise<void>, workers: number) {
  const requests = loadSize('LOAD_REQUESTS', 120, 100000);
  workers = Math.min(workers, requests);
  const samples = new Array<number>(requests);
  const failures: unknown[] = [];
  let next = 0;
  const began = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = next++;
        if (index >= requests) return;
        const start = performance.now();
        try {
          await operation(index);
        } catch (error) {
          failures.push(error);
        }
        samples[index] = performance.now() - start;
      }
    }),
  );
  const elapsed = performance.now() - began;
  samples.sort((a, b) => a - b);
  const percentile = (fraction: number) => Number(samples[Math.ceil(requests * fraction) - 1].toFixed(3));
  console.info(
    'LOAD_RESULT ' +
      JSON.stringify({
        scenario: `frontend_${scenario}`,
        operations: requests,
        workers,
        errors: failures.length,
        rps: Number(((requests * 1000) / elapsed).toFixed(2)),
        p50_ms: percentile(0.5),
        p95_ms: percentile(0.95),
        p99_ms: percentile(0.99),
        max_ms: percentile(1),
        network: networkAttempts,
      }),
  );
  expect(samples.every((sample) => sample > 0)).toBe(true);
  expect(failures.slice(0, 3)).toEqual([]);
  return requests;
}

let networkAttempts = 0;

beforeEach(() => {
  vi.resetModules();
  networkAttempts = 0;
  const forbidden = () => {
    networkAttempts++;
    throw new Error('Network is forbidden in frontend load tests');
  };
  vi.stubGlobal('fetch', forbidden);
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      constructor() {
        forbidden();
      }
    },
  );
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        forbidden();
      }
    },
  );
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(forbidden);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
});

afterEach(() => {
  const attempts = networkAttempts;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(attempts).toBe(0);
  expect(document.body.childElementCount).toBe(0);
});

it.each(['0', '-1', '257', 'bad', '1.5', ''])('rejects invalid load parameters: %s', (value) => {
  vi.stubEnv('LOAD_WORKERS', value);
  expect(() => loadSize('LOAD_WORKERS', 8, 256)).toThrow('LOAD_WORKERS');
});

it('accepts the default and both parameter boundaries', () => {
  vi.stubEnv('LOAD_WORKERS', undefined);
  expect(loadSize('LOAD_WORKERS', 8, 256)).toBe(8);
  for (const value of ['1', '256']) {
    vi.stubEnv('LOAD_WORKERS', value);
    expect(loadSize('LOAD_WORKERS', 8, 256)).toBe(Number(value));
  }
});

it.each(['success', 'unavailable'] as const)(
  'loads the real frontend API client with concurrent profiles: %s',
  async (scenario) => {
    const profiles: ProfileId[] = ['olga', 'sasha', 'timur', 'maria'];
    const conversations = new Map(
      profiles.map((profile, index) => [profile, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]),
    );
    const sessions = new Map<ProfileId, number>();
    let turns = 0;
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      // Yield to keep several requests in flight, without a server or timer.
      await Promise.resolve();
      if (path === '/api/v1/demo/sessions') {
        const { profile_id: profile } = JSON.parse(String(init.body)) as { profile_id: ProfileId };
        expect(profiles).toContain(profile);
        sessions.set(profile, (sessions.get(profile) ?? 0) + 1);
        return Response.json({ access_token: `load-${profile}`, profile_id: profile }, { status: 201 });
      }
      if (path !== '/api/v1/chat/messages') {
        networkAttempts++;
        throw new Error('Unexpected frontend request');
      }
      const authorization = new Headers(init.headers).get('Authorization');
      const profile = profiles.find((item) => authorization === `Bearer load-${item}`);
      expect(profile).toBeDefined();
      const request = JSON.parse(String(init.body)) as { text: string; conversation_id?: string };
      if (request.conversation_id) expect(request.conversation_id).toBe(conversations.get(profile!));
      turns++;
      if (scenario === 'unavailable') return Response.json({ error: { code: 'unavailable' } }, { status: 503 });
      return Response.json({
        conversation_id: conversations.get(profile!),
        kind: 'answer',
        text: `${profile}:${request.text}`,
        references: [{ title: 'Команда', url: '/team' }],
      });
    });
    const { askBackend } = await import('./backend');
    const requests = await runLoad(
      `api_${scenario}`,
      async (index) => {
        const profile = profiles[index % profiles.length];
        const text = `load-${index}`;
        if (scenario === 'unavailable') {
          await expect(askBackend(profile, text)).rejects.toThrow('Сервис временно недоступен');
          expect(localStorage.getItem(`ai-buddy.conversation.${profile}`)).toBeNull();
        } else {
          expect(await askBackend(profile, text)).toEqual({
            kind: 'answer',
            text: `${profile}:${text}`,
            references: [{ title: 'Команда', url: '/team' }],
          });
          expect(localStorage.getItem(`ai-buddy.conversation.${profile}`)).toBe(conversations.get(profile));
        }
      },
      loadSize('LOAD_WORKERS', 8, 256),
    );
    expect(turns).toBe(requests);
    expect(sessions.size).toBe(Math.min(profiles.length, requests));
    expect([...sessions.values()].every((count) => count === 1)).toBe(true);
  },
  300000,
);

it.each(['answer', 'waiting', 'error'] as const)(
  'updates a long React chat and checks controls on every iteration: %s',
  async (scenario) => {
    const historySize = loadSize('LOAD_HISTORY', 40, 1000);
    const history: ChatEntry[] = Array.from({ length: historySize }, (_, index) => ({
      id: index,
      from: 'buddy',
      reply: {
        kind: 'answer',
        text: `История ${index}: **проверенный ответ**`,
        references: [{ title: 'Команда', url: '/team' }],
      },
    }));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onSend = vi.fn();
    const onRetry = vi.fn();
    const props: ChatProps = {
      name: 'Ольга',
      profileId: 'olga',
      entries: [],
      suggestedQuestions: ['Кто мой наставник?'],
      waiting: scenario === 'waiting',
      confirming: false,
      drafts: {},
      onSend,
      onConfirm: vi.fn(),
      onDismiss: vi.fn(),
      onSurvey: vi.fn(),
      surveyDone: true,
      ...(scenario === 'error' ? { error: 'Сервис временно недоступен', onRetry } : {}),
    };
    try {
      const requests = await runLoad(
        `chat_${scenario}`,
        async (index) => {
          const text = `load-${index} <img src=x onerror=alert(1)>`;
          const entries: ChatEntry[] = [...history, { id: historySize, from: 'user', text }];
          await act(async () =>
            root.render(
              <MemoryRouter>
                <ChatWindow {...props} entries={entries} />
              </MemoryRouter>,
            ),
          );
          const log = container.querySelector<HTMLElement>('[role="log"]')!;
          expect(log.textContent).toContain(text);
          expect(log.querySelectorAll('article')).toHaveLength(historySize + 2);
          expect(log.querySelectorAll('a.agent-source[href="/team"]')).toHaveLength(historySize);
          expect(log.querySelectorAll('img[onerror], script')).toHaveLength(0);
          expect(log.querySelectorAll('strong')).toHaveLength(historySize);
          const input = container.querySelector<HTMLInputElement>('input[aria-label="Сообщение для Buddy"]')!;
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, `send-${index}`);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          const send = container.querySelector<HTMLButtonElement>('button[aria-label="Отправить сообщение"]')!;
          expect(send.disabled).toBe(scenario === 'waiting');
          expect(container.querySelector('[aria-label="Buddy думает"]') !== null).toBe(scenario === 'waiting');
          await act(async () =>
            container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
          );
          if (scenario === 'waiting') expect(onSend).not.toHaveBeenCalled();
          else {
            expect(onSend).toHaveBeenLastCalledWith(`send-${index}`);
            expect(onSend).toHaveBeenCalledTimes(index + 1);
            expect(input.value).toBe('');
          }
          if (scenario === 'error') {
            const alert = container.querySelector('[role="alert"]')!;
            expect(alert.textContent).toContain('Сервис временно недоступен');
            await act(async () => alert.querySelector<HTMLButtonElement>('button')!.click());
            expect(onRetry).toHaveBeenCalledTimes(index + 1);
          }
        },
        1,
      );
      expect(onSend).toHaveBeenCalledTimes(scenario === 'waiting' ? 0 : requests);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
  300000,
);

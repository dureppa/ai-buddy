// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ServiceSession } from './ServiceSession';

it.each([
  ['?profile=timur', '', 'timur'],
  ['?profile=timur', 'olga', 'olga'],
  ['?profile=unknown', '', null],
  ['?profile=olga&profile=maria', '', null],
] as const)(
  'uses a valid linked demo profile and prioritises an active cookie: %s/%s',
  async (search, cookie, want) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.history.replaceState({}, '', '/' + search);
    document.cookie = 'ai_buddy_account=; Max-Age=0; Path=/';
    if (cookie) document.cookie = 'ai_buddy_account=' + cookie + '; Path=/';
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ServiceSession>{(id) => <p data-profile={id}>{id}</p>}</ServiceSession>));
      if (want) expect(container.querySelector('[data-profile]')?.getAttribute('data-profile')).toBe(want);
      else expect(container.textContent).toContain('Войди в AI Buddy');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      document.cookie = 'ai_buddy_account=; Max-Age=0; Path=/';
      window.history.replaceState({}, '', '/');
      vi.unstubAllGlobals();
    }
  },
);

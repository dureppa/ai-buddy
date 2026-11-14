import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';

afterEach(() => vi.unstubAllGlobals());

it.each(hrServices)('$title is independent of AI Buddy navigation', (service) => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  const html = renderToStaticMarkup(<HrPage service={service} profileId="maria" />);
  expect(html).toContain(service.title);
  expect(html).not.toContain('Вернуться в AI Buddy');
  expect(html).not.toContain('localhost:5173');
});

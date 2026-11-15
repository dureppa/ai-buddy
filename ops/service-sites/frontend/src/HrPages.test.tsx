import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentsPage } from '../../../../corporate-services/documents/frontend/page';
import { EventsPage } from '../../../../corporate-services/events/frontend/page';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';

const backendMode = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../../../web/frontend/src/backend', () => ({
  get backendEnabled() {
    return backendMode.enabled;
  },
  apiFetch: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

it.each(hrServices)('$title is independent of AI Buddy navigation', (service) => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  const html = renderToStaticMarkup(<HrPage service={service} profileId="maria" />);
  expect(html).toContain(service.title);
  expect(html).not.toContain('Вернуться в AI Buddy');
  expect(html).not.toContain('localhost:5173');
});

it.each([false, true])('renders documents and events independently with backendEnabled=%s', (enabled) => {
  backendMode.enabled = enabled;
  vi.stubGlobal('localStorage', { getItem: () => null });
  const documents = renderToStaticMarkup(<DocumentsPage profileId="maria" />);
  const events = renderToStaticMarkup(<EventsPage profileId="maria" />);
  expect(documents).toContain('Документы и инструкции');
  expect(events).toContain('Корпоративные мероприятия');
  for (const html of [documents, events]) {
    expect(html).not.toContain('Вернуться в AI Buddy');
    expect(html).not.toContain('localhost:5173');
  }
});

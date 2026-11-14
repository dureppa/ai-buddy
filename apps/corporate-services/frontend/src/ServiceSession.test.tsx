import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceSession } from './ServiceSession';
import { LiveScheduleHr } from './LiveScheduleHr';
import { DocumentsApi } from '../../../../services/hr/documents/frontend/api';
import { EventsApi } from '../../../../services/hr/events/frontend/api';

it('requires a Buddy session instead of silently using maria', () => {
  const html = renderToStaticMarkup(
    <ServiceSession>
      {() => {
        throw new Error('Account required');
      }}
    </ServiceSession>,
  );
  expect(html).toContain('Войди в AI Buddy');
  expect(html).not.toContain('<select');
});
it.each([
  <LiveScheduleHr service="absences" profileId="olga" />,
  <LiveScheduleHr service="trips" profileId="sasha" />,
  <DocumentsApi profileId="olga" />,
  <EventsApi profileId="sasha" />,
])('does not offer account selection in a service', (page) => {
  const html = renderToStaticMarkup(page);
  expect(html).not.toContain('Демопрофиль');
  expect(html).not.toContain('<select');
});

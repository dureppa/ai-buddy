import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { chatDestination, safeChatUrl } from './chat-links';
import { corporateLinks } from './corporate-links';
import { AgentAnswer } from './AgentAnswer';
import { ChatPage, ChatWindow } from './Chat';

it.each([
  ['product', '/product-guide'],
  ['contacts', '/team'],
  ['equipment', '/onboarding/tasks/equipment'],
  ['learning', '/onboarding/tasks/safety'],
])('opens legacy %s in an actual screen', (article, target) => {
  expect(chatDestination('/resources?article=' + article)).toBe(target);
});
it.each([
  ['documents', 'documents'],
  ['consents', 'consents'],
  ['meetups', 'events'],
  ['timeoff', 'absences'],
])('opens %s in its corporate service', (article, id) => {
  const expected = new URL(corporateLinks.find((s) => s.id === id)!.url);
  expected.searchParams.set('profile', 'timur');
  expect(chatDestination('/resources?article=' + article, 'timur')).toBe(expected.toString());
});
it.each(corporateLinks)('preserves current profile for $id without tokens', ({ url }) => {
  const source = new URL(url);
  source.searchParams.set('request', 'receipt');
  source.searchParams.set('profile', 'olga');
  source.hash = 'details';
  const target = new URL(chatDestination(source.toString(), 'sasha')!);
  expect(target.searchParams.getAll('profile')).toEqual(['sasha']);
  expect(target.searchParams.get('request')).toBe('receipt');
  expect(target.hash).toBe('#details');
  expect(target.toString()).not.toMatch(/token/);
});
it.each(['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://u:p@host/', 'https://%', '/foo\nbar'])(
  'rejects unsafe source %s',
  (value) => {
    expect(safeChatUrl(value)).toBe(false);
    expect(chatDestination(value, 'olga')).toBeNull();
  },
);
it('keeps generic/internal links and never discloses a profile to an unknown origin', () => {
  expect(chatDestination('/onboarding')).toBe('/onboarding');
  expect(chatDestination('/resources?article=unknown')).toBeNull();
  expect(chatDestination('https://research.example/guide#section', 'olga')).toBe(
    'https://research.example/guide#section',
  );
});
it('uses the same verified destination for an inline link and source card', () => {
  const source = '/resources?article=documents';
  const html = renderToStaticMarkup(
    <AgentAnswer
      profileId="olga"
      text={'[Документы](' + source + ')'}
      references={[{ title: 'Документы', url: source }]}
    />,
  );
  expect(html.match(/href="http:\/\/localhost:5187\/\?profile=olga"/g)).toHaveLength(2);
  expect(html).not.toContain('href="/resources');
  expect(
    renderToStaticMarkup(<AgentAnswer text="План" references={[{ title: 'Старое задание', url: '/onboarding' }]} />),
  ).toContain('Открыть план адаптации');
});
it.each([ChatWindow, ChatPage])('routes links consistently in both chat presentations', (Component) => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Component
        name="Ольга"
        profileId="olga"
        entries={[
          {
            id: 1,
            from: 'buddy',
            reply: {
              kind: 'answer',
              text: 'Открой документы',
              link: { label: 'Документы', to: '/resources?article=documents' },
            },
          },
        ]}
        waiting={false}
        confirming={false}
        drafts={{}}
        onSend={() => {}}
        onConfirm={() => {}}
        onDismiss={() => {}}
        onSurvey={() => {}}
        surveyDone={true}
      />
    </MemoryRouter>,
  );
  expect(html).toContain('http://localhost:5187/?profile=olga');
  expect(html).not.toContain('href="/resources?article=documents');
});

it('shows an unsupported legacy article as unavailable rather than opening a false screen', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer
      text="[Материал](/resources?article=unknown)"
      references={[{ title: 'Материал', url: '/resources?article=unknown' }]}
    />,
  );
  expect(html).not.toContain('href="/resources');
  expect(html).toContain('ссылка пока недоступна');
});

it.each(['constructor', '__proto__', 'toString'])(
  'rejects unsupported article identity %s without inherited object keys',
  (id) => expect(chatDestination('/resources?article=' + id)).toBeNull(),
);

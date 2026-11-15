import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tools } from './screens';
import { toolProfileUrl } from './tool-links';

it.each(['maria', 'sasha'] as const)('opens Jira from tools for %s', (profileId) => {
  const html = renderToStaticMarkup(<Tools profileId={profileId} onOpen={() => {}} />);
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const jira = anchors.filter((anchor) => anchor.includes('Открыть доски'));
  expect(jira).toHaveLength(1);
  expect(jira[0]).toContain('profile=' + profileId);
  expect(jira[0]).toContain('target="_blank"');
  expect(jira[0]).toContain('rel="noopener noreferrer"');
  expect(jira[0]).not.toContain('access_token');
  expect(jira[0]).not.toContain('Требуется запрос');
});

it('preserves configured URL parameters and replaces an old profile', () => {
  const url = new URL(toolProfileUrl('https://jira.example/?board=team&profile=olga', 'sasha'));
  expect(url.searchParams.get('board')).toBe('team');
  expect(url.searchParams.getAll('profile')).toEqual(['sasha']);
});

it('opens Confluence as a separate tool without a fabricated access badge', () => {
  const html = renderToStaticMarkup(<Tools profileId="olga" onOpen={() => {}} />);
  const link = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []).find((item) => item.includes('Открыть базу знаний'));
  expect(link).toContain('page=team-delivery');
  expect(link).toContain('profile=olga');
  expect(link).toContain('target="_blank"');
  expect(link).not.toContain('Доступ предоставлен');
});

it.each([
  ['olga', ['Redash', 'Витрина заказов', 'Trisigma']],
  ['sasha', ['Bitbucket', 'PaaS', 'Grafana']],
  ['timur', ['Тест-кейсы · TMS', 'Postman', 'Тестовый стенд Автотеки']],
  ['maria', ['Figma', 'Дизайн-система Авито', 'Дизайн-ревью']],
] as const)('shows the role tools before shared services for %s', (profileId, roleTools) => {
  const html = renderToStaticMarkup(<Tools profileId={profileId} onOpen={() => {}} />);
  const title = [...html.matchAll(/<strong>([^<]+)<\/strong>/g)].map((match) => match[1]);
  expect(title).toEqual([...roleTools, 'Jira', 'Confluence', 'Mattermost']);
  expect(html).not.toMatch(/Мои заявки|Есть доступ|Требуется запрос|Ожидают подтверждения/);
});

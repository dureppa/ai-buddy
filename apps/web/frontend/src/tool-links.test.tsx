import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tools } from './screens';
import { jiraProfileUrl } from './tool-links';

it.each(['maria', 'sasha'] as const)('opens Jira from tools for %s', (profileId) => {
  const html = renderToStaticMarkup(
    <Tools profileId={profileId} workspace={{ completed: [], requests: [] }} onOpen={() => {}} />,
  );
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
  const url = new URL(jiraProfileUrl('https://jira.example/?board=team&profile=olga', 'sasha'));
  expect(url.searchParams.get('board')).toBe('team');
  expect(url.searchParams.getAll('profile')).toEqual(['sasha']);
});

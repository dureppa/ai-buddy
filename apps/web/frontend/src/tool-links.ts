import type { ProfileId } from './data';

export const jiraService = {
  id: 'jira',
  title: 'Jira',
  description: 'Доски команды и ваши задачи.',
  icon: 'grid',
  tone: 'blue',
  url: import.meta.env.VITE_JIRA_URL || 'http://localhost:5189/',
} as const;

export function jiraProfileUrl(base: string, profile: ProfileId) {
  const url = new URL(base);
  url.searchParams.set('profile', profile);
  return url.toString();
}

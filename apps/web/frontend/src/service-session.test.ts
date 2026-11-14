import { expect, it } from 'vitest';
import { accountCookieValue, readServiceProfile } from './service-session';

it.each(['olga', 'sasha', 'maria', 'timur'] as const)(
  'reads the current account %s across service ports',
  (profile) => {
    expect(readServiceProfile('other=value; ' + accountCookieValue(profile))).toBe(profile);
  },
);
it.each([
  '',
  'ai_buddy_account=',
  'ai_buddy_account=unknown',
  'ai_buddy_account=constructor',
  'ai_buddy_account=mentor',
  'other_ai_buddy_account=maria',
])('does not substitute another account for %s', (cookie) => {
  expect(readServiceProfile(cookie)).toBeNull();
});
it('clears the account cookie on logout and scopes it to the host', () => {
  expect(accountCookieValue(null)).toContain('Max-Age=0');
  expect(accountCookieValue('maria')).toContain('Path=/; SameSite=Lax');
  expect(accountCookieValue('maria')).not.toContain('Domain=');
});

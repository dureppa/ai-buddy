import { isProfileId, type AccountId, type ProfileId } from './demo-accounts';

const accountCookie = 'ai_buddy_account';

export function accountCookieValue(account: AccountId | null): string {
  return `${accountCookie}=${account ?? ''}; Path=/; SameSite=Lax${account ? '' : '; Max-Age=0'}`;
}

export function readServiceProfile(cookie: string): ProfileId | null {
  const entry = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(accountCookie + '='));
  const value = entry?.slice(accountCookie.length + 1);
  return value && isProfileId(value) ? value : null;
}

export function readServiceProfileQuery(search: string): ProfileId | null {
  const values = new URLSearchParams(search).getAll('profile');
  return values.length === 1 && isProfileId(values[0]) ? values[0] : null;
}

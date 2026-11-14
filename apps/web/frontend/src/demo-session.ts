import { isProfileId, isStaffId, type AccountId } from './demo-accounts';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const demoSessionKey = 'ai-buddy.profile';

export function readDemoSession(storage: Pick<Storage, 'getItem'>): AccountId | null {
  const saved = storage.getItem(demoSessionKey);
  return saved && (isProfileId(saved) || isStaffId(saved)) ? saved : null;
}

export function startDemoSession(storage: SessionStorage, account: AccountId): AccountId {
  const active = readDemoSession(storage);
  if (active) return active;
  storage.setItem(demoSessionKey, account);
  return account;
}

export function endDemoSession(storage: SessionStorage) {
  storage.removeItem(demoSessionKey);
}

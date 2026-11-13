import { profiles, type ProfileId } from './data';

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const demoSessionKey = 'ai-buddy.profile';

export function readDemoSession(storage: SessionStorage): ProfileId | null {
  const saved = storage.getItem(demoSessionKey);
  return saved && Object.hasOwn(profiles, saved) ? (saved as ProfileId) : null;
}

export function startDemoSession(storage: SessionStorage, profile: ProfileId): ProfileId {
  const active = readDemoSession(storage);
  if (active) return active;
  storage.setItem(demoSessionKey, profile);
  return profile;
}

export function endDemoSession(storage: SessionStorage) {
  storage.removeItem(demoSessionKey);
}

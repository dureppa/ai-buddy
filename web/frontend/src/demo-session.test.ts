import { describe, expect, it } from 'vitest';
import { products } from './demo-accounts';
import { demoSessionKey, endDemoSession, readDemoSession, startDemoSession } from './demo-session';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe('demo session', () => {
  it('restores legacy profile IDs and rejects missing or unrecognized IDs', () => {
    expect(readDemoSession(memoryStorage())).toBeNull();
    expect(readDemoSession(memoryStorage({ [demoSessionKey]: 'unknown' }))).toBeNull();
    expect(readDemoSession(memoryStorage({ [demoSessionKey]: 'constructor' }))).toBeNull();
    expect(readDemoSession(memoryStorage({ [demoSessionKey]: 'maria' }))).toBe('maria');
  });

  it('requires logout to choose a different account and preserves saved workspace data', () => {
    const storage = memoryStorage({ 'ai-buddy.workspace.olga': 'progress' });
    expect(startDemoSession(storage, 'olga')).toBe('olga');
    expect(startDemoSession(storage, 'sasha')).toBe('olga');
    expect(readDemoSession(storage)).toBe('olga');
    endDemoSession(storage);
    expect(readDemoSession(storage)).toBeNull();
    expect(storage.getItem('ai-buddy.workspace.olga')).toBe('progress');
    expect(startDemoSession(storage, 'sasha')).toBe('sasha');
  });
  it('uses the same active session for interns, mentors and managers across all products', () => {
    const storage = memoryStorage();
    for (const { intern, mentor, manager } of Object.values(products)) {
      for (const account of [intern, mentor, manager]) {
        expect(startDemoSession(storage, account)).toBe(account);
        expect(startDemoSession(storage, account === intern ? mentor : intern)).toBe(account);
        expect(readDemoSession(storage)).toBe(account);
        endDemoSession(storage);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { guideStorageKey, readGuide, toggleGuide } from './guide-store';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('guide sites', () => {
  it('stores a read document separately from event signups', () => {
    const storage = memoryStorage();
    expect(readGuide(storage, 'documents').every((item) => !item.done)).toBe(true);

    const documents = toggleGuide(storage, 'documents', 'papers');
    expect(documents.find((item) => item.id === 'papers')?.done).toBe(true);
    expect(readGuide(storage, 'events').every((item) => !item.done)).toBe(true);

    toggleGuide(storage, 'events', 'intro');
    expect(readGuide(storage, 'documents').find((item) => item.id === 'papers')?.done).toBe(true);
    expect(readGuide(storage, 'events').find((item) => item.id === 'intro')?.done).toBe(true);
    expect(JSON.parse(storage.getItem(guideStorageKey('documents')) ?? '[]')).toEqual(['papers']);
  });

  it('ignores broken storage and unknown ids', () => {
    const storage = memoryStorage({
      [guideStorageKey('documents')]: JSON.stringify(['papers', 'missing', 1]),
    });
    expect(
      readGuide(storage, 'documents')
        .filter((item) => item.done)
        .map((item) => item.id),
    ).toEqual(['papers']);
    expect(readGuide(memoryStorage({ [guideStorageKey('events')]: '{' }), 'events').every((item) => !item.done)).toBe(
      true,
    );
    expect(() => toggleGuide(storage, 'documents', 'missing')).toThrow('Запись не найдена.');
  });
});

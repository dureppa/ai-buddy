import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { newOperationKey } from './operation-key';
afterEach(() => vi.unstubAllGlobals());
it('creates valid distinct operation keys without secure-context randomUUID', () => {
  const crypto = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const keys = Array.from({ length: 20 }, () => newOperationKey());
  expect(new Set(keys).size).toBe(keys.length);
  for (const key of keys) {
    expect(z.uuidv4().parse(key)).toBe(key);
  }
});

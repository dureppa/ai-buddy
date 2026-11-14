import { describe, expect, it } from 'vitest';
import { readWorkspace, toggleTask } from './demo';
import {
  accountStorageKey,
  internOverview,
  materialsFor,
  readMaterials,
  readStaffId,
  removeMaterial,
  saveMaterial,
  type MaterialInput,
} from './staff-data';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
const input: MaterialInput = {
  title: 'Гайд по команде',
  description: 'Как познакомиться с командой и открыть рабочие ссылки.',
  audience: ['olga'],
  source: { kind: 'link', href: 'https://example.com/guide' },
};

describe('staff workspace', () => {
  it('recognizes only staff accounts and limits the roster by role', () => {
    const storage = memoryStorage();
    storage.setItem(accountStorageKey, 'olga');
    expect(readStaffId(storage)).toBeNull();
    storage.setItem(accountStorageKey, 'mentor');
    expect(readStaffId(storage)).toBe('mentor');
    expect(internOverview(storage, 'mentor').map((intern) => intern.profile.id)).toEqual(['olga', 'sasha']);
    expect(internOverview(storage, 'manager').map((intern) => intern.profile.id)).toEqual(['olga', 'sasha', 'maria']);
  });

  it('reads current progress, nearest step and access request details', () => {
    const storage = memoryStorage();
    const before = readWorkspace(storage, 'olga').completed.length;
    toggleTask(storage, 'olga', 'papers');
    const [olga, , maria] = internOverview(storage, 'manager');
    expect(olga.progress.completed).toBe(before + 1);
    expect(olga.next?.id).toBe('intro');
    expect(maria.requests[0]).toMatchObject({ number: 'Д-001', title: 'Grafana' });
    expect(maria.requests[0].owner).toBeTruthy();
  });

  it('filters publications by intern and supports editing and deletion by their author', () => {
    const storage = memoryStorage();
    saveMaterial(storage, 'mentor', input);
    const [material] = readMaterials(storage);
    expect(materialsFor(storage, 'olga')).toEqual([material]);
    expect(materialsFor(storage, 'maria')).toEqual([]);
    expect(() => saveMaterial(storage, 'manager', input, material.id)).toThrow();
    expect(() => removeMaterial(storage, 'manager', material.id)).toThrow();
    saveMaterial(storage, 'mentor', { ...input, title: 'Обновлённый гайд', audience: ['sasha'] }, material.id);
    expect(materialsFor(storage, 'olga')).toEqual([]);
    expect(materialsFor(storage, 'sasha')[0].title).toBe('Обновлённый гайд');
    removeMaterial(storage, 'mentor', material.id);
    expect(readMaterials(storage)).toEqual([]);
  });

  it('rejects unauthorized audiences and unsupported URLs but accepts a downloadable file', () => {
    const storage = memoryStorage();
    expect(() => saveMaterial(storage, 'mentor', { ...input, audience: ['maria'] })).toThrow();
    expect(() =>
      saveMaterial(storage, 'manager', { ...input, source: { kind: 'link', href: 'javascript:alert(1)' } }),
    ).toThrow();
    const source = { kind: 'file', name: 'guide.txt', href: 'data:text/plain;base64,dGVzdA==' } as const;
    saveMaterial(storage, 'manager', { ...input, source, audience: ['olga', 'olga', 'maria'] });
    expect(materialsFor(storage, 'maria')[0].source).toEqual(source);
    expect(readMaterials(storage)[0].audience).toEqual(['olga', 'maria']);
  });
});

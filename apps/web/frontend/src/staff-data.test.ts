import { describe, expect, it } from 'vitest';
import { readWorkspace, toggleTask } from './demo';
import { tasksFor } from './checklist';
import { products } from './demo-accounts';
import { demoSessionKey } from './demo-session';
import {
  materialsKey,
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
    storage.setItem(demoSessionKey, 'olga');
    expect(readStaffId(storage)).toBeNull();
    storage.setItem(demoSessionKey, 'mentor');
    expect(readStaffId(storage)).toBe('mentor');
    for (const { intern, mentor, manager } of Object.values(products)) {
      expect(internOverview(storage, mentor).map(({ id }) => id)).toEqual([intern]);
      expect(internOverview(storage, manager).map(({ id }) => id)).toEqual([intern]);
    }
  });

  it('reads current progress, nearest step and access request details', () => {
    const storage = memoryStorage();
    const before = readWorkspace(storage, 'olga').completed.length;
    toggleTask(storage, 'olga', 'dev-principles');
    const [olga] = internOverview(storage, 'manager');
    const [maria] = internOverview(storage, 'help-manager');
    expect(olga.progress.completed).toBe(before + 1);
    expect(olga.next?.id).toBe('avito-numbers');
    expect(olga.checklist.find((item) => item.id === 'avito-cli')?.title).toBe('Получи доступ к витринам');
    expect(tasksFor('sasha').find((item) => item.id === 'avito-cli')?.title).toBe('Настрой avito-cli');
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
    saveMaterial(storage, 'mentor', { ...input, title: 'Обновлённый гайд' }, material.id);
    expect(materialsFor(storage, 'sasha')).toEqual([]);
    expect(materialsFor(storage, 'olga')[0].title).toBe('Обновлённый гайд');
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
    saveMaterial(storage, 'help-manager', { ...input, source, audience: ['maria', 'maria'] });
    expect(materialsFor(storage, 'maria')[0].source).toEqual(source);
    expect(readMaterials(storage)[0].audience).toEqual(['maria']);
  });
  it('keeps older publications visible only to the author’s current team', () => {
    const storage = memoryStorage();
    const legacy = { ...input, id: 'old', author: 'mentor', audience: ['olga', 'sasha'] };
    storage.setItem(materialsKey, JSON.stringify([legacy, { ...legacy, id: 'other', audience: ['sasha'] }]));
    expect(materialsFor(storage, 'olga')).toEqual([{ ...legacy, audience: ['olga'] }]);
    expect(materialsFor(storage, 'sasha')).toEqual([]);
  });
});

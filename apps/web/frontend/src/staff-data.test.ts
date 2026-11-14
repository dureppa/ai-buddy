import { describe, expect, it, vi } from 'vitest';
import { readWorkspace, toggleTask } from './demo';
import { tasksFor } from './checklist';
import { products } from './demo-accounts';
import { demoSessionKey } from './demo-session';
import {
  baselineFor,
  groupByName,
  addChecklistItem,
  checklistFor,
  internMaterials,
  materialsForTask,
  publishedForIntern,
  removeChecklistItem,
  setTaskMaterials,
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
  group: 'Чаты',
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

  it('lets a mentor and a manager share checklist items and team materials', () => {
    const storage = memoryStorage();
    const added = addChecklistItem(storage, 'mentor', {
      title: 'Созвон с заказчиком',
      summary: 'Коротко обсудить метрику недели.',
      stage: 'week-1',
    });
    addChecklistItem(storage, 'manager', {
      title: 'План от руководителя',
      summary: 'Зафиксировать цель на первую неделю.',
      stage: 'week-1',
    });
    const [forMentor] = internOverview(storage, 'mentor');
    const [forManager] = internOverview(storage, 'manager');
    const [sasha] = internOverview(storage, 'travel-manager');
    expect(forMentor.checklist.some((item) => item.id === added.id && item.custom)).toBe(true);
    expect(forManager.checklist.map((item) => item.title)).toEqual(forMentor.checklist.map((item) => item.title));
    expect(sasha.checklist.some((item) => item.custom)).toBe(false);

    saveMaterial(storage, 'mentor', input);
    saveMaterial(storage, 'manager', { ...input, title: 'План руководителя', group: 'Документы' });
    expect(
      publishedForIntern(storage, 'olga')
        .map((item) => item.author)
        .sort(),
    ).toEqual(['Алексей Морозов', 'Анна Ким']);
    expect(publishedForIntern(storage, 'sasha')).toEqual([]);

    const materialId = publishedForIntern(storage, 'olga').find((item) => item.title === input.title)?.id ?? '';
    expect(materialId).not.toBe('');
    setTaskMaterials(storage, 'manager', added.id, [materialId, 'baseline-delivery-chat']);
    setTaskMaterials(storage, 'manager', 'meet-team', ['baseline-delivery-chat']);
    expect(materialsForTask(storage, 'olga', added.id).map((item) => item.id)).toEqual([
      materialId,
      'baseline-delivery-chat',
    ]);
    expect(checklistFor(storage, 'olga').find((item) => item.id === 'meet-team')?.materialIds).toEqual([
      'baseline-delivery-chat',
    ]);
    expect(() => setTaskMaterials(storage, 'manager', added.id, ['missing'])).toThrow(
      'Можно указать только материалы этого стажёра.',
    );

    removeChecklistItem(storage, 'manager', added.id);
    expect(checklistFor(storage, 'olga').some((item) => item.id === added.id)).toBe(false);
    expect(() => removeChecklistItem(storage, 'manager', 'meet-team')).toThrow(
      'Можно удалить только добавленный пункт.',
    );
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
    const legacy = {
      id: 'old',
      author: 'mentor' as const,
      title: input.title,
      description: input.description,
      audience: ['olga', 'sasha'],
      source: input.source,
    };
    storage.setItem(materialsKey, JSON.stringify([legacy, { ...legacy, id: 'other', audience: ['sasha'] }]));
    expect(materialsFor(storage, 'olga')).toEqual([{ ...legacy, audience: ['olga'], group: 'Общее' }]);
    expect(materialsFor(storage, 'sasha')).toEqual([]);
  });

  it('saves a material when the page is not a secure context', () => {
    const storage = memoryStorage();
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    saveMaterial(storage, 'mentor', input);
    expect(materialsFor(storage, 'olga')[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    randomUUID.mockRestore();
  });

  it('shows the baseline chat before staff links and keeps them in one group', () => {
    const storage = memoryStorage();
    saveMaterial(storage, 'mentor', input);
    saveMaterial(storage, 'manager', { ...input, title: 'План встреч', group: 'Встречи' });
    const shown = internMaterials(storage, 'olga');
    expect(shown[0]).toMatchObject({
      author: 'Базовый',
      group: 'Чаты',
      title: 'Общий чат для всех сотрудников Авито Доставки',
    });
    expect(baselineFor('sasha')[0].title).toBe('Общий чат для всех сотрудников Авито Путешествия');
    expect(groupByName(shown).map((group) => group.name)).toEqual(['Чаты', 'Встречи']);
    expect(groupByName(shown)[0].items.map((item) => item.author)).toEqual(['Базовый', 'Анна Ким']);
    expect(() => saveMaterial(storage, 'mentor', { ...input, group: ' ' })).toThrow();
  });
});

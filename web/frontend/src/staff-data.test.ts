import { describe, expect, it, vi } from 'vitest';
import { readWorkspace, toggleTask } from './demo';
import { tasksFor } from './checklist';
import { products, teamInterns, profiles } from './demo-accounts';
import { demoSessionKey } from './demo-session';
import {
  addChecklistItem,
  baselineFor,
  checklistFor,
  groupByName,
  internMaterials,
  materialGroupChoices,
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
      expect(internOverview(storage, mentor).map(({ id }) => id)).toEqual(teamInterns(profiles[intern].productId));
      expect(internOverview(storage, manager).map(({ id }) => id)).toEqual(teamInterns(profiles[intern].productId));
    }
  });

  it('reads current progress and the nearest step', () => {
    const storage = memoryStorage();
    const before = readWorkspace(storage, 'olga').completed.length;
    toggleTask(storage, 'olga', 'dev-principles');
    const [olga] = internOverview(storage, 'manager');
    expect(olga.progress.completed).toBe(before + 1);
    expect(olga.next?.id).toBe('avito-numbers');
    expect(olga.checklist.find((item) => item.id === 'avito-cli')?.title).toBe('Получи доступ к витринам');
    expect(tasksFor('sasha').find((item) => item.id === 'avito-cli')?.title).toBe('Настрой avito-cli');
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

  it('keeps a custom group in the choices ahead of unused suggestions', () => {
    expect(materialGroupChoices(['Чаты', '  Онбординг  ', 'Чаты', 'я'])).toEqual([
      'Чаты',
      'Онбординг',
      'Доступы',
      'Документы',
      'Встречи',
    ]);
  });

  it('shows the baseline chat before staff links and keeps them in one group', () => {
    const storage = memoryStorage();
    saveMaterial(storage, 'mentor', input);
    saveMaterial(storage, 'manager', { ...input, title: 'План встреч', group: 'Встречи' });
    const shown = internMaterials(storage, 'olga');
    expect(shown[0]).toMatchObject({
      author: 'Стартовый набор команды · учебные данные',
      group: 'Чаты',
      title: 'Общий чат для всех сотрудников Авито Доставки',
    });
    expect(baselineFor('sasha')[0].title).toBe('Общий чат для всех сотрудников Авито Путешествия');
    expect(groupByName(shown).map((group) => group.name)).toEqual(['Чаты', 'Доступы', 'Документы', 'Встречи']);
    expect(groupByName(shown)[0].items.at(-1)?.author).toBe('Анна Ким');
    expect(() => saveMaterial(storage, 'mentor', { ...input, group: ' ' })).toThrow();
  });
});

it.each(Object.values(products))('keeps all three $name interns independent', (product) => {
  const storage = memoryStorage();
  const ids = teamInterns(profiles[product.intern].productId);
  expect(ids).toHaveLength(3);
  const [, second, third] = ids;
  expect(internOverview(storage, product.manager).map((item) => item.id)).toEqual(ids);
  const extra = addChecklistItem(
    storage,
    product.manager,
    {
      title: 'Личное задание',
      summary: 'Подготовить свой отчёт',
      stage: 'week-1',
    },
    second,
  );
  saveMaterial(storage, product.manager, { ...input, audience: [second, third] });
  const [published] = readMaterials(storage);
  expect(materialsFor(storage, product.intern)).toEqual([]);
  expect(materialsFor(storage, third)).toHaveLength(1);
  setTaskMaterials(storage, product.manager, extra.id, [published.id], undefined, second);
  setTaskMaterials(storage, product.manager, 'meet-team', [published.id], undefined, second);
  expect(materialsForTask(storage, second, extra.id)).toHaveLength(1);
  expect(materialsForTask(storage, second, 'meet-team')).toHaveLength(1);
  expect(materialsForTask(storage, third, 'meet-team')).toEqual([]);
  expect(checklistFor(storage, third).some((item) => item.id === extra.id)).toBe(false);
  expect(() => removeChecklistItem(storage, product.manager, extra.id, third)).toThrow();
  toggleTask(storage, second, 'meet-team');
  expect(checklistFor(storage, second).find((item) => item.id === 'meet-team')?.done).toBe(true);
  expect(checklistFor(storage, third).find((item) => item.id === 'meet-team')?.done).toBe(false);
  setTaskMaterials(storage, product.mentor, extra.id, [], undefined, second);
  expect(materialsForTask(storage, second, extra.id)).toEqual([]);
  removeChecklistItem(storage, product.mentor, extra.id, second);
  expect(checklistFor(storage, second).some((item) => item.id === extra.id)).toBe(false);
  saveMaterial(storage, product.manager, { ...input, audience: [third] }, published.id);
  expect(materialsFor(storage, second)).toEqual([]);
  expect(materialsFor(storage, third)).toHaveLength(1);
});

it('rejects checklist changes and attachments outside the staff team', () => {
  const storage = memoryStorage();
  const before = JSON.stringify(storage.getItem('ai-buddy.checklist-edits'));
  expect(() =>
    addChecklistItem(
      storage,
      'manager',
      {
        title: 'Чужое задание',
        summary: 'Описание задания',
        stage: 'week-1',
      },
      'travel-pavel',
    ),
  ).toThrow('своих стажёров');
  expect(() => setTaskMaterials(storage, 'manager', 'meet-team', [], undefined, 'travel-pavel')).toThrow(
    'своих стажёров',
  );
  expect(() => removeChecklistItem(storage, 'manager', 'extra-any', 'travel-pavel')).toThrow('своих стажёров');
  expect(JSON.stringify(storage.getItem('ai-buddy.checklist-edits'))).toBe(before);
  expect(() => saveMaterial(storage, 'manager', { ...input, audience: ['travel-pavel'] })).toThrow('своих стажёров');
});

import { describe, expect, it } from 'vitest';
import {
  answerBuddy,
  absenceServiceLink,
  buddyGrowthStage,
  confirmAccess,
  completeTask,
  progressFor,
  readWorkspace,
  toggleTask,
  type AccessDraft,
  type StoragePort,
} from './demo';
import { tasksFor } from './checklist';
import { products, profiles, staffAccounts } from './demo-accounts';

type Memory = StoragePort & { data: Map<string, string> };
function memory(): Memory {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe('Buddy growth on the dashboard', () => {
  it('shows the matching age for the demo profiles', () => {
    const storage = memory();
    expect(buddyGrowthStage('olga', readWorkspace(storage, 'olga'))).toBe('baby');
    expect(buddyGrowthStage('timur', readWorkspace(storage, 'timur'))).toBe('baby');
    expect(buddyGrowthStage('sasha', readWorkspace(storage, 'sasha'))).toBe('young');
    expect(buddyGrowthStage('maria', readWorkspace(storage, 'maria'))).toBe('adult');
  });

  it('requires the midpoint milestone and an actual 85% completion for the adult form', () => {
    const storage = memory();
    const young = toggleTask(storage, 'olga', 'equator-meeting');
    expect(buddyGrowthStage('olga', young)).toBe('young');
    expect(buddyGrowthStage('olga', readWorkspace(storage, 'olga'))).toBe('young');

    const otherIds = tasksFor('olga')
      .map(({ id }) => id)
      .filter((id) => id !== 'equator-meeting');
    const threshold = Math.ceil((otherIds.length + 1) * 0.85);
    const completed = ['equator-meeting', ...otherIds.slice(0, threshold - 2)];
    expect(buddyGrowthStage('olga', { ...young, completed })).toBe('young');

    completed.push(otherIds[threshold - 2]);
    expect(buddyGrowthStage('olga', { ...young, completed })).toBe('adult');
    expect(buddyGrowthStage('olga', { ...young, completed: otherIds })).toBe('baby');
  });
});

describe('AI-buddy demo workspace', () => {
  it('opens the final profile with a finished checklist and a saved request', () => {
    const storage = memory();
    const workspace = readWorkspace(storage, 'maria');
    expect(progressFor(workspace).percent).toBe(100);
    expect(workspace.requests).toMatchObject([{ serviceId: 'grafana', status: 'submitted' }]);
    expect(readWorkspace(storage, 'olga').requests).toEqual([]);
  });

  it('persists a completed onboarding task and recalculates progress', () => {
    const storage = memory();
    const initial = readWorkspace(storage, 'olga');
    const updated = toggleTask(storage, 'olga', 'dev-principles');
    expect(updated.completed).toContain('dev-principles');
    expect(progressFor(updated).completed).toBe(progressFor(initial).completed + 1);
    expect(readWorkspace(storage, 'olga').completed).toContain('dev-principles');
  });

  it('requires explicit confirmation before saving an access request', () => {
    const storage = memory();
    const reply = answerBuddy('Запроси доступ к Grafana', readWorkspace(storage, 'olga'), 'olga', false, 1000);
    expect(reply.kind).toBe('access_confirmation_required');
    if (reply.kind !== 'access_confirmation_required') throw new Error('Expected a draft');
    const result = confirmAccess(storage, 'olga', reply.draft, 1200);
    expect(result.request.status).toBe('submitted');
    expect(result.request.number).toBe('Д-001');
    expect(readWorkspace(storage, 'olga').requests).toHaveLength(1);
  });

  it('keeps an unauthorized request out of the workspace', () => {
    const storage = memory();
    const reply = answerBuddy('Запроси доступ к Grafana', readWorkspace(storage, 'sasha'), 'sasha');
    expect(reply.kind).toBe('access_denied');
    expect(readWorkspace(storage, 'sasha').requests).toHaveLength(0);
  });

  it('asks for the service when an access question is ambiguous', () => {
    const storage = memory();
    const reply = answerBuddy('Запроси доступ', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('clarification');
    if (reply.kind !== 'clarification') throw new Error('Expected clarification');
    expect(reply.awaitingService).toBe(true);
  });

  it('answers about a service that is already available', () => {
    const storage = memory();
    const reply = answerBuddy('Как работать в Figma?', readWorkspace(storage, 'maria'), 'maria');
    expect(reply.kind).toBe('answer');
    expect(reply.text).toContain('Figma');
    expect(reply.link?.to).toContain('/tools?service=figma');
  });

  it('answers the tools suggestion with the current role catalog', () => {
    const reply = answerBuddy('Какие инструменты нужны моей команде?', readWorkspace(memory(), 'timur'), 'timur');
    expect(reply.lines?.map((line) => line.split(' — ')[0])).toEqual([
      'Тест-кейсы · TMS',
      'Postman',
      'Тестовый стенд Автотеки',
    ]);
    expect(reply.link?.to).toBe('/tools');
  });

  it('returns team contacts for a team question', () => {
    const storage = memory();
    const reply = answerBuddy('Кто мой наставник?', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('answer');
    expect(reply.lines).toHaveLength(2);
    expect(reply.lines?.[0]).toContain('Алексей');
    const combined = answerBuddy('Кто мой лид и где почитать о продукте?', readWorkspace(storage, 'olga'), 'olga');
    expect(combined.lines?.[0]).toContain('Алексей');
    expect(combined.link?.to).toBe('/product-guide');
  });

  it('returns references for document and HR questions', () => {
    const storage = memory();
    const documentReply = answerBuddy('Где подписать документы?', readWorkspace(storage, 'olga'), 'olga');
    const timeOffReply = answerBuddy('Как оформить отгул?', readWorkspace(storage, 'olga'), 'olga');
    expect(documentReply.link?.to).toBe('http://localhost:5187/');
    expect(timeOffReply.link?.to).toBe('http://localhost:5181/');
  });

  it('returns a clarification for an unknown question', () => {
    const storage = memory();
    const reply = answerBuddy('Расскажи секретный прогноз', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('clarification');
    expect(reply.text).toContain('нет подходящей инструкции');
  });

  it('toggles a completed task back to pending and rejects unknown tasks', () => {
    const storage = memory();
    const completed = toggleTask(storage, 'olga', 'dev-principles');
    const pending = toggleTask(storage, 'olga', 'dev-principles');
    expect(completed.completed).toContain('dev-principles');
    expect(pending.completed).not.toContain('dev-principles');
    expect(() => toggleTask(storage, 'olga', 'missing-task')).toThrow('Задача недоступна.');
    expect(toggleTask(storage, 'olga', 'extra-review').completed).toContain('extra-review');
    expect(readWorkspace(storage, 'olga').completed).toContain('extra-review');
  });

  it('falls back when saved workspace data is malformed', () => {
    const storage = memory();
    storage.setItem('ai-buddy.workspace.olga', '{broken');
    expect(readWorkspace(storage, 'olga').requests).toEqual([]);
    expect(readWorkspace(storage, 'olga').completed).toContain('meet-team');
    storage.setItem(
      'ai-buddy.workspace.olga',
      JSON.stringify({
        completed: ['papers', 'welcome'],
        requests: [{ id: 'kept', number: 'Д-009', serviceId: 'jira', status: 'submitted' }],
      }),
    );
    const reset = readWorkspace(storage, 'olga');
    expect(reset.completed).toContain('meet-team');
    expect(reset.completed).not.toContain('papers');
    expect(reset.requests).toEqual([{ id: 'kept', number: 'Д-009', serviceId: 'jira', status: 'submitted' }]);
    expect(JSON.parse(storage.getItem('ai-buddy.workspace.olga') || '{}').completed).toContain('meet-team');
  });

  it('rejects an expired draft and protects another profile', () => {
    const storage = memory();
    const draft: AccessDraft = { id: 'draft', profileId: 'olga', serviceId: 'grafana', expiresAt: 100 };
    expect(() => confirmAccess(storage, 'olga', draft, 101)).toThrow('Черновик истёк.');
    expect(() => confirmAccess(storage, 'sasha', draft, 0)).toThrow('заявка недоступна');
  });

  it('returns an existing request without duplicating it', () => {
    const storage = memory();
    const draft: AccessDraft = { id: 'draft', profileId: 'olga', serviceId: 'grafana', expiresAt: 1000 };
    const first = confirmAccess(storage, 'olga', draft, 10);
    const second = confirmAccess(storage, 'olga', draft, 20);
    expect(second.request).toEqual(first.request);
    expect(readWorkspace(storage, 'olga').requests).toHaveLength(1);
  });

  it('returns full progress when every task is complete', () => {
    const complete = { completed: tasksFor('olga').map((task) => task.id), requests: [] };
    expect(progressFor(complete)).toEqual({ completed: tasksFor('olga').length, remaining: 0, percent: 100 });
  });
  it.each(Object.values(products))('uses $name and its team and role in demo answers and materials', (product) => {
    const id = product.intern;
    const workspace = readWorkspace(memory(), id);
    const firstSteps = answerBuddy('С чего начать?', workspace, id);
    expect(firstSteps.text).toContain(product.name);
    expect(firstSteps.text).toContain(product.team);
    expect(firstSteps.text).toContain(profiles[id].position.toLowerCase());
    expect(firstSteps.text).toContain(product.firstStep);

    const contacts = answerBuddy('Кто мой наставник?', workspace, id);
    expect(contacts.lines?.join(' ')).toContain(staffAccounts[product.mentor].name);
    expect(contacts.lines?.join(' ')).toContain(staffAccounts[product.manager].name);
    expect(contacts.lines).toHaveLength(2);
  });
});

it('completes a task idempotently without undoing it or affecting another profile', () => {
  const storage = memory();
  const other = readWorkspace(storage, 'sasha');
  const done = completeTask(storage, 'olga', 'practice-memo');
  expect(done.completed).toContain('practice-memo');
  expect(completeTask(storage, 'olga', 'practice-memo')).toEqual(done);
  expect(readWorkspace(storage, 'olga')).toEqual(done);
  expect(readWorkspace(storage, 'sasha')).toEqual(other);
  expect(done.requests).toEqual([]);
  expect(() => completeTask(storage, 'olga', 'not-a-task')).toThrow('Задача недоступна');
});

it('finds the configured absence service for navigation without generating an agent answer', () => {
  const link = absenceServiceLink('Как оформить отгул?');
  expect(link).toEqual({ label: 'Открыть «Отсутствия»', to: 'http://localhost:5181/' });
  expect(absenceServiceLink('Хочу оформить отпуск')).toEqual(link);
  expect(absenceServiceLink('Открой сервис отсутствий')).toEqual(link);
  expect(absenceServiceLink('Сколько дней отпуска осталось?')).toBeUndefined();
  expect(absenceServiceLink('Кто мой наставник?')).toBeUndefined();
});

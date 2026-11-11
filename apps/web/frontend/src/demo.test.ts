import { describe, expect, it } from 'vitest';
import {
  answerBuddy,
  confirmAccess,
  progressFor,
  readWorkspace,
  serviceStatus,
  toggleTask,
  type AccessDraft,
  type StoragePort,
} from './demo';
import { services, tasks } from './data';

type Memory = StoragePort & { data: Map<string, string> };
function memory(): Memory {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe('AI-buddy demo workspace', () => {
  it('persists a completed onboarding task and recalculates progress', () => {
    const storage = memory();
    const initial = readWorkspace(storage, 'olga');
    const updated = toggleTask(storage, 'olga', 'papers');
    expect(updated.completed).toContain('papers');
    expect(progressFor(updated).completed).toBe(progressFor(initial).completed + 1);
    expect(readWorkspace(storage, 'olga').completed).toContain('papers');
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
    const reply = answerBuddy('Как работать в Figma?', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('answer');
    expect(reply.text).toContain('Figma');
    expect(reply.link?.to).toContain('/tools?service=figma');
  });

  it('returns team contacts for a team question', () => {
    const storage = memory();
    const reply = answerBuddy('Кто мой наставник?', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('answer');
    expect(reply.lines).toHaveLength(2);
    expect(reply.lines?.[0]).toContain('Алексей');
  });

  it('returns references for document and HR questions', () => {
    const storage = memory();
    const documentReply = answerBuddy('Где подписать документы?', readWorkspace(storage, 'olga'), 'olga');
    const timeOffReply = answerBuddy('Как оформить отгул?', readWorkspace(storage, 'olga'), 'olga');
    expect(documentReply.link?.to).toBe('/resources?article=documents');
    expect(timeOffReply.link?.to).toBe('/resources?article=timeoff');
  });

  it('returns a clarification for an unknown question', () => {
    const storage = memory();
    const reply = answerBuddy('Расскажи секретный прогноз', readWorkspace(storage, 'olga'), 'olga');
    expect(reply.kind).toBe('clarification');
    expect(reply.text).toContain('нет подходящей инструкции');
  });

  it('toggles a completed task back to pending and rejects unknown tasks', () => {
    const storage = memory();
    const completed = toggleTask(storage, 'olga', 'papers');
    const pending = toggleTask(storage, 'olga', 'papers');
    expect(completed.completed).toContain('papers');
    expect(pending.completed).not.toContain('papers');
    expect(() => toggleTask(storage, 'olga', 'missing-task')).toThrow('Задача недоступна.');
  });

  it('falls back when saved workspace data is malformed', () => {
    const storage = memory();
    storage.setItem('ai-buddy.workspace.olga', '{broken');
    expect(readWorkspace(storage, 'olga').requests).toEqual([]);
    expect(readWorkspace(storage, 'olga').completed).toContain('welcome');
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

  it('reports submitted access status and reaches full progress', () => {
    const storage = memory();
    const draft: AccessDraft = { id: 'draft', profileId: 'olga', serviceId: 'grafana', expiresAt: 1000 };
    const { workspace } = confirmAccess(storage, 'olga', draft, 10);
    expect(
      serviceStatus(
        workspace,
        services.find((service) => service.id === 'grafana')!,
      ),
    ).toBe('submitted');
    const complete = { completed: tasks.map((task) => task.id), requests: [] };
    expect(progressFor(complete)).toEqual({ completed: tasks.length, remaining: 0, percent: 100 });
  });
});

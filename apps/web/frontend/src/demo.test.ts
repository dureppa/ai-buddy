import { describe, expect, it } from 'vitest';
import { answerBuddy, confirmAccess, progressFor, readWorkspace, toggleTask, type StoragePort } from './demo';

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
});

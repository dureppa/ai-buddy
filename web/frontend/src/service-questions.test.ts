import { describe, expect, it, vi } from 'vitest';
import { readServiceQuestions, saveServiceQuestion, serviceQuestionsKey } from './service-questions';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('service questions', () => {
  it('saves a trimmed question for the current profile and keeps it first', () => {
    const storage = memoryStorage();
    const first = saveServiceQuestion(storage, 'olga', '  Где статус заявки?  ');
    const second = saveServiceQuestion(storage, 'olga', 'Как открыть инструкцию?');

    expect(first.text).toBe('Где статус заявки?');
    expect(readServiceQuestions(storage, 'olga').map((item) => item.text)).toEqual([
      'Как открыть инструкцию?',
      'Где статус заявки?',
    ]);
    expect(readServiceQuestions(storage, 'olga')[0]?.id).toBe(second.id);
    expect(JSON.parse(storage.getItem(serviceQuestionsKey) ?? '[]')).toHaveLength(2);
  });

  it('keeps questions of other profiles and drops unreadable entries', () => {
    const storage = memoryStorage({
      [serviceQuestionsKey]: JSON.stringify([
        { id: 'sasha-1', profileId: 'sasha', text: 'Вопрос Саши', createdAt: '2026-11-14T10:00:00.000Z' },
        { id: 'broken', profileId: 'olga', text: ' ', createdAt: 'not-a-date' },
        'not-an-object',
      ]),
    });

    const saved = saveServiceQuestion(storage, 'olga', 'Мой вопрос');
    const stored = JSON.parse(storage.getItem(serviceQuestionsKey) ?? '[]') as { id: string }[];

    expect(readServiceQuestions(storage, 'olga').map((item) => item.id)).toEqual([saved.id]);
    expect(readServiceQuestions(storage, 'sasha').map((item) => item.text)).toEqual(['Вопрос Саши']);
    expect(stored.map((item) => item.id)).toEqual([saved.id, 'sasha-1']);
  });

  it('saves a question when the page is not a secure context', () => {
    const storage = memoryStorage();
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not a function');
    });
    const saved = saveServiceQuestion(storage, 'olga', 'Где инструкция?');
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    randomUUID.mockRestore();
  });

  it('rejects an empty, short or too long question and leaves storage unchanged', () => {
    const storage = memoryStorage({ [serviceQuestionsKey]: '[]' });

    expect(() => saveServiceQuestion(storage, 'olga', '  ')).toThrow('Напиши вопрос от 2 до 1000 символов.');
    expect(() => saveServiceQuestion(storage, 'olga', 'я')).toThrow('Напиши вопрос от 2 до 1000 символов.');
    expect(() => saveServiceQuestion(storage, 'olga', 'а'.repeat(1001))).toThrow(
      'Напиши вопрос от 2 до 1000 символов.',
    );
    expect(storage.getItem(serviceQuestionsKey)).toBe('[]');
    expect(readServiceQuestions(memoryStorage({ [serviceQuestionsKey]: '{' }), 'olga')).toEqual([]);
  });
});

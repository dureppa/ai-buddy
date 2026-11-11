import { describe, expect, it } from 'vitest';
import { answerFromPage } from './assistant';

describe('floating Buddy answers', () => {
  it('explains the tools page when the question is about access', () => {
    const answer = answerFromPage('Где запросить доступ?', { url: 'http://localhost:5173/tools', title: 'Инструменты' });
    expect(answer.text).toContain('выбери карточку');
  });

  it('uses selected text as page context', () => {
    const answer = answerFromPage('Что это значит?', { title: 'Документ', selectedText: 'Первый рабочий день' });
    expect(answer.text).toContain('Первый рабочий день');
  });
});

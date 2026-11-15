import { describe, expect, it } from 'vitest';
import { answerFromPage } from './assistant';

describe('floating Buddy answers', () => {
  it('explains the tools page when the question is about access', () => {
    const answer = answerFromPage('Где запросить доступ?', {
      url: 'http://localhost:5173/tools',
      title: 'Инструменты',
    });
    expect(answer.text).toContain('выбери карточку');
  });

  it('uses selected text as page context', () => {
    const answer = answerFromPage('Что это значит?', { title: 'Документ', selectedText: 'Первый рабочий день' });
    expect(answer.text).toContain('Первый рабочий день');
  });

  it('uses the page title for navigation questions', () => {
    const answer = answerFromPage('Куда нажать?', { title: 'Каталог инструментов' });
    expect(answer.text).toContain('Каталог инструментов');
    expect(answer.source).toBe('Каталог инструментов');
  });

  it('truncates long selected text in an answer', () => {
    const answer = answerFromPage('Что это?', { selectedText: 'x'.repeat(220), title: 'Документ' });
    expect(answer.text).toContain('…');
    expect(answer.text.length).toBeLessThan(260);
  });

  it('suggests the tools section for an access question outside the app', () => {
    const answer = answerFromPage('Как получить доступ?', { url: 'https://example.com' });
    expect(answer.text).toContain('Инструменты и доступы');
  });

  it('uses the generic page answer for a greeting', () => {
    const answer = answerFromPage('Привет', { title: 'Главная' });
    expect(answer.text).toContain('текущую страницу');
  });
});

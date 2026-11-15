import { describe, expect, it } from 'vitest';
import { getPageHelp } from './context';

describe('extension page context', () => {
  it('explains access controls on the supported tools page', () => {
    expect(getPageHelp('http://localhost:5173/tools', 'http://localhost:5173/', 'Где запросить доступ?')).toContain(
      'карточку',
    );
  });

  it('does not pretend to understand an unsupported page', () => {
    expect(getPageHelp('https://example.com/work', 'http://localhost:5173/', 'Где здесь доступ?')).toContain(
      'незнакома',
    );
  });

  it('supports the same tools page on a different localhost port', () => {
    expect(getPageHelp('http://127.0.0.1:4173/tools/', 'http://localhost:4173/', 'Как работать?')).toContain(
      'карточку',
    );
  });

  it('handles missing and malformed tab URLs', () => {
    expect(getPageHelp(undefined, 'http://localhost:5173/', 'Что делать?')).toContain('Открой страницу');
    expect(getPageHelp('not-a-url', 'http://localhost:5173/', 'Что делать?')).toContain('незнакома');
  });
});

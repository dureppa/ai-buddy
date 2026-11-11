import { describe, expect, it } from 'vitest';
import { getPageHelp } from './context';

describe('extension page context', () => {
  it('explains access controls on the supported tools page', () => {
    expect(getPageHelp('http://localhost:5173/tools', 'http://localhost:5173/', 'Где запросить доступ?')).toContain('карточку');
  });

  it('does not pretend to understand an unsupported page', () => {
    expect(getPageHelp('https://example.com/work', 'http://localhost:5173/', 'Где здесь доступ?')).toContain('незнакома');
  });
});

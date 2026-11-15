import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAnswer, cleanAnswer } from './AgentAnswer';

const references = [
  { title: 'Команда', url: '/team' },
  { title: 'Чек-лист', url: '/onboarding' },
];

it('formats real legacy answer without leaking source and task annotations', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer
      text={
        "**Наставник:** Анна [team:delivery].\n\n**С чего начать:**\n1. Подписать документы (id 'papers') [onboarding:olga].\n2. Познакомиться с лидом."
      }
      references={references}
    />,
  );
  expect(html).toContain('<strong>Наставник:</strong>');
  expect(html).toContain('<ol>');
  expect(html).not.toContain('**');
  expect(html).not.toContain('[team:');
  expect(html).not.toContain('papers');
  expect(html.match(/class="agent-source"/g)).toHaveLength(2);
});
it('preserves user content and unregistered annotations without matching sources', () => {
  expect(cleanAnswer("Ответ [unknown] (id 'papers')", [])).toBe("Ответ [unknown] (id 'papers')");
  expect(cleanAnswer('Отпуск [timeoff].', [{ title: 'Отпуск', url: '/resources?article=timeoff' }])).toBe('Отпуск.');
});
it('formats paragraphs, bullets, headings and code without executing HTML', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer
      text={'## План\nПервый абзац\nперенос\n\n- **Раз**\n- `два`\n\n```html\n<script>alert(1)</script>\n```'}
    />,
  );
  expect(html).toContain('<ul>');
  expect(html).toContain('<br/>');
  expect(html).toContain('<code>два</code>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
});
it('only links observed safe sources and deduplicates cards', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer
      text={'[Команда](/team) [Неизвестно](https://unknown.example) [Плохо](javascript:alert)'}
      references={[
        ...references,
        references[0],
        { title: 'Атака', url: 'javascript:alert' },
        { title: 'Неверно', url: 'http://%' },
      ]}
    />,
  );
  expect(html.match(/class="agent-source"/g)).toHaveLength(2);
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="https://unknown.example');
  expect(html).toContain('href="/team"');
});
it('keeps business numbers and code blocks intact', () => {
  const text = "Заявка ABC-123.\n```\n[onboarding:olga] (id 'papers')\n```";
  const html = renderToStaticMarkup(<AgentAnswer text={text} references={references} />);
  expect(html).toContain('ABC-123');
  expect(html).toContain('[onboarding:olga]');
  expect(html).toContain('papers');
});
it('splits inline section labels and keeps code spacing', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer
      text={'По данным: **Наставник:** Анна. **План:** Начни здесь.\n\n`SELECT  x [onboarding:olga]`'}
      references={references}
    />,
  );
  expect(html).toContain('<p><strong>Наставник:</strong>');
  expect(html).toContain('<p><strong>План:</strong>');
  expect(html).toContain('SELECT  x [onboarding:olga]');
});
it('preserves numbered list starts and rejects backslash URL escapes', () => {
  const html = renderToStaticMarkup(
    <AgentAnswer text={'3. Третий\n4. Четвёртый'} references={[{ title: 'Атака', url: '/\\evil.example' }]} />,
  );
  expect(html).toContain('<ol start="3">');
  expect(html).not.toContain('class="agent-source"');
});

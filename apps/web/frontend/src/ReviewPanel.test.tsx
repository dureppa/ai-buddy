import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewPanel } from './ReviewPanel';

it('renders the learning task in a styled card with a labelled multiline answer', () => {
  const html = renderToStaticMarkup(<ReviewPanel profileId="maria" />);
  expect(html).toContain('class="panel learning-task"');
  expect(html).toContain('class="learning-task__form"');
  expect(html).toContain('rows="4"');
  expect(html).toContain('Твой ответ');
  expect(html).toContain('Проверить знания');
  expect(html).not.toContain('демопрофиль');
  expect(html).not.toContain('hr-panel');
});

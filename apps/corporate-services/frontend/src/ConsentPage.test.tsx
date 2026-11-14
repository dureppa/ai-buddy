import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsentApi, ConsentPageView } from '../../../../services/hr/consents/frontend/ConsentApi';

const props = {
  profileId: 'maria' as const,
  onProfileChange: () => undefined,
  onToggle: () => undefined,
  items: [
    { purpose: 'news', title: 'Новости', description: 'Обновления', granted: true },
    { purpose: 'photo', title: 'Фотографии', description: 'Публикации', granted: false },
  ],
  pending: false,
  error: '',
  notice: '',
};

it('keeps the full HR layout for live consents and supported profiles', () => {
  const html = renderToStaticMarkup(<ConsentPageView {...props} />);
  expect(html).toContain('class="hr-layout"');
  expect(html).toContain('class="hr-aside"');
  expect(html).toContain('Сохранённое состояние');
  expect(html).toContain('1 из 2');
  expect(html).toContain('aria-label="Отозвать: Новости"');
  expect(html).toContain('aria-label="Разрешить: Фотографии"');
  expect(html).not.toContain('value="timur"');
  expect(html).not.toContain('localhost:5173');
});

it.each([
  { pending: true, error: '', message: 'Загружаем' },
  { pending: false, error: 'Ошибка API', message: 'Ошибка API' },
])('keeps layout and blocks actions when state is uncertain: $message', (state) => {
  const html = renderToStaticMarkup(<ConsentPageView {...props} {...state} />);
  expect(html).toContain('class="hr-layout"');
  expect(html).toContain('class="hr-metric__value">—');
  expect(html).toContain(state.message);
  expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
});

it('renders feedback and an empty confirmed state', () => {
  const html = renderToStaticMarkup(<ConsentPageView {...props} items={[]} notice="Сохранено" />);
  expect(html).toContain('0 из 0');
  expect(html).toContain('role="status"');
  expect(html).toContain('Сохранено');
});

it('initial API rendering includes the full page while fetching', () => {
  const html = renderToStaticMarkup(<ConsentApi profileId="maria" onProfileChange={props.onProfileChange} />);
  expect(html).toContain('class="hr-layout"');
  expect(html).toContain('Загружаем');
});

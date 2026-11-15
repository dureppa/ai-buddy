// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceActionPage } from './ServiceActionPage';
import { decideServiceAction, readServiceAction, type ServiceAction } from './service-actions';

vi.mock('./service-actions', async (original) => ({
  ...(await original<typeof import('./service-actions')>()),
  readServiceAction: vi.fn(),
  decideServiceAction: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const draft: ServiceAction = {
  id,
  service: 'benefits',
  operation: 'request_benefit',
  state: 'prepared',
  title: 'Заявка на спорт',
  fields: [{ label: 'Сумма', value: '5000 ₽' }],
  expires_at: '2099-01-01T00:00:00Z',
  service_url: 'https://benefits.example/',
  result: '',
};
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(readServiceAction).mockReset().mockResolvedValue(draft);
  vi.mocked(decideServiceAction).mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/actions/' + id]}>
          <Routes>
            <Route path="/actions/:actionId" element={<ServiceActionPage profileId="olga" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
async function button(text: string) {
  return vi.waitFor(async () => {
    await act(async () => {});
    const value = [...container.querySelectorAll('button')].find((element) => element.textContent === text);
    if (!value) throw new Error('Missing ' + text);
    return value;
  });
}
async function hasText(text: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain(text);
  });
}

async function clickButton(text: string) {
  const element = await button(text);
  await act(async () => element.click());
}

it('loads without writing, disables pending buttons and displays the confirmed result', async () => {
  let resolve: (value: ServiceAction) => void = () => {};
  vi.mocked(decideServiceAction).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  const confirm = await button('Подтвердить');
  expect(decideServiceAction).not.toHaveBeenCalled();
  await act(async () => confirm.click());
  await hasText('Отправляем…');
  expect(confirm.disabled).toBe(true);
  await act(async () => confirm.click());
  expect(decideServiceAction).toHaveBeenCalledTimes(1);
  expect(decideServiceAction).toHaveBeenCalledWith('olga', id, true);
  await act(async () => resolve({ ...draft, state: 'succeeded', result: 'Заявка сохранена' }));
  await hasText('Заявка сохранена');
  expect(container.textContent).not.toContain('Подтвердить');
});
it('cancels explicitly and does not leave an executable button', async () => {
  vi.mocked(decideServiceAction).mockResolvedValue({ ...draft, state: 'cancelled' });
  await mount();
  await clickButton('Отменить');
  await hasText('Действие отменено.');
  expect(decideServiceAction).toHaveBeenCalledWith('olga', id, false);
  expect(container.textContent).not.toContain('Подтвердить');
});
it('blocks further decisions after a lost response until a successful refresh', async () => {
  await mount();
  await button('Подтвердить');
  vi.mocked(decideServiceAction).mockRejectedValue(new Error('connection lost'));
  vi.mocked(readServiceAction).mockRejectedValue(new Error('offline'));
  await clickButton('Подтвердить');
  await hasText('Не удалось получить результат.');
  expect((await button('Подтвердить')).disabled).toBe(true);
  await clickButton('Обновить состояние');
  expect((await button('Подтвердить')).disabled).toBe(true);
  vi.mocked(readServiceAction).mockResolvedValue({ ...draft, state: 'uncertain' });
  await clickButton('Обновить состояние');
  await hasText('Результат неизвестен.');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(decideServiceAction).toHaveBeenCalledTimes(1);
});
it('shows loading and authentication/read failure without a confirmation button', async () => {
  let reject: (error: Error) => void = () => {};
  vi.mocked(readServiceAction).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  await hasText('Загружаем подтверждение');
  await act(async () => reject(new Error('forbidden')));
  await hasText('Не удалось открыть подтверждение');
  expect(decideServiceAction).not.toHaveBeenCalled();
});
it('reopens an already executing action without sending it again', async () => {
  vi.mocked(readServiceAction).mockResolvedValue({ ...draft, state: 'executing' });
  await mount();
  await hasText('Действие выполняется.');
  expect(container.textContent).not.toContain('Подтвердить');
  expect(decideServiceAction).not.toHaveBeenCalled();
});

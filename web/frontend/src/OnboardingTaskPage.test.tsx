// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { readOnboardingTask } from './onboarding-task';
import { OnboardingTaskPage } from './OnboardingTaskPage';
vi.mock('./onboarding-task', () => ({ readOnboardingTask: vi.fn() }));
it('opens an exact server task, handles loading/error and retries only on click', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/onboarding/tasks/equipment']}>
          <Routes>
            <Route path="/onboarding/tasks/:taskId" element={<OnboardingTaskPage profileId="olga" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  vi.mocked(readOnboardingTask).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({
    id: 'equipment',
    title: 'Проверить технику',
    guidance: 'Проверь микрофон.',
    status: 'pending',
  });
  try {
    await act(async () => render());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).toContain('Не удалось открыть');
    expect(readOnboardingTask).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector('button')!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(readOnboardingTask).toHaveBeenCalledWith('olga', 'equipment');
    expect(container.textContent).toContain('Проверь микрофон.');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/chat');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});

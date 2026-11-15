import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingTaskCard } from './OnboardingTaskPage';
import { readOnboardingTask } from './onboarding-task';

const task = {
  id: 'equipment',
  title: 'Проверить технику',
  guidance: 'Проверь камеру и микрофон.',
  status: 'pending' as const,
  action_url: '/resources?article=equipment',
};
afterEach(() => vi.unstubAllGlobals());
it('reads only the active profile task without performing a business action', async () => {
  const fetch = vi.fn(async (path: string) =>
    Response.json(
      path.includes('/demo/sessions') ? { profile_id: 'maria', access_token: 'synthetic' } : { tasks: [task] },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await readOnboardingTask('maria', 'equipment')).toEqual(task);
  const call = fetch.mock.calls.find(([path]) => path === '/api/v1/onboarding');
  expect(call).toBeDefined();
  expect((fetch.mock.calls as unknown[][]).filter(([path]) => String(path).includes('complete'))).toHaveLength(0);
  await expect(readOnboardingTask('maria', 'ghost')).rejects.toThrow('недоступно');
});
it('rejects invalid ids before fetching and unsafe source responses', async () => {
  const fetch = vi.fn(async () => Response.json({ tasks: [{ ...task, action_url: 'javascript:alert(1)' }] }));
  vi.stubGlobal('fetch', fetch);
  await expect(readOnboardingTask('maria', '../foreign')).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(readOnboardingTask('maria', 'equipment')).rejects.toThrow();
});
it('shows actual guidance/status and avoids a self-loop or completion button', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <OnboardingTaskCard task={task} profileId="maria" />
    </MemoryRouter>,
  );
  expect(html).toContain(task.guidance);
  expect(html).toContain('ещё не выполнено');
  expect(html).not.toContain('Открыть сервис');
  expect(html).not.toContain('>Подтвердить<');
  expect(html).toContain('href="/chat"');
  const done = renderToStaticMarkup(
    <MemoryRouter>
      <OnboardingTaskCard
        task={{ ...task, status: 'completed', action_url: 'http://localhost:5187/' }}
        profileId="maria"
      />
    </MemoryRouter>,
  );
  expect(done).toContain('profile=maria');
  expect(done).toContain('Открыть сервис');
  expect(done).not.toContain('ещё не выполнено');
});

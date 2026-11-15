import { z } from 'zod';
import { apiFetch } from './backend';
import { safeChatUrl } from './chat-links';
import type { ProfileId } from './data';

const taskId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
const taskSchema = z.object({
  id: taskId,
  title: z.string().min(1).max(200),
  guidance: z.string().min(1).max(4000),
  status: z.enum(['pending', 'completed']),
  action_url: z.string().refine(safeChatUrl).nullish(),
});
const responseSchema = z.object({ tasks: z.array(taskSchema) });
export type OnboardingTask = z.infer<typeof taskSchema>;

export async function readOnboardingTask(profile: ProfileId, id: string): Promise<OnboardingTask> {
  taskId.parse(id);
  const response = await apiFetch(profile, '/api/v1/onboarding');
  const task = responseSchema.parse(await response.json()).tasks.find((entry) => entry.id === id);
  if (!task) throw new Error('Задание недоступно в твоём плане.');
  return task;
}

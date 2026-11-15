import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId } from './data';

const safeUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !value.includes('\\') &&
      !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    );
  } catch {
    return false;
  }
});
export const serviceActionSchema = z.object({
  id: z.string().uuid(),
  service: z.enum(['hiring', 'offboarding', 'benefits', 'jira', 'access']),
  operation: z.enum([
    'refer_candidate',
    'set_exit_step',
    'save_exit_draft',
    'request_benefit',
    'request_access',
    'create_jira_issue',
    'update_jira_issue',
  ]),
  state: z.enum(['prepared', 'executing', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired']),
  title: z.string().min(1),
  fields: z.array(z.object({ label: z.string().min(1), value: z.string() })),
  expires_at: z.iso.datetime({ offset: true }),
  service_url: safeUrl,
  result: z.string(),
});
export type ServiceAction = z.infer<typeof serviceActionSchema>;

export async function readServiceAction(profile: ProfileId, id: string): Promise<ServiceAction> {
  const response = await apiFetch(profile, '/api/v1/service-actions/' + z.uuid().parse(id));
  const draft = serviceActionSchema.parse(await response.json());
  if (draft.id !== id) throw new Error('Неверное подтверждение.');
  return draft;
}
export async function decideServiceAction(profile: ProfileId, id: string, confirm: boolean): Promise<ServiceAction> {
  const response = await apiFetch(
    profile,
    '/api/v1/service-actions/' + z.uuid().parse(id) + (confirm ? '/confirm' : '/cancel'),
    {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    },
  );
  const draft = serviceActionSchema.parse(await response.json());
  if (draft.id !== id) throw new Error('Неверное подтверждение.');
  return draft;
}

export function actionMessage(draft: ServiceAction): string {
  return {
    prepared: 'Проверь параметры. Данные изменятся только после подтверждения.',
    executing: 'Действие выполняется. Повторная отправка отключена.',
    succeeded: draft.result || 'Сервис подтвердил сохранение.',
    failed: draft.result || 'Сервис отклонил действие. Обнови данные в чате.',
    uncertain: 'Результат неизвестен. Проверь его в сервисе. Повторной отправки не будет.',
    cancelled: 'Действие отменено.',
    expired: 'Срок подтверждения истёк. Подготовь новое действие в чате.',
  }[draft.state];
}

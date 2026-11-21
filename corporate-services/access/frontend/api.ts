import { z } from 'zod';
import type { AccountId } from '../../../web/frontend/src/demo-accounts';
import { requestSchema, type RequestInput } from './model';
import type { AccessTemplate } from './catalog';

const sessionSchema = z.object({ access_token: z.string().min(1), profile_id: z.string() });
const sessions = new Map<AccountId, Promise<string>>();
export async function portalFetch(account: AccountId, path: string, init: RequestInit = {}): Promise<Response> {
  let token = sessions.get(account);
  if (!token) {
    token = (async () => {
      const response = await fetch('/api/v1/demo/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: account }),
      });
      if (!response.ok) throw new Error('Не удалось войти в сервис. Проверьте доступность сервера.');
      const data = sessionSchema.parse(await response.json());
      if (data.profile_id !== account) throw new Error('Профиль сессии не совпадает.');
      return data.access_token;
    })();
    sessions.set(account, token);
    token.catch(() => sessions.delete(account));
  }
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: 'Bearer ' + (await token) },
  });
  if (response.status === 401) sessions.delete(account);
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? 'Доступ к этому действию или ресурсу не разрешён для вашей команды и должности.'
        : response.status === 409
          ? 'Заявка уже изменена или ключ отправки использован. Обновите список.'
          : response.status === 400
            ? 'Проверьте поля, ключ ресурса и доступный уровень прав.'
            : response.status === 404
              ? 'Ресурс отсутствует или недоступен.'
              : 'Сервис временно недоступен. Попробуйте ещё раз.',
    );
  return response;
}
const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});
const resourceSchema = z.object({ resource_key: z.string(), fields: z.record(z.string(), z.string()) });
const templateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  roles: z.array(z.enum(['analyst', 'backend', 'tester', 'designer'])),
  system: z.string(),
  keyHint: z.string(),
  levels: z.array(z.enum(['read', 'write', 'admin'])).min(1),
  fields: z.array(fieldSchema),
  owner: z.string(),
  resources: z.array(resourceSchema),
});
export const catalogSchema = z.object({
  version: z.number().int().positive(),
  templates: z.array(templateSchema),
  context: z.object({
    profile_id: z.string(),
    product_id: z.enum(['delivery', 'travel', 'autoteca', 'help']),
    job_role: z.enum(['analyst', 'backend', 'tester', 'designer', 'staff']),
    name: z.string(),
    team_name: z.string(),
    can_review: z.boolean(),
  }),
});
export type LiveTemplate = AccessTemplate & { resources: z.infer<typeof resourceSchema>[] };
export function accessClient(account: AccountId) {
  return {
    catalog: async () =>
      catalogSchema.parse(await (await portalFetch(account, '/api/v1/portal-access/catalog')).json()),
    list: async () =>
      z.array(requestSchema).parse(await (await portalFetch(account, '/api/v1/portal-access/requests')).json()),
    submit: async (input: RequestInput, key: string) =>
      requestSchema.parse(
        await (
          await portalFetch(account, '/api/v1/portal-access/requests', {
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            body: JSON.stringify(input),
          })
        ).json(),
      ),
    cancel: async (id: string) =>
      requestSchema.parse(
        await (
          await portalFetch(account, '/api/v1/portal-access/requests/' + encodeURIComponent(id) + '/decision', {
            method: 'POST',
            body: JSON.stringify({ action: 'cancelled', note: '' }),
          })
        ).json(),
      ),
  };
}

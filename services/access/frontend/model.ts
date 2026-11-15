import { z } from 'zod';
import {
  profiles,
  staffAccounts,
  isProfileId,
  isStaffId,
  type AccountId,
  type ProfileId,
  type ProductId,
} from '../../../apps/web/frontend/src/demo-accounts';
import { catalogVersion, templates, type JobRole } from './catalog';

export const inputSchema = z
  .object({
    template_id: z.string().min(1),
    catalog_version: z.literal(1),
    system: z.string().trim().min(1).max(120),
    resource_key: z.string().trim().min(1).max(160),
    justification: z
      .string()
      .trim()
      .min(10, 'Опишите, для какой рабочей задачи нужен доступ (не менее 10 символов).')
      .max(2000),
    permission: z.enum(['read', 'write', 'admin']),
    duration_days: z.number().int().min(1).max(90),
    fields: z.record(z.string(), z.string().trim().max(500)),
  })
  .strict();
export type RequestInput = z.infer<typeof inputSchema>;
export const requestSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  profile_id: z.enum(['olga', 'sasha', 'timur', 'maria']),
  product_id: z.enum(['delivery', 'travel', 'autoteca', 'help']),
  input: inputSchema,
  status: z.enum(['submitted', 'approved', 'rejected', 'cancelled']),
  created_at: z.string().datetime(),
  decision_by: z.string().nullable(),
  decision_note: z.string(),
  decided_at: z.string().datetime().nullable(),
});
export type AccessRequest = z.infer<typeof requestSchema>;
export const statusLabels = {
  submitted: 'Отправлено',
  approved: 'Согласовано',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
};
export const storageKey = 'ai-buddy.access-portal.v1';
export function accountContext(account: AccountId): {
  name: string;
  productId: ProductId;
  role: JobRole | null;
} {
  if (isProfileId(account))
    return {
      name: profiles[account].fullName,
      productId: profiles[account].productId,
      role: ({ olga: 'analyst', sasha: 'backend', timur: 'tester', maria: 'designer' } as const)[account],
    };
  const staff = staffAccounts[account];
  return { name: staff.name, productId: staff.productId, role: null };
}
export function readAccessAccount(cookie: string): AccountId | null {
  const id = cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('ai_buddy_account='))
    ?.slice('ai_buddy_account='.length);
  return id && (isProfileId(id) || isStaffId(id)) ? id : null;
}
export function parseInput(raw: unknown): RequestInput {
  const result = inputSchema.safeParse(raw);
  if (!result.success) throw new Error(result.error.issues[0]?.message || 'Проверьте поля заявки.');
  const input = result.data;
  const template = templates.find((item) => item.id === input.template_id);
  if (!template || input.catalog_version !== catalogVersion)
    throw new Error('Каталог изменился. Выберите ресурс заново.');
  if (!template.levels.includes(input.permission))
    throw new Error('Этот уровень прав недоступен для выбранного ресурса.');
  if (Object.keys(input.fields).some((key) => !template.fields.some((field) => field.key === key)))
    throw new Error('В заявке есть неизвестное дополнительное поле.');
  for (const field of template.fields) {
    const value = input.fields[field.key];
    if (!value || (field.options && !field.options.includes(value)))
      throw new Error('Заполните поле «' + field.label + '».');
    if (field.key.endsWith('_url')) {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error();
      } catch {
        throw new Error('Укажите HTTPS-адрес в поле «' + field.label + '».');
      }
    }
  }
  return input;
}
export function readRequests(storage: Pick<Storage, 'getItem'>): AccessRequest[] {
  const saved = storage.getItem(storageKey);
  if (saved === null) return [];
  try {
    return z.array(requestSchema).parse(JSON.parse(saved));
  } catch {
    throw new Error('Не удалось прочитать сохранённые заявки. Данные не перезаписаны.');
  }
}
export function createRequest(
  existing: AccessRequest[],
  raw: unknown,
  profile: ProfileId,
  id: string,
  now: string,
): AccessRequest[] {
  const input = parseInput(raw);
  if (
    existing.some(
      (item) =>
        item.profile_id === profile &&
        ['submitted', 'approved'].includes(item.status) &&
        item.input.system.toLowerCase() === input.system.toLowerCase() &&
        item.input.resource_key.toLowerCase() === input.resource_key.toLowerCase() &&
        item.input.permission === input.permission,
    )
  )
    throw new Error('Заявка с такими правами на этот ресурс уже существует.');
  const request = requestSchema.parse({
    id,
    number: 'ДОС-' + id.slice(0, 8).toUpperCase(),
    profile_id: profile,
    product_id: profiles[profile].productId,
    input,
    status: 'submitted',
    created_at: now,
    decision_by: null,
    decision_note: '',
    decided_at: null,
  });
  return [request, ...existing];
}
export function changeRequest(existing: AccessRequest[], id: string, actor: AccountId, now: string): AccessRequest[] {
  const item = existing.find((request) => request.id === id);
  if (!item || item.status !== 'submitted') throw new Error('Заявка уже изменена. Обновите список.');
  if (actor !== item.profile_id) throw new Error('Это действие недоступно для текущего профиля.');
  return existing.map((request) =>
    request.id === id ? { ...request, status: 'cancelled', decision_by: actor, decided_at: now } : request,
  );
}
export function visibleRequests(requests: AccessRequest[], actor: AccountId): AccessRequest[] {
  return requests.filter((request) => request.profile_id === actor);
}
export function saveRequests(storage: Pick<Storage, 'setItem'>, requests: AccessRequest[]) {
  storage.setItem(storageKey, JSON.stringify(requests));
}

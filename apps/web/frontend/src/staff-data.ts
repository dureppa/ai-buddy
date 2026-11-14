import { z } from 'zod';
import { tasksFor } from './checklist';
import { services } from './data';
import {
  products,
  profiles,
  staffAccounts,
  isStaffId,
  isProfileId,
  type ProfileId,
  type StaffId,
} from './demo-accounts';
import { readDemoSession } from './demo-session';
import { progressFor, readWorkspace, type StoragePort } from './demo';

export const materialsKey = 'ai-buddy.staff-materials';
export const maxMaterialBytes = 1024 * 1024;

const profileSchema = z.custom<ProfileId>((value) => typeof value === 'string' && isProfileId(value));
const staffSchema = z.custom<StaffId>((value) => typeof value === 'string' && isStaffId(value));
const webLink = z.url({ protocol: /^https?$/ });
const dataFile =
  /^data:(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain|image\/png|image\/jpeg);base64,[\w+/]+=*$/;
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), href: webLink }),
  z.object({
    kind: z.literal('file'),
    href: z
      .string()
      .max(Math.ceil(maxMaterialBytes / 3) * 4 + 100)
      .regex(dataFile),
    name: z.string().min(1).max(255),
  }),
]);

const materialSchema = z.object({
  id: z.string().min(1),
  author: staffSchema,
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(420),
  audience: z.array(profileSchema).min(1),
  source: sourceSchema,
});

export type StaffMaterial = z.infer<typeof materialSchema>;
export type MaterialInput = Omit<StaffMaterial, 'id' | 'author'>;

export function readStaffId(storage: Pick<Storage, 'getItem'>): StaffId | null {
  const account = readDemoSession(storage);
  return account && isStaffId(account) ? account : null;
}

export function internOverview(storage: StoragePort, staff: StaffId) {
  const id = products[staffAccounts[staff].productId].intern;
  const workspace = readWorkspace(storage, id);
  const checklist = tasksFor(id).map((task) => ({ ...task, done: workspace.completed.includes(task.id) }));
  const requests = workspace.requests.flatMap((request) => {
    const service = services.find((item) => item.id === request.serviceId);
    return service ? [{ ...request, title: service.title, owner: service.owner }] : [];
  });
  return [
    {
      id,
      profile: profiles[id],
      progress: progressFor(workspace),
      checklist,
      next: checklist.find((item) => !item.done),
      requests,
    },
  ];
}

export function readMaterials(storage: StoragePort): StaffMaterial[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(materialsKey) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const parsed = materialSchema.safeParse(entry);
      if (!parsed.success) return [];
      const material = parsed.data;
      const intern = products[staffAccounts[material.author].productId].intern;
      return material.audience.includes(intern) ? [{ ...material, audience: [intern] }] : [];
    });
  } catch {
    return [];
  }
}

export function materialsFor(storage: StoragePort, profile: ProfileId) {
  return readMaterials(storage).filter((item) => item.audience.includes(profile));
}

export function saveMaterial(storage: StoragePort, author: StaffId, input: MaterialInput, id?: string) {
  const entries = readMaterials(storage);
  if (id && !entries.some((item) => item.id === id && item.author === author)) {
    throw new Error('Публикация недоступна для редактирования.');
  }
  const parsed = materialSchema.safeParse({ ...input, id: id ?? globalThis.crypto.randomUUID(), author });
  if (!parsed.success) throw new Error('Проверь название, пояснение, аудиторию и ссылку или файл.');
  const intern = products[staffAccounts[author].productId].intern;
  if (parsed.data.audience.some((profile) => profile !== intern)) {
    throw new Error('Можно публиковать только для своих стажёров.');
  }
  const data = { ...parsed.data, audience: [...new Set(parsed.data.audience)] };
  storage.setItem(materialsKey, JSON.stringify([data, ...entries.filter((item) => item.id !== id)]));
}

export function removeMaterial(storage: StoragePort, author: StaffId, id: string) {
  const entries = readMaterials(storage);
  if (!entries.some((item) => item.id === id && item.author === author)) {
    throw new Error('Публикация недоступна для удаления.');
  }
  storage.setItem(materialsKey, JSON.stringify(entries.filter((item) => item.id !== id)));
}

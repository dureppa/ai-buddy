import { z } from 'zod';
import { profiles, services, tasks, type ProfileId } from './data';
import { progressFor, readWorkspace, type StoragePort } from './demo';

export const staffAccounts = {
  mentor: { name: 'Анна Ким', initials: 'АК', role: 'Наставник', interns: ['olga', 'sasha'] },
  manager: { name: 'Алексей Морозов', initials: 'АМ', role: 'Руководитель', interns: ['olga', 'sasha', 'maria'] },
} as const satisfies Record<string, { name: string; initials: string; role: string; interns: readonly ProfileId[] }>;
export type StaffId = keyof typeof staffAccounts;
export const accountStorageKey = 'ai-buddy.profile';
export const materialsKey = 'ai-buddy.staff-materials';
export const maxMaterialBytes = 1024 * 1024;

const profileSchema = z.enum(['olga', 'sasha', 'maria']);
const staffSchema = z.enum(['mentor', 'manager']);
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
  const candidate = staffSchema.safeParse(storage.getItem(accountStorageKey));
  return candidate.success ? candidate.data : null;
}

export function internOverview(storage: StoragePort, staff: StaffId) {
  return staffAccounts[staff].interns.map((id) => {
    const workspace = readWorkspace(storage, id);
    const checklist = tasks.map((task) => ({ ...task, done: workspace.completed.includes(task.id) }));
    const requests = workspace.requests.flatMap((request) => {
      const service = services.find((item) => item.id === request.serviceId);
      return service ? [{ ...request, title: service.title, owner: service.owner }] : [];
    });
    return {
      profile: profiles[id],
      progress: progressFor(workspace),
      checklist,
      next: checklist.find((item) => !item.done),
      requests,
    };
  });
}

export function readMaterials(storage: StoragePort): StaffMaterial[] {
  try {
    const result = z.array(materialSchema).safeParse(JSON.parse(storage.getItem(materialsKey) || '[]'));
    return result.success ? result.data : [];
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
  const allowed: readonly ProfileId[] = staffAccounts[author].interns;
  if (parsed.data.audience.some((profile) => !allowed.includes(profile))) {
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

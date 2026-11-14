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
  group: z.string().trim().min(2).max(40).default('Общее'),
  source: sourceSchema,
});

export type StaffMaterial = z.infer<typeof materialSchema>;
export type MaterialInput = Omit<StaffMaterial, 'id' | 'author'>;
export const materialGroupSuggestions = ['Чаты', 'Документы', 'Встречи'] as const;

const baselineChats = {
  delivery: {
    title: 'Общий чат для всех сотрудников Авито Доставки',
    href: 'https://chat.delivery.example/all',
  },
  travel: {
    title: 'Общий чат для всех сотрудников Авито Путешествия',
    href: 'https://chat.travel.example/all',
  },
  autoteca: {
    title: 'Общий чат для всех сотрудников Автотеки',
    href: 'https://chat.autoteca.example/all',
  },
  help: {
    title: 'Общий чат для всех сотрудников #яПомогаю',
    href: 'https://chat.help.example/all',
  },
} as const;

export type ShownMaterial = {
  id: string;
  group: string;
  title: string;
  description: string;
  source: StaffMaterial['source'];
  author: string;
};

export function baselineFor(profile: ProfileId): ShownMaterial[] {
  const productId = profiles[profile].productId;
  const chat = baselineChats[productId];
  return [
    {
      id: 'baseline-' + productId + '-chat',
      group: 'Чаты',
      title: chat.title,
      description: 'Общий канал: объявления, вопросы и ссылки, которые нужны с первого дня.',
      source: { kind: 'link', href: chat.href },
      author: 'Базовый',
    },
  ];
}

export function groupByName<T extends { group: string }>(items: readonly T[]) {
  const groups: { name: string; items: T[] }[] = [];
  for (const item of items) {
    const existing = groups.find((group) => group.name === item.group);
    if (existing) existing.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  return groups;
}

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

export function internMaterials(storage: StoragePort, profile: ProfileId): ShownMaterial[] {
  const published = materialsFor(storage, profile).map((item) => ({
    id: item.id,
    group: item.group,
    title: item.title,
    description: item.description,
    source: item.source,
    author: staffAccounts[item.author].name,
  }));
  return [...baselineFor(profile), ...published];
}

function newMaterialId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function saveMaterial(storage: StoragePort, author: StaffId, input: MaterialInput, id?: string) {
  const entries = readMaterials(storage);
  if (id && !entries.some((item) => item.id === id && item.author === author)) {
    throw new Error('Публикация недоступна для редактирования.');
  }
  const parsed = materialSchema.safeParse({ ...input, id: id ?? newMaterialId(), author });
  if (!parsed.success) throw new Error('Проверь название, группу, пояснение, аудиторию и ссылку или файл.');
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

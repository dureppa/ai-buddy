import { resourceKit } from './resource-kits';
import { z } from 'zod';
import { stages, tasksFor, type StageId, type Task } from './checklist';
import {
  products,
  teamInterns,
  profiles,
  staffAccounts,
  isStaffId,
  isProfileId,
  type ProfileId,
  type StaffId,
} from './demo-accounts';
import type { ChecklistPlan } from './role-checklist-api';
import { readDemoSession } from './demo-session';
import { readWorkspace, type StoragePort } from './demo';

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
export const materialGroupSuggestions = ['Чаты', 'Доступы', 'Документы', 'Встречи'] as const;

export function materialGroupChoices(existing: readonly string[]) {
  const choices: string[] = [];
  for (const name of [...existing, ...materialGroupSuggestions]) {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 40 || choices.includes(trimmed)) continue;
    choices.push(trimmed);
  }
  return choices;
}

export type ShownMaterial = {
  id: string;
  group: string;
  title: string;
  description: string;
  source: StaffMaterial['source'];
  author: string;
};

export function baselineFor(profile: ProfileId): ShownMaterial[] {
  return resourceKit(profile);
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

export type ChecklistEntry = Task & { custom: boolean; materialIds: string[]; done: boolean };

export function internOverview(storage: StoragePort, staff: StaffId, plans?: readonly ChecklistPlan[]) {
  const ids = plans
    ? plans.map((plan) => plan.profile_id).filter(isProfileId)
    : teamInterns(staffAccounts[staff].productId);
  return ids.map((id) => {
    const plan = plans?.find((entry) => entry.profile_id === id);
    const checklist = checklistFor(storage, id, plan);
    const completed = plan?.completed.length ?? checklist.filter((item) => item.done).length;
    const total = plan?.total ?? checklist.length;
    return {
      id,
      profile: profiles[id],
      progress: {
        completed,
        remaining: total - completed,
        percent: plan?.percent ?? (total ? Math.round((completed / total) * 100) : 0),
      },
      checklist,
      next: checklist.find((item) => !item.done),
    };
  });
}

export function readMaterials(storage: StoragePort): StaffMaterial[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(materialsKey) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const parsed = materialSchema.safeParse(entry);
      if (!parsed.success) return [];
      const material = parsed.data;
      const allowed = teamInterns(staffAccounts[material.author].productId);
      const audience = material.audience.filter((id) => allowed.includes(id));
      return audience.length ? [{ ...material, audience }] : [];
    });
  } catch {
    return [];
  }
}

export function materialsFor(storage: StoragePort, profile: ProfileId) {
  return readMaterials(storage).filter((item) => item.audience.includes(profile));
}

export function publishedForIntern(storage: StoragePort, profile: ProfileId): ShownMaterial[] {
  return materialsFor(storage, profile).map((item) => ({
    id: item.id,
    group: item.group,
    title: item.title,
    description: item.description,
    source: item.source,
    author: staffAccounts[item.author].name,
  }));
}

export function internMaterials(storage: StoragePort, profile: ProfileId): ShownMaterial[] {
  return [...baselineFor(profile), ...publishedForIntern(storage, profile)];
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
  const allowed = teamInterns(staffAccounts[author].productId);
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

export const checklistEditsKey = 'ai-buddy.checklist-edits';

const stageSchema = z.enum(['week-1', 'week-2', 'month-1', 'month-2', 'month-3', 'after-3']);
const extraSchema = z.object({
  id: z.string().regex(/^extra-/),
  profileId: profileSchema,
  stage: stageSchema,
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(2).max(240),
  materialIds: z.array(z.string().min(1)).default([]),
});
const linkSchema = z.object({
  profileId: profileSchema,
  taskId: z.string().min(1),
  materialIds: z.array(z.string().min(1)),
});
type ChecklistExtra = z.infer<typeof extraSchema>;
type ChecklistLink = z.infer<typeof linkSchema>;
export type ChecklistItemInput = { title: string; summary: string; stage: StageId };

function readEdits(storage: StoragePort) {
  try {
    const stored: unknown = JSON.parse(storage.getItem(checklistEditsKey) || '{}');
    const record = stored && typeof stored === 'object' ? (stored as { extras?: unknown; links?: unknown }) : {};
    const extras = Array.isArray(record.extras)
      ? record.extras.flatMap((entry) => {
          const parsed = extraSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    const links = Array.isArray(record.links)
      ? record.links.flatMap((entry) => {
          const parsed = linkSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return { extras, links };
  } catch {
    return { extras: [] as ChecklistExtra[], links: [] as ChecklistLink[] };
  }
}

function writeEdits(storage: StoragePort, edits: { extras: ChecklistExtra[]; links: ChecklistLink[] }) {
  storage.setItem(checklistEditsKey, JSON.stringify(edits));
}

function internOf(staff: StaffId, selected?: ProfileId) {
  const profile = selected ?? products[staffAccounts[staff].productId].intern;
  if (!teamInterns(staffAccounts[staff].productId).includes(profile)) {
    throw new Error('Можно изменять только чек-листы своих стажёров.');
  }
  return profile;
}

export function checklistFor(storage: StoragePort, profile: ProfileId, plan?: ChecklistPlan): ChecklistEntry[] {
  const completed = plan?.completed ?? readWorkspace(storage, profile).completed;
  const edits = readEdits(storage);
  const links = new Map(
    edits.links.filter((link) => link.profileId === profile).map((link) => [link.taskId, link.materialIds]),
  );
  const base = tasksFor(profile).map((task) => ({
    ...task,
    custom: false,
    materialIds: links.get(task.id) ?? [],
    done: completed.includes(task.id),
  }));
  const extras = (plan?.extras ?? edits.extras.filter((item) => item.profileId === profile)).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    details: item.summary,
    due: stages.find((stage) => stage.id === item.stage)?.name ?? item.stage,
    owner: 'Команда',
    stage: item.stage,
    icon: 'book' as const,
    tone: 'lilac' as const,
    custom: true,
    materialIds:
      links.get(item.id) ??
      edits.extras.find((extra) => extra.id === item.id && extra.profileId === profile)?.materialIds ??
      [],
    done: completed.includes(item.id),
  }));
  return [...base, ...extras];
}

export function materialsForTask(storage: StoragePort, profile: ProfileId, taskId: string, plan?: ChecklistPlan) {
  const item = checklistFor(storage, profile, plan).find((entry) => entry.id === taskId);
  if (!item) return [];
  const available = new Map(internMaterials(storage, profile).map((material) => [material.id, material]));
  return item.materialIds.flatMap((id) => {
    const material = available.get(id);
    return material ? [material] : [];
  });
}

export function addChecklistItem(
  storage: StoragePort,
  staff: StaffId,
  input: ChecklistItemInput,
  selected?: ProfileId,
) {
  const profileId = internOf(staff, selected);
  const edits = readEdits(storage);
  const parsed = extraSchema.safeParse({ ...input, id: newExtraId(), profileId, materialIds: [] });
  if (!parsed.success) throw new Error('Проверь название, пояснение и период.');
  writeEdits(storage, { ...edits, extras: [parsed.data, ...edits.extras] });
  return parsed.data;
}

export function removeChecklistItem(storage: StoragePort, staff: StaffId, taskId: string, selected?: ProfileId) {
  const profileId = internOf(staff, selected);
  const edits = readEdits(storage);
  if (!edits.extras.some((item) => item.id === taskId && item.profileId === profileId)) {
    throw new Error('Можно удалить только добавленный пункт.');
  }
  writeEdits(storage, { ...edits, extras: edits.extras.filter((item) => item.id !== taskId) });
}

export function setTaskMaterials(
  storage: StoragePort,
  staff: StaffId,
  taskId: string,
  materialIds: readonly string[],
  plan?: ChecklistPlan,
  selected?: ProfileId,
) {
  const profileId = internOf(staff, selected ?? (plan && isProfileId(plan.profile_id) ? plan.profile_id : undefined));
  if (plan && plan.profile_id !== profileId) throw new Error('Чек-лист принадлежит другому стажёру.');
  const checklist = checklistFor(storage, profileId, plan);
  const task = checklist.find((item) => item.id === taskId);
  if (!task) throw new Error('Пункт чек-листа не найден.');
  const allowed = new Set(internMaterials(storage, profileId).map((material) => material.id));
  const unique = [...new Set(materialIds)];
  if (unique.some((id) => !allowed.has(id))) throw new Error('Можно указать только материалы этого стажёра.');
  const edits = readEdits(storage);
  if (task.custom && !plan) {
    writeEdits(storage, {
      ...edits,
      extras: edits.extras.map((item) => (item.id === taskId ? { ...item, materialIds: unique } : item)),
    });
    return;
  }
  const links = edits.links.filter((link) => !(link.profileId === profileId && link.taskId === taskId));
  writeEdits(storage, {
    ...edits,
    links: unique.length ? [{ profileId, taskId, materialIds: unique }, ...links] : links,
  });
}

function newExtraId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `extra-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

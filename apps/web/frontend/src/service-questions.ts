import { z } from 'zod';
import { isProfileId, type ProfileId } from './demo-accounts';
import type { StoragePort } from './demo';

export const serviceQuestionsKey = 'ai-buddy.service-questions';

const questionSchema = z.object({
  id: z.string().min(1),
  profileId: z.custom<ProfileId>((value) => typeof value === 'string' && isProfileId(value)),
  text: z.string().trim().min(2).max(1000),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Укажи дату вопроса.'),
});

export type ServiceQuestion = z.infer<typeof questionSchema>;

export function readServiceQuestions(storage: StoragePort, profileId: ProfileId): ServiceQuestion[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(serviceQuestionsKey) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const parsed = questionSchema.safeParse(entry);
      return parsed.success && parsed.data.profileId === profileId ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export function saveServiceQuestion(storage: StoragePort, profileId: ProfileId, text: string): ServiceQuestion {
  const parsed = questionSchema.safeParse({
    id: globalThis.crypto.randomUUID(),
    profileId,
    text,
    createdAt: new Date().toISOString(),
  });
  if (!parsed.success) throw new Error('Напиши вопрос от 2 до 1000 символов.');
  const others = readAllQuestions(storage).filter((item) => item.id !== parsed.data.id);
  storage.setItem(serviceQuestionsKey, JSON.stringify([parsed.data, ...others]));
  return parsed.data;
}

function readAllQuestions(storage: StoragePort): ServiceQuestion[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(serviceQuestionsKey) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const parsed = questionSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

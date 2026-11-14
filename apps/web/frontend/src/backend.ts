import { z } from 'zod';
import type { ProfileId } from './data';
import type { BuddyReply } from './demo';

export const backendEnabled = import.meta.env.VITE_API_ENABLED === 'true';
const sessionSchema = z.object({ access_token: z.string().min(1), profile_id: z.string() });
const referenceSchema = z.object({
  title: z.string(),
  url: z.string().refine((value) => /^(https?:\/\/|\/(?!\/))/.test(value)),
});
const replySchema = z.object({
  conversation_id: z.string().uuid(),
  kind: z.literal('answer'),
  text: z.string().min(1),
  references: z.array(referenceSchema),
});
const historySchema = z.object({
  conversation_id: z.string().uuid(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      references: z.array(referenceSchema).optional(),
    }),
  ),
});
const sessions = new Map<ProfileId, Promise<string>>();

export async function sessionToken(profile: ProfileId): Promise<string> {
  const existing = sessions.get(profile);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch('/api/v1/demo/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profile }),
    });
    if (!response.ok) throw new Error('Не удалось войти в демосервис.');
    const session = sessionSchema.parse(await response.json());
    if (session.profile_id !== profile) throw new Error('Профиль сессии не совпадает.');
    return session.access_token;
  })();
  sessions.set(profile, pending);
  try {
    return await pending;
  } catch (error) {
    sessions.delete(profile);
    throw error;
  }
}

export async function apiFetch(profile: ProfileId, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: 'Bearer ' + (await sessionToken(profile)),
      'Content-Type': 'application/json',
    },
  });
  if (response.status === 401) sessions.delete(profile);
  if (!response.ok) throw new Error('Сервис временно недоступен. Попробуйте ещё раз.');
  return response;
}

export async function askBackend(profile: ProfileId, text: string): Promise<BuddyReply> {
  const key = 'ai-buddy.conversation.' + profile;
  const conversation = localStorage.getItem(key);
  const response = await apiFetch(profile, '/api/v1/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ text, ...(conversation ? { conversation_id: conversation } : {}) }),
  });
  const reply = replySchema.parse(await response.json());
  localStorage.setItem(key, reply.conversation_id);
  return { kind: 'answer', text: reply.text, references: reply.references };
}

export async function readBackendConversation(profile: ProfileId) {
  const conversation = localStorage.getItem('ai-buddy.conversation.' + profile);
  if (!conversation) return [];
  const response = await apiFetch(profile, '/api/v1/chat/conversations/' + encodeURIComponent(conversation));
  return historySchema.parse(await response.json()).messages;
}

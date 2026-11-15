import { createContext, useContext } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../web/frontend/src/backend';
import type { ProfileId } from '../../../web/frontend/src/demo-accounts';

export const WorkToolTransport = createContext(apiFetch);
export const useWorkToolTransport = () => useContext(WorkToolTransport);

const sessions = new Map<string, Promise<string>>();
const sessionSchema = z.object({ access_token: z.string().min(1) });

async function signIn(path: string, profile: ProfileId) {
  const response = await fetch(path + '/demo/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profile }),
  });
  if (!response.ok) throw new Error('Не удалось войти в инструмент.');
  return sessionSchema.parse(await response.json()).access_token;
}

export async function standaloneWorkToolFetch(profile: ProfileId, path: string, init?: RequestInit) {
  const key = profile + ':' + path;
  let token = sessions.get(key);
  if (!token) {
    token = signIn(path, profile).catch((error: unknown) => {
      sessions.delete(key);
      throw error;
    });
    sessions.set(key, token);
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', 'Bearer ' + (await token));
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) sessions.delete(key);
  if (!response.ok) throw new Error('Сервис временно недоступен.');
  return response;
}

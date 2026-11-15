import { guideCatalog, type GuideItem, type GuideServiceId } from './guide-catalog';

export function guideStorageKey(service: GuideServiceId) {
  return 'ai-buddy.guide.' + service;
}

export function readGuide(storage: Pick<Storage, 'getItem'>, service: GuideServiceId): GuideItem[] {
  const done = readDoneIds(storage, service);
  return guideCatalog(service).map((item) => ({ ...item, done: done.has(item.id) }));
}

export function toggleGuide(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  service: GuideServiceId,
  id: string,
): GuideItem[] {
  const items = readGuide(storage, service);
  if (!items.some((item) => item.id === id)) throw new Error('Запись не найдена.');
  const next = items.map((item) => (item.id === id ? { ...item, done: !item.done } : item));
  storage.setItem(guideStorageKey(service), JSON.stringify(next.filter((item) => item.done).map((item) => item.id)));
  return next;
}

function readDoneIds(storage: Pick<Storage, 'getItem'>, service: GuideServiceId) {
  try {
    const stored: unknown = JSON.parse(storage.getItem(guideStorageKey(service)) || '[]');
    if (!Array.isArray(stored)) return new Set<string>();
    const known = new Set(guideCatalog(service).map((item) => item.id));
    return new Set(stored.filter((id): id is string => typeof id === 'string' && known.has(id)));
  } catch {
    return new Set<string>();
  }
}

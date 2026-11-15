import { corporateLinks } from './corporate-links';
import type { ProfileId } from './data';
import { confluenceService, jiraService, toolProfileUrl, workToolsOrigin } from './tool-links';

export function safeChatUrl(value: string): boolean {
  if (
    !/^(https?:\/\/|\/(?!\/))/.test(value) ||
    /[\s\\]/.test(value) ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return false;
  try {
    const url = new URL(value, 'https://buddy.invalid');
    return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function chatDestination(value: string, profile?: ProfileId, buddyOrigin?: string): string | null {
  if (!safeChatUrl(value)) return null;
  let target = value;
  const url = new URL(value, 'https://buddy.invalid');
  // Old article links are fixed by identity, never by a generated card title.
  if (value.startsWith('/') && url.pathname === '/resources') {
    const article = url.searchParams.get('article') ?? '';
    const service = new Map<string, string>([
      ['documents', 'documents'],
      ['consents', 'consents'],
      ['meetups', 'events'],
      ['timeoff', 'absences'],
    ]).get(article);
    const internal = new Map<string, string>([
      ['product', '/product-guide'],
      ['contacts', '/team'],
      ['equipment', '/onboarding/tasks/equipment'],
      ['learning', '/onboarding/tasks/safety'],
    ]).get(article);
    if (url.searchParams.has('article') && !service && !internal) return null;
    target = service ? corporateLinks.find((entry) => entry.id === service)!.url : (internal ?? value);
  }
  if (!safeChatUrl(target)) return null;
  if (profile && !target.startsWith('/')) {
    const destination = new URL(target);
    const known = [
      ...corporateLinks.map((entry) => entry.url),
      jiraService.url,
      confluenceService.url,
      workToolsOrigin,
    ];
    if (known.some((base) => safeChatUrl(base) && new URL(base, 'https://buddy.invalid').origin === destination.origin))
      return toolProfileUrl(target, profile);
  }
  if (target.startsWith('/') && buddyOrigin !== undefined) {
    if (!safeChatUrl(buddyOrigin) || buddyOrigin.startsWith('/')) return null;
    const base = new URL(buddyOrigin);
    if (base.pathname !== '/' || base.search || base.hash) return null;
    return new URL(target, base).toString();
  }
  return target;
}

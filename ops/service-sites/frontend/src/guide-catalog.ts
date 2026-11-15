import { documentItems, documentsService } from '../../../../corporate-services/documents/frontend/meta';
import { eventItems, eventsService } from '../../../../corporate-services/events/frontend/meta';

export const guideServices = [documentsService, eventsService] as const;
export type GuideService = (typeof guideServices)[number];
export type GuideServiceId = GuideService['id'];
export type GuideItem = { id: string; title: string; text: string; done: boolean };

const catalogs = {
  documents: documentItems,
  events: eventItems,
} as const;

export function guideCatalog(service: GuideServiceId): GuideItem[] {
  return catalogs[service].map((item) => ({ ...item, done: false }));
}

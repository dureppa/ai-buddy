import { documentItems, documentsService } from '../../../../services/hr/documents/frontend/meta';
import { eventItems, eventsService } from '../../../../services/hr/events/frontend/meta';

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

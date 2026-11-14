import { guideServices } from '../../../corporate-services/frontend/src/guide-catalog';
import { hrServices } from '../../../corporate-services/frontend/src/hr-catalog';
import ports from '../../../corporate-services/frontend/service-ports.json';

const configuredUrls: Record<string, string | undefined> = {
  absences: import.meta.env.VITE_ABSENCES_URL,
  trips: import.meta.env.VITE_TRIPS_URL,
  hiring: import.meta.env.VITE_HIRING_URL,
  offboarding: import.meta.env.VITE_OFFBOARDING_URL,
  consents: import.meta.env.VITE_CONSENTS_URL,
  benefits: import.meta.env.VITE_BENEFITS_URL,
  documents: import.meta.env.VITE_DOCUMENTS_URL,
  events: import.meta.env.VITE_EVENTS_URL,
};

export const corporateLinks = [...hrServices, ...guideServices].map((service) => ({
  ...service,
  url: configuredUrls[service.id] || 'http://localhost:' + ports[service.id] + '/',
}));

import { hrServices } from '../../../corporate-services/frontend/src/hr-catalog';
import ports from '../../../corporate-services/frontend/service-ports.json';

const configuredUrls = {
  absences: import.meta.env.VITE_ABSENCES_URL,
  trips: import.meta.env.VITE_TRIPS_URL,
  hiring: import.meta.env.VITE_HIRING_URL,
  offboarding: import.meta.env.VITE_OFFBOARDING_URL,
  consents: import.meta.env.VITE_CONSENTS_URL,
  benefits: import.meta.env.VITE_BENEFITS_URL,
};

export const corporateLinks = hrServices.map((service) => ({
  ...service,
  url: configuredUrls[service.id] || 'http://localhost:' + ports[service.id] + '/',
}));

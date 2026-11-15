import { absencesService } from '../../../../corporate-services/absences/frontend/meta';
import { benefitOptions, benefitsService } from '../../../../corporate-services/benefits/frontend/meta';
import { consentOptions, consentsService } from '../../../../corporate-services/consents/frontend/meta';
import { hiringService, vacancies } from '../../../../corporate-services/hiring/frontend/meta';
import { exitSteps, offboardingService } from '../../../../corporate-services/offboarding/frontend/meta';
import { destinations, tripsService } from '../../../../corporate-services/trips/frontend/meta';

export const hrServices = [
  absencesService,
  tripsService,
  hiringService,
  offboardingService,
  consentsService,
  benefitsService,
] as const;

export type HrService = (typeof hrServices)[number];
export { benefitOptions, consentOptions, destinations, exitSteps, vacancies };

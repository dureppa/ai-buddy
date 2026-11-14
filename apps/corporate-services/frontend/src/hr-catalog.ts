import { absencesService } from '../../../../services/hr/absences/frontend/meta';
import { benefitOptions, benefitsService } from '../../../../services/hr/benefits/frontend/meta';
import { consentOptions, consentsService } from '../../../../services/hr/consents/frontend/meta';
import { hiringService, vacancies } from '../../../../services/hr/hiring/frontend/meta';
import { exitSteps, offboardingService } from '../../../../services/hr/offboarding/frontend/meta';
import { destinations, tripsService } from '../../../../services/hr/trips/frontend/meta';

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

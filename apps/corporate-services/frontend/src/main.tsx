import { LiveScheduleHr } from './LiveScheduleHr';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../web/frontend/src/styles.css';
import { backendEnabled } from '../../../web/frontend/src/backend';
import { type ProfileId } from '../../../web/frontend/src/data';
import { ConsentApi } from '../../../../services/hr/consents/frontend/ConsentApi';
import { DocumentsPage } from '../../../../services/hr/documents/frontend/page';
import { EventsPage } from '../../../../services/hr/events/frontend/page';
import { guideServices, type GuideService } from './guide-catalog';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';
import './hr.css';
import { AccessPortal } from '../../../../services/access/frontend/page';
import { JiraPage } from '../../../../services/jira/frontend/page';

declare const __CORPORATE_SERVICE__: string;

const service = [...hrServices, ...guideServices].find((item) => item.id === __CORPORATE_SERVICE__);
const root = document.getElementById('root');
if (!root || (!service && !['jira', 'access'].includes(__CORPORATE_SERVICE__)))
  throw new Error('Не удалось открыть корпоративный сервис.');

document.title =
  (service?.title || (__CORPORATE_SERVICE__ === 'access' ? 'Управление доступами' : 'Jira')) + ' · Демосервис';

function isGuideService(value: { id: string }): value is GuideService {
  return guideServices.some((item) => item.id === value.id);
}

function Page() {
  const [profileId, setProfileId] = useState<ProfileId>('maria');
  if (!service) return null;
  if (isGuideService(service)) return service.id === 'documents' ? <DocumentsPage /> : <EventsPage />;
  if (backendEnabled && (service.id === 'absences' || service.id === 'trips')) {
    return <LiveScheduleHr service={service.id} />;
  }
  if (service.id !== 'consents' || !backendEnabled) return <HrPage service={service} profileId="maria" />;
  return <ConsentApi key={profileId} profileId={profileId} onProfileChange={setProfileId} />;
}
createRoot(root).render(
  <StrictMode>
    {__CORPORATE_SERVICE__ === 'access' ? <AccessPortal /> : __CORPORATE_SERVICE__ === 'jira' ? <JiraPage /> : <Page />}
  </StrictMode>,
);

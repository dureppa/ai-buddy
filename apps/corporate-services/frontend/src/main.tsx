import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../web/frontend/src/styles.css';
import { backendEnabled } from '../../../web/frontend/src/backend';
import { profiles, type ProfileId } from '../../../web/frontend/src/data';
import { ConsentApi } from '../../../../services/hr/consents/frontend/ConsentApi';
import { DocumentsPage } from '../../../../services/hr/documents/frontend/page';
import { EventsPage } from '../../../../services/hr/events/frontend/page';
import { guideServices, type GuideService } from './guide-catalog';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';
import './hr.css';
import { JiraPage } from '../../../../services/jira/frontend/page';

declare const __CORPORATE_SERVICE__: string;

const service = [...hrServices, ...guideServices].find((item) => item.id === __CORPORATE_SERVICE__);
const root = document.getElementById('root');
if (!root || (!service && __CORPORATE_SERVICE__ !== 'jira'))
  throw new Error('Не удалось открыть корпоративный сервис.');

document.title = (service?.title || 'Jira') + ' · Демосервис';

function isGuideService(value: { id: string }): value is GuideService {
  return guideServices.some((item) => item.id === value.id);
}

function Page() {
  const [profileId, setProfileId] = useState<ProfileId>('maria');
  if (!service) return null;
  if (isGuideService(service)) return service.id === 'documents' ? <DocumentsPage /> : <EventsPage />;
  if (service.id !== 'consents' || !backendEnabled) return <HrPage service={service} profileId="maria" />;
  return (
    <main className="hr-page">
      <h1>Согласия</h1>
      <label>
        Демопрофиль{' '}
        <select value={profileId} onChange={(event) => setProfileId(event.target.value as ProfileId)}>
          {Object.entries(profiles).map(([id, profile]) => (
            <option key={id} value={id}>
              {profile.fullName}
            </option>
          ))}
        </select>
      </label>
      <ConsentApi key={profileId} profileId={profileId} />
    </main>
  );
}
createRoot(root).render(<StrictMode>{__CORPORATE_SERVICE__ === 'jira' ? <JiraPage /> : <Page />}</StrictMode>);

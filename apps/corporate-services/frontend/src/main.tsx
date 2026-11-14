import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../web/frontend/src/styles.css';
import { ConsentApi } from './ConsentApi';
import { backendEnabled } from '../../../web/frontend/src/backend';
import { profiles, type ProfileId } from '../../../web/frontend/src/data';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';

declare const __CORPORATE_SERVICE__: string;

const service = hrServices.find((item) => item.id === __CORPORATE_SERVICE__);
const root = document.getElementById('root');
if (!root || !service) throw new Error('Не удалось открыть корпоративный сервис.');

document.title = service.title + ' · Демосервис';
function Page() {
  const [profileId, setProfileId] = useState<ProfileId>('maria');
  if (!service) return null;
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
createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

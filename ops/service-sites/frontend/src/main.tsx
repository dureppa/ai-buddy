import { WorkToolsSite } from './WorkToolsSite';
import { ServiceSession } from './ServiceSession';
import { LiveScheduleHr } from './LiveScheduleHr';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../web/frontend/src/styles.css';
import { backendEnabled } from '../../../../web/frontend/src/backend';
import { type ProfileId } from '../../../../web/frontend/src/data';
import { ConsentApi } from '../../../../corporate-services/consents/frontend/ConsentApi';
import { DocumentsPage } from '../../../../corporate-services/documents/frontend/page';
import { EventsPage } from '../../../../corporate-services/events/frontend/page';
import { guideServices, type GuideService } from './guide-catalog';
import { LiveHrPage } from './LiveHrPage';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';
import './hr.css';
import { AccessPortal } from '../../../../corporate-services/access/frontend/page';
import { ConfluencePage } from '../../../../tools/confluence/frontend/page';
import { JiraPage } from '../../../../tools/jira/frontend/page';

declare const __CORPORATE_SERVICE__: string;

const service = [...hrServices, ...guideServices].find((item) => item.id === __CORPORATE_SERVICE__);
const root = document.getElementById('root');
if (!root || (!service && !['jira', 'access', 'confluence', 'work-tools'].includes(__CORPORATE_SERVICE__)))
  throw new Error('Не удалось открыть корпоративный сервис.');

document.title =
  (service?.title ||
    (__CORPORATE_SERVICE__ === 'access'
      ? 'Управление доступами'
      : __CORPORATE_SERVICE__ === 'confluence'
        ? 'Confluence'
        : __CORPORATE_SERVICE__ === 'work-tools'
          ? 'Рабочие инструменты'
          : 'Jira')) + ' · Демосервис';

function isGuideService(value: { id: string }): value is GuideService {
  return guideServices.some((item) => item.id === value.id);
}

function Page({ profileId }: { profileId: ProfileId }) {
  if (!service) return null;
  if (isGuideService(service))
    return service.id === 'documents' ? <DocumentsPage profileId={profileId} /> : <EventsPage profileId={profileId} />;
  if (backendEnabled && (service.id === 'absences' || service.id === 'trips')) {
    return <LiveScheduleHr service={service.id} profileId={profileId} />;
  }
  if (backendEnabled && (service.id === 'hiring' || service.id === 'benefits' || service.id === 'offboarding')) {
    return <LiveHrPage key={service.id + ':' + profileId} service={service.id} profileId={profileId} />;
  }
  if (service.id !== 'consents' || !backendEnabled) return <HrPage service={service} profileId={profileId} />;
  return <ConsentApi key={profileId} profileId={profileId} />;
}
createRoot(root).render(
  <StrictMode>
    {__CORPORATE_SERVICE__ === 'work-tools' ? (
      <WorkToolsSite />
    ) : __CORPORATE_SERVICE__ === 'access' ? (
      <AccessPortal />
    ) : (
      <ServiceSession
        standaloneTitle={
          service ? 'Выбрать демопрофиль' : __CORPORATE_SERVICE__ === 'jira' ? 'Войти в Jira' : 'Войти в Confluence'
        }
      >
        {(profileId) =>
          __CORPORATE_SERVICE__ === 'confluence' ? (
            <ConfluencePage profile={profileId} />
          ) : __CORPORATE_SERVICE__ === 'jira' ? (
            <JiraPage profile={profileId} />
          ) : (
            <div data-agent-resource={JSON.stringify({ kind: 'service', service: service?.id, label: service?.title })}>
              <Page profileId={profileId} />
            </div>
          )
        }
      </ServiceSession>
    )}
  </StrictMode>,
);

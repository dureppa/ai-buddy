import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WorkToolPage } from '../../../../web/frontend/src/WorkToolPage';
import { standaloneWorkToolFetch, WorkToolTransport } from '../../../../web/frontend/src/work-tool-transport';
import { ServiceSession } from './ServiceSession';

const cache = new QueryClient();

export function WorkToolsSite() {
  return (
    <QueryClientProvider client={cache}>
      <BrowserRouter>
        <WorkToolTransport.Provider value={standaloneWorkToolFetch}>
          <ServiceSession standaloneTitle="Войти в рабочий инструмент">
            {(profile) => (
              <main className="work-tool-page">
                <Routes>
                  <Route path="/work-tools/:service" element={<WorkToolPage profileId={profile} />} />
                  <Route path="*" element={<p>Открой ссылку на нужный рабочий инструмент.</p>} />
                </Routes>
              </main>
            )}
          </ServiceSession>
        </WorkToolTransport.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../web/frontend/src/styles.css';
import { HrPage } from './HrPages';
import { hrServices } from './hr-catalog';

declare const __CORPORATE_SERVICE__: string;

const service = hrServices.find((item) => item.id === __CORPORATE_SERVICE__);
const root = document.getElementById('root');
if (!root || !service) throw new Error('Не удалось открыть корпоративный сервис.');

document.title = service.title + ' · Демосервис';
createRoot(root).render(
  <StrictMode>
    <HrPage service={service} profileId="maria" />
  </StrictMode>,
);

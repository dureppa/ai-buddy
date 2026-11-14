import type { ProfileId } from '../../../../apps/web/frontend/src/data';
import { useState } from 'react';
import { backendEnabled } from '../../../../apps/web/frontend/src/backend';
import { Icon, PageIntro } from '../../../../apps/web/frontend/src/ui';
import { readGuide, toggleGuide } from '../../../../apps/corporate-services/frontend/src/guide-store';
import type { GuideItem } from '../../../../apps/corporate-services/frontend/src/guide-catalog';
import { EventsApi } from './api';
import { eventsService } from './meta';

export function EventsPage({ profileId }: { profileId: ProfileId }) {
  if (backendEnabled) return <EventsApi profileId={profileId} />;
  return <EventsLocal />;
}

function EventsLocal() {
  const [items, setItems] = useState<GuideItem[]>(() => readGuide(localStorage, eventsService.id));

  return (
    <main className="hr-page">
      <a className="text-link hr-back" href={import.meta.env.VITE_AI_BUDDY_URL || 'http://localhost:5173/resources'}>
        <span className="hr-back-icon">
          <Icon name="arrow" size={16} />
        </span>
        Вернуться в AI Buddy
      </a>
      <PageIntro
        title={eventsService.title}
        text={eventsService.description}
        tone={eventsService.tone}
        icon={eventsService.icon}
      />
      <section className="panel hr-panel">
        <ul className="guide-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
              <button
                type="button"
                className={item.done ? 'button button--white' : 'button button--dark'}
                aria-pressed={item.done}
                onClick={() => setItems(toggleGuide(localStorage, eventsService.id, item.id))}
              >
                {item.done ? 'Вы записаны' : 'Записаться'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

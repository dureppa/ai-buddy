import { useState } from 'react';
import { backendEnabled } from '../../../../apps/web/frontend/src/backend';
import { Icon, PageIntro } from '../../../../apps/web/frontend/src/ui';
import { readGuide, toggleGuide } from '../../../../apps/corporate-services/frontend/src/guide-store';
import type { GuideItem } from '../../../../apps/corporate-services/frontend/src/guide-catalog';
import { DocumentsApi } from './api';
import { documentsService } from './meta';

export function DocumentsPage() {
  if (backendEnabled) return <DocumentsApi />;
  return <DocumentsLocal />;
}

function DocumentsLocal() {
  const [items, setItems] = useState<GuideItem[]>(() => readGuide(localStorage, documentsService.id));

  return (
    <main className="hr-page">
      <a className="text-link hr-back" href={import.meta.env.VITE_AI_BUDDY_URL || 'http://localhost:5173/resources'}>
        <span className="hr-back-icon">
          <Icon name="arrow" size={16} />
        </span>
        Вернуться в AI Buddy
      </a>
      <PageIntro
        title={documentsService.title}
        text={documentsService.description}
        tone={documentsService.tone}
        icon={documentsService.icon}
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
                onClick={() => setItems(toggleGuide(localStorage, documentsService.id, item.id))}
              >
                {item.done ? 'Прочитано' : 'Отметить прочитанным'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

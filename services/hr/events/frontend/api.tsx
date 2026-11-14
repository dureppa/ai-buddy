import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../../apps/web/frontend/src/backend';
import { type ProfileId } from '../../../../apps/web/frontend/src/data';
import { Icon, PageIntro } from '../../../../apps/web/frontend/src/ui';
import { eventsService } from './meta';

const itemsSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    registered: z.boolean(),
  }),
);

export function EventsApi({ profileId }: { profileId: ProfileId }) {
  const [items, setItems] = useState<z.infer<typeof itemsSchema>>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setPending(true);
    setError('');
    apiFetch(profileId, '/hr-api/v1/me/events')
      .then((response) => response.json())
      .then((body) => {
        const parsed = itemsSchema.parse(body);
        if (active) setItems(parsed);
      })
      .catch(() => {
        if (active) setError('Не удалось получить мероприятия. Обновите страницу.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  async function toggle(id: string, registered: boolean) {
    setPending(true);
    setError('');
    try {
      await apiFetch(profileId, '/hr-api/v1/me/events/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({ registered }),
      });
      const response = await apiFetch(profileId, '/hr-api/v1/me/events');
      setItems(itemsSchema.parse(await response.json()));
    } catch {
      setError('Не удалось сохранить запись. Обновите страницу перед повтором.');
    } finally {
      setPending(false);
    }
  }

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
        {pending && <p role="status">Загружаем…</p>}
        {error && <p role="alert">{error}</p>}
        <ul className="guide-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
              <button
                type="button"
                className={item.registered ? 'button button--white' : 'button button--dark'}
                aria-pressed={item.registered}
                disabled={pending || Boolean(error)}
                onClick={() => void toggle(item.id, !item.registered)}
              >
                {item.registered ? 'Вы записаны' : 'Записаться'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

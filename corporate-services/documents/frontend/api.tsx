import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../web/frontend/src/backend';
import { type ProfileId } from '../../../web/frontend/src/data';
import { PageIntro } from '../../../web/frontend/src/ui';
import { documentsService } from './meta';

const itemsSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    done: z.boolean(),
  }),
);

export function DocumentsApi({ profileId }: { profileId: ProfileId }) {
  const [items, setItems] = useState<z.infer<typeof itemsSchema>>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setPending(true);
    setError('');
    apiFetch(profileId, '/hr-api/v1/me/documents')
      .then((response) => response.json())
      .then((body) => {
        const parsed = itemsSchema.parse(body);
        if (active) setItems(parsed);
      })
      .catch(() => {
        if (active) setError('Не удалось получить памятки. Обновите страницу.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  async function toggle(id: string, done: boolean) {
    setPending(true);
    setError('');
    try {
      await apiFetch(profileId, '/hr-api/v1/me/documents/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({ done }),
      });
      const response = await apiFetch(profileId, '/hr-api/v1/me/documents');
      setItems(itemsSchema.parse(await response.json()));
    } catch {
      setError('Не удалось сохранить отметку. Обновите страницу перед повтором.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="hr-page">
      <PageIntro
        title={documentsService.title}
        text={documentsService.description}
        tone={documentsService.tone}
        icon={documentsService.icon}
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
                className={item.done ? 'button button--white' : 'button button--dark'}
                aria-pressed={item.done}
                disabled={pending || Boolean(error)}
                onClick={() => void toggle(item.id, !item.done)}
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

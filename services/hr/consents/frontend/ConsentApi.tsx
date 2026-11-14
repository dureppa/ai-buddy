import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../../apps/web/frontend/src/backend';
import type { ProfileId } from '../../../../apps/web/frontend/src/data';

const consentsSchema = z.array(
  z.object({ purpose: z.string(), title: z.string(), description: z.string(), granted: z.boolean() }),
);
export function ConsentApi({ profileId }: { profileId: ProfileId }) {
  const [items, setItems] = useState<z.infer<typeof consentsSchema>>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    apiFetch(profileId, '/hr-api/v1/me/consents')
      .then((response) => response.json())
      .then((body) => {
        const parsed = consentsSchema.parse(body);
        if (active) setItems(parsed);
      })
      .catch(() => {
        if (active) setError('Не удалось получить согласия. Обновите страницу.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [profileId]);
  async function toggle(purpose: string, granted: boolean) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await apiFetch(profileId, '/hr-api/v1/me/consents/' + encodeURIComponent(purpose), {
        method: 'PUT',
        body: JSON.stringify({ granted }),
      });
      const response = await apiFetch(profileId, '/hr-api/v1/me/consents');
      setItems(consentsSchema.parse(await response.json()));
      setNotice(granted ? 'Согласие сохранено на сервере.' : 'Согласие отозвано.');
    } catch {
      setError('Не удалось подтвердить состояние. Обновите страницу перед повтором.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel hr-panel">
      <h2>Учебные согласия</h2>
      <p>Изменения сохраняются для выбранного демопрофиля. Согласие можно отозвать.</p>
      {pending && <p role="status">Загружаем…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {items.map((item) => (
        <div className="hr-option" key={item.purpose}>
          <span>
            <strong>{item.title}</strong>
            <small>
              {item.description} {item.granted ? 'Согласие дано.' : 'Согласие не дано.'}
            </small>
          </span>
          <button
            className="button button--white"
            disabled={pending || Boolean(error)}
            onClick={() => void toggle(item.purpose, !item.granted)}
          >
            {item.granted ? 'Отозвать' : 'Разрешить'}
          </button>
        </div>
      ))}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../../apps/web/frontend/src/backend';
import { profiles, type ProfileId } from '../../../../apps/web/frontend/src/data';

import { Avatar, Icon, PageIntro } from '../../../../apps/web/frontend/src/ui';
import { consentsService } from './meta';

const consentsSchema = z.array(
  z.object({ purpose: z.string(), title: z.string(), description: z.string(), granted: z.boolean() }),
);
type ProfileProps = { profileId: ProfileId };

export function ConsentApi({ profileId }: ProfileProps) {
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
    <ConsentPageView
      profileId={profileId}
      items={items}
      pending={pending}
      error={error}
      notice={notice}
      onToggle={(purpose, granted) => void toggle(purpose, granted)}
    />
  );
}

export function ConsentPageView({
  profileId,
  items,
  pending,
  error,
  notice,
  onToggle,
}: ProfileProps & {
  items: z.infer<typeof consentsSchema>;
  pending: boolean;
  error: string;
  notice: string;
  onToggle: (purpose: string, granted: boolean) => void;
}) {
  const profile = profiles[profileId];
  return (
    <main className="hr-page">
      <PageIntro
        title={consentsService.title}
        text={consentsService.description}
        tone={consentsService.tone}
        icon={consentsService.icon}
      />
      <div className="hr-layout">
        <section className="panel hr-panel">
          <div className="section-title">
            <h2>Доступные согласия</h2>
          </div>
          <p className="hr-note">Управляй дополнительными согласиями. Любое из них можно отозвать.</p>
          {pending && <p role="status">Загружаем…</p>}
          {error && (
            <p className="hr-feedback hr-feedback--error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="hr-feedback" role="status">
              <Icon name="check" size={18} />
              {notice}
            </p>
          )}
          <div className="hr-options">
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
                  type="button"
                  aria-label={(item.granted ? 'Отозвать: ' : 'Разрешить: ') + item.title}
                  disabled={pending || Boolean(error)}
                  onClick={() => onToggle(item.purpose, !item.granted)}
                >
                  {item.granted ? 'Отозвать' : 'Разрешить'}
                </button>
              </div>
            ))}
          </div>
        </section>
        <aside className="hr-aside" aria-label="Профиль и согласия">
          <section className={'hr-metric tone-' + consentsService.tone}>
            <div className="hr-metric__account">
              <Avatar initials={profile.initials} avatar={profile.avatar} />
              <span>
                <strong>{profile.fullName}</strong>
                <small>Твой аккаунт</small>
              </span>
            </div>
            <span className="hr-metric__value">
              {pending || error ? '—' : items.filter((item) => item.granted).length + ' из ' + items.length}
            </span>
            <p>
              {pending
                ? 'Обновляем состояние согласий'
                : error
                  ? 'Состояние пока не подтверждено'
                  : 'Дополнительных согласий дано'}
            </p>
          </section>
          <section className="panel hr-panel">
            <div className="section-title">
              <h2>Сохранённое состояние</h2>
            </div>
            {pending ? (
              <p className="hr-note">Загружаем согласия…</p>
            ) : error ? (
              <p className="hr-note">Не удалось получить актуальное состояние.</p>
            ) : (
              <ul className="hr-history">
                {items.map((item) => (
                  <li key={item.purpose}>
                    <Icon name={item.granted ? 'check' : 'info'} size={16} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.granted ? 'Согласие дано' : 'Согласие не дано'}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ProfileId } from './data';
import { actionMessage, decideServiceAction, readServiceAction, type ServiceAction } from './service-actions';
import './service-actions.css';

export function ServiceActionCard({
  draft,
  busy,
  onDecide,
}: {
  draft: ServiceAction;
  busy: boolean;
  onDecide: (confirm: boolean) => void;
}) {
  const expired = Date.parse(draft.expires_at) <= Date.now();
  const visible = draft.state === 'prepared' && expired ? { ...draft, state: 'expired' as const } : draft;
  return (
    <section className="service-action-card">
      <h1>{draft.title}</h1>
      <p role="status">{actionMessage(visible)}</p>
      <dl>
        {draft.fields.map((field, index) => (
          <div key={index}>
            <dt>{field.label}</dt>
            <dd>{field.value || 'Не задано'}</dd>
          </div>
        ))}
      </dl>
      {visible.state === 'prepared' && (
        <div className="service-action-buttons">
          <button className="button button--dark" disabled={busy} onClick={() => onDecide(true)}>
            {busy ? 'Отправляем…' : 'Подтвердить'}
          </button>
          <button className="button button--white" disabled={busy} onClick={() => onDecide(false)}>
            Отменить
          </button>
        </div>
      )}
      <div className="service-action-links">
        <a href={draft.service_url} target="_blank" rel="noreferrer">
          Открыть сервис ↗
        </a>
        <Link to="/chat">Вернуться в чат</Link>
      </div>
    </section>
  );
}

export function ServiceActionPage({ profileId }: { profileId: ProfileId }) {
  const { actionId = '' } = useParams();
  const client = useQueryClient();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const key = ['service-action', profileId, actionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => readServiceAction(profileId, actionId),
    retry: false,
    refetchInterval: (q) => (q.state.data?.state === 'executing' ? 2000 : 10000),
  });
  const mutation = useMutation({
    mutationFn: (confirm: boolean) => decideServiceAction(profileId, actionId, confirm),
    retry: false,
    onMutate: () => setNeedsRefresh(false),
    onSuccess: (draft) => client.setQueryData(key, draft),
    onError: () => {
      setNeedsRefresh(true);
      void query.refetch();
    },
  });
  if (!query.data)
    return (
      <section className="service-action-card">
        <p role="status">
          {query.isPending
            ? 'Загружаем подтверждение…'
            : 'Не удалось открыть подтверждение. Проверь активный аккаунт и обнови страницу.'}
        </p>
      </section>
    );
  return (
    <>
      {needsRefresh && (
        <p role="alert">
          Не удалось получить результат. Обнови состояние перед следующим действием.{' '}
          <button
            className="button button--white"
            onClick={() =>
              void query.refetch().then((result) => {
                if (result.isSuccess) setNeedsRefresh(false);
              })
            }
          >
            Обновить состояние
          </button>
        </p>
      )}
      <ServiceActionCard
        draft={query.data}
        busy={mutation.isPending || needsRefresh}
        onDecide={(confirm) => mutation.mutate(confirm)}
      />
    </>
  );
}

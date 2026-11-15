import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ProfileId } from './data';
import type { SelectionResource } from './selection-context';
import { chatDestination } from './chat-links';
import { readOnboardingTask, type OnboardingTask } from './onboarding-task';

export function OnboardingTaskCard({ task, profileId }: { task: OnboardingTask; profileId: ProfileId }) {
  const destination = task.action_url ? chatDestination(task.action_url, profileId) : null;
  const self = '/onboarding/tasks/' + encodeURIComponent(task.id);
  return (
    <section
      className="panel"
      data-agent-resource={JSON.stringify({
        kind: 'task',
        id: task.id,
        label: task.title,
        description: [...task.guidance].slice(0, 800).join(''),
      } satisfies SelectionResource)}
    >
      <h1>{task.title}</h1>
      <p>{task.guidance}</p>
      <p role="status">Статус в плане: {task.status === 'completed' ? 'выполнено' : 'ещё не выполнено'}.</p>
      <div className="button-row">
        {destination && destination !== self && (
          <a className="button button--dark" href={destination} target="_blank" rel="noopener noreferrer">
            Открыть сервис ↗
          </a>
        )}
        <Link className="button button--white" to="/chat">
          Вернуться в чат
        </Link>
        <Link className="text-link" to="/onboarding">
          План адаптации
        </Link>
      </div>
    </section>
  );
}

export function OnboardingTaskPage({ profileId }: { profileId: ProfileId }) {
  const { taskId = '' } = useParams();
  const query = useQuery({
    queryKey: ['onboarding-task', profileId, taskId],
    queryFn: () => readOnboardingTask(profileId, taskId),
    retry: false,
  });
  if (query.data) return <OnboardingTaskCard task={query.data} profileId={profileId} />;
  return (
    <section className="panel">
      <h1>Задание онбординга</h1>
      <p role="status">
        {query.isPending
          ? 'Загружаем задание…'
          : 'Не удалось открыть задание. Проверь активный аккаунт и попробуй ещё раз.'}
      </p>
      {!query.isPending && (
        <button className="button button--white" onClick={() => void query.refetch()}>
          Попробовать ещё раз
        </button>
      )}
      <Link className="text-link" to="/chat">
        Вернуться в чат
      </Link>
    </section>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { pageSchema } from './work-tool-data';
import { useWorkToolTransport } from './work-tool-transport';
import type { ProfileId } from '../../../web/frontend/src/demo-accounts';
import { toolViews } from './WorkToolViews';
import './work-tools.css';

export function WorkToolPage({ profileId }: { profileId: ProfileId }) {
  const apiFetch = useWorkToolTransport();
  const { service = '' } = useParams();
  const { hash } = useLocation();
  const [search, setSearch] = useState('');
  const result = useQuery({
    queryKey: ['work-tool', profileId, service],
    queryFn: async () => {
      const response = await apiFetch(profileId, '/api/v1/work-tools/' + encodeURIComponent(service));
      return pageSchema.parse(await response.json());
    },
  });
  const page = result.data;
  const selected = hash ? page?.records.find(({ id }) => '#' + id === hash) : page?.records[0];
  const view = Object.hasOwn(toolViews, service) ? toolViews[service] : undefined;
  const records = page?.records.filter(({ title, status, fields }) =>
    [title, status, ...Object.values(fields)].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
  );
  const Workspace = view?.component;
  return (
    <section className={'work-tool work-tool--' + service}>
      <header className="work-tool__header">
        <span className="work-tool__mark" aria-hidden="true">
          {view?.icon ?? '▦'}
        </span>
        <h1>{page?.name ?? 'Рабочий сервис'}</h1>
      </header>
      {result.isPending && <p role="status">Загружаем записи…</p>}
      {result.isError && (
        <p role="alert">
          Сервис недоступен. <button onClick={() => void result.refetch()}>Повторить</button>
        </p>
      )}
      {page && (
        <div className="work-tool__layout">
          <aside className="work-tool__sidebar">
            <h2>{view?.section ?? page.area}</h2>
            <input
              aria-label="Поиск записей"
              placeholder="Поиск…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <nav aria-label={page.area}>
              {records?.map((record) => (
                <Link key={record.id} to={{ hash: record.id }} aria-current={record === selected ? 'true' : undefined}>
                  {service === 'mattermost' && <span aria-hidden="true"># </span>}
                  {record.title}
                </Link>
              ))}
              {records?.length === 0 && <p>Ничего не найдено</p>}
            </nav>
          </aside>
          <div className="work-tool__main">
            {selected && Workspace ? (
              <article id={selected.id}>
                <div className="work-tool__path">
                  {page.area} {selected.fields.Задача && ' / ' + selected.fields.Задача}
                </div>
                <h2>{selected.title}</h2>
                <Workspace key={selected.id} record={selected} profileId={profileId} />
              </article>
            ) : (
              <p>{hash ? 'Запись не найдена.' : 'В этом разделе пока нет записей.'}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

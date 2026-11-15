import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { z } from 'zod';
import { apiFetch } from './backend';
import type { ProfileId } from './demo-accounts';
import './work-tools.css';

const pageSchema = z.object({
  name: z.string(),
  area: z.string(),
  records: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      description: z.string(),
      fields: z.record(z.string(), z.string()),
    }),
  ),
});

export function WorkToolPage({ profileId }: { profileId: ProfileId }) {
  const { service = '' } = useParams();
  const { hash } = useLocation();
  const result = useQuery({
    queryKey: ['work-tool', profileId, service],
    queryFn: async () => {
      const response = await apiFetch(profileId, '/api/v1/work-tools/' + encodeURIComponent(service));
      return pageSchema.parse(await response.json());
    },
  });
  const page = result.data;
  const selected = hash ? page?.records.find(({ id }) => '#' + id === hash) : page?.records[0];
  return (
    <section className={'work-tool work-tool--' + service}>
      <header className="work-tool__header">
        <Link to="/tools">‹ Инструменты</Link>
        <h1>{page?.name ?? 'Рабочий сервис'}</h1>
        <p>{page?.area ?? 'Учебная среда'}</p>
      </header>
      {result.isPending && <p role="status">Загружаем записи…</p>}
      {result.isError && (
        <p role="alert">
          Сервис недоступен. <button onClick={() => void result.refetch()}>Повторить</button>
        </p>
      )}
      {page && (
        <div className="work-tool__layout">
          <nav aria-label={page.area}>
            {page.records.map((record) => (
              <Link key={record.id} to={{ hash: record.id }} aria-current={record === selected ? 'true' : undefined}>
                {record.title}
              </Link>
            ))}
          </nav>
          {selected ? (
            <article id={selected.id}>
              <small>{selected.status}</small>
              <h2>{selected.title}</h2>
              <p>{selected.description}</p>
              <dl>
                {Object.entries(selected.fields).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                    {['redash', 'grafana', 'trisigma'].includes(service) && /^\d+%?$/.test(value) && (
                      <meter
                        min={0}
                        max={value.endsWith('%') ? 100 : 1000}
                        value={Number.parseInt(value)}
                        aria-label={key}
                      />
                    )}
                  </div>
                ))}
              </dl>
            </article>
          ) : (
            <p>{hash ? 'Запись не найдена.' : 'В этом разделе пока нет записей.'}</p>
          )}
        </div>
      )}
    </section>
  );
}

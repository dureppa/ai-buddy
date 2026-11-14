import { HrDayEvents } from './HrDayEvents';
import type { HrToday } from './hr-schedule';
import { useState, type FormEvent } from 'react';
import { eventDay, eventKinds, eventTime, localDateTime, upcomingEvents, type ScheduleEvent } from './schedule';
import { EmptyState, Icon, Modal } from './ui';
import './schedule.css';

type Props = {
  events: ScheduleEvent[];
  hrEvents: HrToday['events'];
  hrError: boolean;
  now: number;
  onChange: (events: ScheduleEvent[]) => boolean;
};

export function Schedule({ events, hrEvents, hrError, now, onChange }: Props) {
  const [editing, setEditing] = useState<ScheduleEvent | 'new' | null>(null);
  const [removing, setRemoving] = useState<ScheduleEvent | null>(null);
  const [error, setError] = useState('');
  const groups = new Map<string, ScheduleEvent[]>();
  for (const event of upcomingEvents(events, now)) {
    const day = eventDay.format(new Date(event.startsAt));
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  const past = events
    .filter((event) => Date.parse(event.startsAt) < now)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const current = editing === 'new' ? null : editing;

  function open(event: ScheduleEvent | 'new') {
    setError('');
    setEditing(event);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    const startsAt = new Date(String(data.get('startsAt') ?? ''));
    const kind = eventKinds.find((kind) => kind === data.get('kind'));
    if (!title || !kind || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError('Укажи название, тип и время в будущем.');
      return;
    }
    const saved: ScheduleEvent = {
      id: current?.id ?? crypto.randomUUID(),
      title,
      kind,
      startsAt: startsAt.toISOString(),
      tone: current?.tone ?? 'lilac',
      description: current?.description ?? '',
    };
    if (onChange([...events.filter((item) => item.id !== saved.id), saved])) setEditing(null);
  }

  function rows(list: ScheduleEvent[], showDate = false) {
    return (
      <ul className="schedule-list">
        {list.map((event) => (
          <li key={event.id} className="schedule-row">
            <span className={'event-date tone-' + event.tone}>{eventTime.format(new Date(event.startsAt))}</span>
            <div>
              <strong>{event.title}</strong>
              <small>
                {event.kind}
                {showDate && ' · ' + eventDay.format(new Date(event.startsAt))}
              </small>
            </div>
            <div className="schedule-actions">
              <button
                type="button"
                className="button button--white"
                aria-label={'Изменить: ' + event.title}
                onClick={() => open(event)}
              >
                Изменить
              </button>
              <button
                type="button"
                className="button button--white"
                aria-label={'Удалить: ' + event.title}
                onClick={() => setRemoving(event)}
              >
                Удалить
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="schedule">
      <div className="page-title schedule-heading">
        <div>
          <h1>События</h1>
          <p>Личное расписание встреч, созвонов и напоминаний</p>
        </div>
        <button type="button" className="button button--dark" onClick={() => open('new')}>
          <Icon name="calendar" size={18} /> Создать событие
        </button>
      </div>
      {(hrEvents.length > 0 || hrError) && (
        <section className="panel schedule-day">
          <h2>Сегодня по данным HR</h2>
          <HrDayEvents events={hrEvents} error={hrError} />
        </section>
      )}
      {!groups.size && !hrEvents.length && !hrError && (
        <EmptyState title="Нет ближайших событий" text="Добавь встречу, созвон или напоминание в расписание." />
      )}
      {[...groups].map(([day, list]) => (
        <section key={day} className="panel schedule-day">
          <h2>{day}</h2>
          {rows(list)}
        </section>
      ))}
      {!!past.length && (
        <section className="panel schedule-day">
          <h2>Прошедшие события</h2>
          {rows(past, true)}
        </section>
      )}
      {editing && (
        <Modal title={current ? 'Изменить событие' : 'Создать событие'} onClose={() => setEditing(null)}>
          <form className="schedule-form" onSubmit={save}>
            <label>
              Название
              <input name="title" required maxLength={120} defaultValue={current?.title} />
            </label>
            <label>
              Тип
              <select name="kind" defaultValue={current?.kind ?? 'Встреча'}>
                {eventKinds.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label>
              Дата и время
              <input
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={(current && localDateTime(current.startsAt)) || undefined}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit" className="button button--dark">
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="Удалить событие?" onClose={() => setRemoving(null)}>
          <div className="schedule-form">
            <p>{removing.title}</p>
            <div className="schedule-actions">
              <button type="button" className="button button--white" onClick={() => setRemoving(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="button button--dark"
                onClick={() => {
                  if (onChange(events.filter((event) => event.id !== removing.id))) setRemoving(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

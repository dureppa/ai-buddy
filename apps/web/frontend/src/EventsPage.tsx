import { WeekCalendar } from './WeekCalendar';
import { HrDayEvents } from './HrDayEvents';
import type { HrToday } from './hr-schedule';
import { useState, type FormEvent } from 'react';
import { eventKinds, localDateTime, type ScheduleEvent } from './schedule';
import { Icon, Modal } from './ui';
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
  const [selected, setSelected] = useState(() => new Date(now));
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
    if (
      !title ||
      !kind ||
      !Number.isFinite(startsAt.getTime()) ||
      (startsAt.getTime() <= Date.now() && startsAt.toISOString() !== current?.startsAt)
    ) {
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
    if (onChange([...events.filter((item) => item.id !== saved.id), saved])) {
      setSelected(startsAt);
      setEditing(null);
    }
  }

  return (
    <div className="schedule">
      <header className="schedule-heading">
        <div>
          <span className="schedule-heading-icon">
            <Icon name="calendar" size={22} />
          </span>
          <h1>События</h1>
          <p>Встречи, созвоны и напоминания в одном расписании</p>
        </div>
        <button type="button" className="button button--dark" onClick={() => open('new')}>
          Создать событие
        </button>
      </header>
      {(hrEvents.length > 0 || hrError) && (
        <section className="schedule-day">
          <h2>Сегодня по данным HR</h2>
          <div className="schedule-list schedule-hr">
            <HrDayEvents events={hrEvents} error={hrError} />
          </div>
        </section>
      )}
      <WeekCalendar selected={selected} today={new Date(now)} events={events} onSelect={setSelected} onOpen={open} />
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
                defaultValue={
                  current
                    ? localDateTime(current.startsAt)
                    : localDateTime(selected.toISOString()).slice(0, 10) + 'T09:00'
                }
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="schedule-actions">
              <button type="submit" className="button button--dark">
                Сохранить
              </button>
              {current && (
                <button
                  type="button"
                  className="button button--white"
                  onClick={() => {
                    setEditing(null);
                    setRemoving(current);
                  }}
                >
                  Удалить
                </button>
              )}
            </div>
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

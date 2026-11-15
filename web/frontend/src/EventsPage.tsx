import { WeekCalendar } from './WeekCalendar';
import { HrDayEvents } from './HrDayEvents';
import type { HrToday } from './hr-schedule';
import { useState, type FormEvent } from 'react';
import { eventKinds, localDateTime, type ScheduleEvent } from './schedule';
import { Modal, PageIntro } from './ui';
import './schedule.css';

type Props = {
  events: ScheduleEvent[];
  hrEvents: HrToday['events'];
  hrError: boolean;
  now: number;
  onChange: (events: ScheduleEvent[]) => boolean;
};

export function Schedule({ events, hrEvents, hrError, now, onChange }: Props) {
  const [editing, setEditing] = useState<ScheduleEvent | Date | null>(null);
  const [removing, setRemoving] = useState<ScheduleEvent | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Date(now));
  const current = editing instanceof Date ? null : editing;
  const [revealedEventId, setRevealedEventId] = useState<string>();

  function open(event: ScheduleEvent | Date) {
    setError('');
    setEditing(event);
  }

  function openNew() {
    const start = new Date(selected);
    start.setHours(9, 0, 0, 0);
    if (start.getTime() <= Date.now()) {
      const nextHour = new Date();
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      open(nextHour);
    } else {
      open(start);
    }
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
      id:
        current?.id ??
        'event-' +
          Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join(
            '',
          ),
      title,
      kind,
      startsAt: startsAt.toISOString(),
      tone: current?.tone ?? 'lilac',
      description: current?.description ?? '',
    };
    if (onChange([...events.filter((item) => item.id !== saved.id), saved])) {
      setSelected(startsAt);
      setRevealedEventId(saved.id);
      setEditing(null);
    } else {
      setError('Не удалось сохранить событие в браузере.');
    }
  }

  return (
    <>
      <PageIntro title="События" text="Встречи, созвоны и напоминания в одном расписании" tone="mint" icon="calendar" />
      <div className="schedule">
        {(hrEvents.length > 0 || hrError) && (
          <section className="schedule-day">
            <h2>Сегодня по данным HR</h2>
            <div className="schedule-list schedule-hr">
              <HrDayEvents events={hrEvents} error={hrError} />
            </div>
          </section>
        )}
        <WeekCalendar
          selected={selected}
          today={new Date(now)}
          events={events}
          onSelect={(date) => {
            setRevealedEventId(undefined);
            setSelected(date);
          }}
          onOpen={open}
          onCreate={open}
          revealedEventId={revealedEventId}
        />
        <div className="schedule-toolbar">
          <button type="button" className="button button--dark" onClick={openNew}>
            Создать событие
          </button>
        </div>
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
                  defaultValue={localDateTime(editing instanceof Date ? editing.toISOString() : editing.startsAt)}
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
    </>
  );
}

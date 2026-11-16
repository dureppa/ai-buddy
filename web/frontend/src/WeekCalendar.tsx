import { useLayoutEffect, useRef } from 'react';
import { eventTime, eventTones, type ScheduleEvent } from './schedule';
import { Icon } from './ui';

const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const weekdayLabel = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const fullDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full' });
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function shiftDay(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}
function weekStart(date: Date) {
  return shiftDay(date, -((date.getDay() + 6) % 7));
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CalendarArrows({ label, onShift }: { label: string; onShift: (offset: number) => void }) {
  return (
    <div className="calendar-arrows">
      <button type="button" aria-label={label + ' назад'} onClick={() => onShift(-1)}>
        <Icon name="chevron" size={16} />
      </button>
      <button type="button" aria-label={label + ' вперёд'} onClick={() => onShift(1)}>
        <Icon name="chevron" size={16} />
      </button>
    </div>
  );
}

export function WeekCalendar({
  selected,
  today,
  events,
  onSelect,
  onOpen,
  onCreate,
  revealedEventId,
}: {
  selected: Date;
  today: Date;
  events: ScheduleEvent[];
  onSelect: (date: Date) => void;
  onOpen: (event: ScheduleEvent) => void;
  onCreate: (date: Date) => void;
  revealedEventId?: string;
}) {
  const first = weekStart(selected);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(first, i));
  const month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const monthStart = weekStart(month);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const slots = new Map<string, ScheduleEvent[]>();
  for (const event of [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const date = new Date(event.startsAt);
    const index = week.findIndex((day) => sameDay(day, date));
    if (index < 0) continue;
    const key = date.getHours() + ':' + index;
    const slot = slots.get(key) ?? [];
    slot.push(event);
    slots.set(key, slot);
  }
  const revealedButton = useRef<HTMLButtonElement>(null);
  const revealedEvent = events.find((event) => event.id === revealedEventId);
  const firstHour = hours.find((hour) => week.some((_, index) => slots.has(hour + ':' + index))) ?? 9;
  const weekKey = first.getTime();
  useLayoutEffect(() => {
    if (revealedEvent && revealedButton.current) {
      revealedButton.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const row = rows.current[firstHour];
    const header = viewport.current?.querySelector('.calendar-weekdays');
    if (viewport.current && row && header) {
      viewport.current.scrollTop = row.offsetTop - header.clientHeight;
    }
  }, [weekKey, firstHour, revealedEvent]);

  return (
    <div className="week-calendar">
      <aside className="calendar-month" aria-label="Календарь месяца">
        <div className="calendar-month-heading">
          <h2>{monthLabel.format(month)}</h2>
          <CalendarArrows
            label="Месяц"
            onShift={(offset) => onSelect(new Date(month.getFullYear(), month.getMonth() + offset, 1))}
          />
        </div>
        <div className="calendar-mini-grid">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const day = shiftDay(monthStart, i);
            return (
              <button
                key={day.getTime()}
                type="button"
                className={day.getMonth() !== month.getMonth() ? 'calendar-other-month' : undefined}
                aria-label={fullDate.format(day)}
                aria-pressed={sameDay(day, selected)}
                aria-current={sameDay(day, today) ? 'date' : undefined}
                onClick={() => onSelect(day)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </aside>
      <section className="calendar-week" aria-label="Расписание на неделю">
        <div className="calendar-week-heading">
          <CalendarArrows label="Неделя" onShift={(offset) => onSelect(shiftDay(selected, offset * 7))} />
          <h2>
            {dayLabel.format(first)} — {dayLabel.format(week[6])}
          </h2>
        </div>
        <div className="calendar-viewport" ref={viewport} tabIndex={0} aria-label="Дни недели и часы">
          <div className="calendar-timeline">
            <div className="calendar-grid-row calendar-weekdays">
              <span />
              {week.map((day) => (
                <button
                  key={day.getTime()}
                  type="button"
                  aria-label={fullDate.format(day)}
                  aria-pressed={sameDay(day, selected)}
                  aria-current={sameDay(day, today) ? 'date' : undefined}
                  onClick={() => onSelect(day)}
                >
                  <span>{weekdayLabel.format(day)}</span>
                  <strong>{day.getDate()}</strong>
                </button>
              ))}
            </div>
            {hours.map((hour) => (
              <div
                className="calendar-grid-row calendar-hour"
                key={hour}
                ref={(node) => {
                  rows.current[hour] = node;
                }}
              >
                <span className="calendar-hour-label">{String(hour).padStart(2, '0')}:00</span>
                {week.map((day, index) => {
                  const start = new Date(day);
                  start.setHours(hour, 0, 0, 0);
                  const available = start > today;
                  const entries = slots.get(hour + ':' + index);
                  return (
                    <div className="calendar-slot" key={day.getTime()}>
                      {available && !entries?.length && (
                        <button
                          type="button"
                          className="calendar-create-slot"
                          aria-label={'Создать событие: ' + fullDate.format(day) + ', ' + eventTime.format(start)}
                          onClick={() => onCreate(start)}
                        >
                          <span aria-hidden="true">+</span>
                        </button>
                      )}
                      {entries?.map((event) => (
                        <button
                          key={event.id}
                          ref={event.id === revealedEventId ? revealedButton : undefined}
                          type="button"
                          className={'calendar-event tone-' + eventTones[event.kind]}
                          onClick={() => onOpen(event)}
                          title={event.title}
                        >
                          <time dateTime={event.startsAt}>{eventTime.format(new Date(event.startsAt))}</time>
                          <strong>{event.title}</strong>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

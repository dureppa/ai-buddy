import { useState } from 'react';
import { Icon } from '../../../web/frontend/src/ui';
import { calendarMonth } from '../../../ops/service-sites/frontend/src/hr-demo';
import { dateLabel, monthFormat, Submit, type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';

export function VacationForm({ view, submit }: FormProps) {
  const [month, setMonth] = useState(view.earliestVacation.slice(0, 7));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  function changeMonth(direction: number) {
    const first = new Date(month + '-01T00:00:00Z');
    first.setUTCMonth(first.getUTCMonth() + direction);
    setMonth(first.toISOString().slice(0, 7));
  }

  return (
    <form
      className="hr-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await submit({ service: 'absences', start, end: end || start }, 'Заявка на отпуск сохранена.')) {
          setStart('');
          setEnd('');
        }
      }}
    >
      <div className="hr-calendar">
        <div className="hr-calendar__head">
          <button
            type="button"
            className="icon-button hr-back-icon"
            aria-label="Предыдущий месяц"
            onClick={() => changeMonth(-1)}
          >
            <Icon name="chevron" />
          </button>
          <strong>{monthFormat.format(new Date(month + '-01'))}</strong>
          <button type="button" className="icon-button" aria-label="Следующий месяц" onClick={() => changeMonth(1)}>
            <Icon name="chevron" />
          </button>
        </div>
        <div className="hr-calendar__grid">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
            <span key={day}>{day}</span>
          ))}
          {calendarMonth(month).map((day, index) => {
            if (!day) return <span key={index} />;
            const booked = view.absences.some((item) => item.start <= day && day <= item.end);
            return (
              <button
                key={day}
                type="button"
                disabled={day < view.earliestVacation || booked || view.vacationLeft <= 0}
                aria-label={dateLabel(day) + (booked ? ', уже в заявке' : '')}
                aria-pressed={Boolean(start && day >= start && day <= (end || start))}
                onClick={() => {
                  if (!start || end || day < start) {
                    setStart(day);
                    setEnd('');
                  } else setEnd(day);
                }}
              >
                {Number(day.slice(-2))}
              </button>
            );
          })}
        </div>
      </div>
      <p className="hr-note">
        {start
          ? dateLabel(start) + (end && end !== start ? ' — ' + dateLabel(end) : '')
          : 'Выбери первый и последний день отпуска. Для одного дня достаточно одной даты.'}
      </p>
      <Submit disabled={!start}>Подать заявку</Submit>
    </form>
  );
}

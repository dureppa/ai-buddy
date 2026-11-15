import { corporateLinks } from './corporate-links';
import type { HrToday } from './hr-schedule';
import { Icon } from './ui';

export function HrDayEvents({ events, error }: { events: HrToday['events']; error: boolean }) {
  return (
    <>
      {error && <p role="status">Не удалось обновить часть данных HR.</p>}
      {events.length > 0 && (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id}>
              <a
                className="event-row"
                href={corporateLinks.find((link) => link.id === event.service)?.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={'event-date tone-' + (event.service === 'absences' ? 'mint' : 'blue')}>
                  <Icon name="calendar" size={19} />
                </span>
                <span>
                  <strong>{event.title}</strong>
                  <small>{event.detail}</small>
                </span>
                <Icon name="diagonal" size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

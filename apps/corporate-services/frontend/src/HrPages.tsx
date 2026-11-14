import { useState, type FormEvent, type ReactNode } from 'react';
import { profiles, type ProfileId } from '../../../web/frontend/src/data';
import { benefitOptions, consentOptions, destinations, exitSteps, vacancies, type HrService } from './hr-catalog';
import { calendarMonth, makeHrDemo, serviceHistory, travelNoticeDays, type HrDemo, type HrView } from './hr-demo';
import { Avatar, Icon, PageIntro } from '../../../web/frontend/src/ui';
import './hr.css';

const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const rubles = new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const dateLabel = (date: string) => dateFormat.format(new Date(date));

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel hr-panel">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Submit({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" className="button button--dark" disabled={disabled}>
      {children}
      <Icon name="arrow" size={17} />
    </button>
  );
}

type SubmitAction = (action: Parameters<HrDemo['submit']>[0], message: string) => boolean;
type FormProps = { view: HrView; submit: SubmitAction };

function VacationForm({ view, submit }: FormProps) {
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
      onSubmit={(event) => {
        event.preventDefault();
        if (submit({ service: 'absences', start, end: end || start }, 'Заявка на отпуск сохранена.')) {
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

function TripForm({ view, submit }: FormProps) {
  const [destination, setDestination] = useState<(typeof destinations)[number]>(destinations[0]);
  const [budget, setBudget] = useState(String(destination.estimate));
  if (!view.settings.travelEnabled) return <p className="hr-note">Поездки пока недоступны для твоего профиля.</p>;
  return (
    <form
      className="hr-form"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        submit(
          { service: 'trips', destination: destination.id, date: String(fields.get('date')), budget: Number(budget) },
          'Заявка на поездку сохранена.',
        );
      }}
    >
      <label>
        Город
        <select
          value={destination.id}
          onChange={(event) => {
            const city = destinations.find((item) => item.id === event.target.value);
            if (city) {
              setDestination(city);
              setBudget(String(city.estimate));
            }
          }}
        >
          {destinations.map((city) => (
            <option value={city.id} key={city.id}>
              {city.title}
            </option>
          ))}
        </select>
      </label>
      <p className="hr-note">
        {destination.description} · оценка {rubles.format(destination.estimate)}
      </p>
      <label>
        Дата выезда
        <input name="date" type="date" min={view.earliestTrip} required />
      </label>
      <label>
        Смета, ₽
        <input
          type="number"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          min={destination.estimate}
          max={view.settings.travelBudget}
          required
        />
      </label>
      <Submit>Сохранить заявку</Submit>
    </form>
  );
}

function HiringForm({ view, submit }: FormProps) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      submit(
        {
          service: 'hiring',
          vacancy: String(fields.get('vacancy')),
          name: String(fields.get('name')),
          email: String(fields.get('email')),
        },
        'Рекомендация сохранена.',
      )
    )
      form.reset();
  }

  return (
    <form className="hr-form" onSubmit={save}>
      <label>
        Вакансия
        <select name="vacancy">
          {vacancies.map((vacancy) => (
            <option value={vacancy.id} key={vacancy.id}>
              {vacancy.title} · {vacancy.description}
            </option>
          ))}
        </select>
      </label>
      <label>
        Имя кандидата
        <input name="name" autoComplete="off" minLength={2} maxLength={100} required />
      </label>
      <label>
        Электронная почта
        <input name="email" type="email" autoComplete="off" placeholder="name@example.com" required />
      </label>
      <Submit disabled={view.referralLeft <= 0}>Порекомендовать</Submit>
    </form>
  );
}

function ExitForm({ view, submit, onToggle }: FormProps & { onToggle: (id: string) => void }) {
  return (
    <form
      className="hr-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          { service: 'offboarding', date: String(new FormData(event.currentTarget).get('date')) },
          'Черновик завершения работы сохранён.',
        );
      }}
    >
      {exitSteps.map((step) => (
        <label className="hr-check" key={step.id}>
          <input
            type="checkbox"
            checked={view.exitChecklist.includes(step.id)}
            disabled={view.exitDraft}
            onChange={() => onToggle(step.id)}
          />
          <span>
            <strong>{step.title}</strong>
            <small>{step.description}</small>
          </span>
        </label>
      ))}
      {!view.exitDraft && (
        <>
          <label>
            Последний рабочий день
            <input name="date" type="date" min={view.earliestExit} required />
          </label>
          <Submit>Сохранить черновик</Submit>
        </>
      )}
      <p className="hr-note">Черновик виден только в демо. HR не получит уведомление.</p>
    </form>
  );
}

function ConsentForm({ view, submit }: FormProps) {
  return (
    <div className="hr-options">
      <div className="hr-option">
        <span>
          <strong>Рабочие данные</strong>
          <small>Учётная запись и кадровые документы.</small>
        </span>
        <span className="status">Обязательное</span>
      </div>
      {consentOptions.map((item) => {
        const granted = view.grants.has(item.id);
        return (
          <div className="hr-option" key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.description} {granted ? 'Согласие дано.' : 'Согласие не дано.'}
              </small>
            </span>
            <button
              className="button button--white"
              type="button"
              aria-label={(granted ? 'Отозвать: ' : 'Разрешить: ') + item.title}
              onClick={() =>
                submit(
                  { service: 'consents', consent: item.id, granted: !granted },
                  granted ? 'Согласие отозвано.' : 'Согласие сохранено.',
                )
              }
            >
              {granted ? 'Отозвать' : 'Разрешить'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function BenefitsForm({ view, submit }: FormProps) {
  return (
    <div className="hr-options">
      {benefitOptions.map((item) => {
        const requested = view.benefits.some((record) => record.benefit === item.id);
        const unavailable = !view.settings.benefits.includes(item.id);
        return (
          <div className="hr-option" key={item.id}>
            <span className="icon-tile tone-mint">
              <Icon name={item.icon} />
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.description} · {rubles.format(item.amount)}
              </small>
            </span>
            <button
              type="button"
              className="button button--white"
              disabled={requested || unavailable || item.amount > view.benefitLeft}
              aria-label={item.title + ' — запросить компенсацию'}
              onClick={() => submit({ service: 'benefits', benefit: item.id }, 'Заявка на компенсацию сохранена.')}
            >
              {requested
                ? 'Заявка подана'
                : unavailable
                  ? 'Недоступно'
                  : item.amount > view.benefitLeft
                    ? 'Сверх бюджета'
                    : 'Запросить'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function historyRow(item: HrView['history'][number]): [string, string] {
  switch (item.service) {
    case 'absences':
      return [dateLabel(item.start) + ' — ' + dateLabel(item.end), item.days + ' дн. · На согласовании'];
    case 'trips':
      return [
        destinations.find((city) => city.id === item.destination)?.title ?? item.destination,
        dateLabel(item.date) + ' · ' + rubles.format(item.budget) + ' · На согласовании',
      ];
    case 'hiring':
      return [
        item.name,
        (vacancies.find((vacancy) => vacancy.id === item.vacancy)?.title ?? item.vacancy) + ' · Передано в подбор',
      ];
    case 'offboarding':
      return ['Черновик завершения работы', 'Последний день · ' + dateLabel(item.date)];
    case 'consents':
      return [
        consentOptions.find((option) => option.id === item.consent)?.title ?? item.consent,
        item.granted ? 'Предоставлено' : 'Отозвано',
      ];
    case 'benefits':
      return [
        benefitOptions.find((option) => option.id === item.benefit)?.title ?? item.benefit,
        rubles.format(item.amount) + ' · На согласовании',
      ];
  }
}

export function HrPage({ service, profileId }: { service: HrService; profileId: ProfileId }) {
  const [demo] = useState(() => makeHrDemo(localStorage, profileId));
  const [view, setView] = useState(() => demo.read());
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean }>();
  const profile = profiles[profileId];

  function submit(action: Parameters<HrDemo['submit']>[0], message: string) {
    const result = demo.submit(action);
    setFeedback({ ok: result.ok, message: result.ok ? message : result.message });
    if (result.ok) setView(demo.read());
    return result.ok;
  }

  const [title, metric, note] = {
    absences: [
      'Запланировать отпуск',
      view.vacationLeft + ' дн.',
      'Доступно с ' + dateLabel(view.earliestVacation) + ' · подача за ' + view.settings.vacationNoticeDays + ' дн.',
    ],
    trips: [
      'Новая поездка',
      rubles.format(view.settings.travelBudget),
      'Лимит сметы · подача за ' + travelNoticeDays + ' дн.',
    ],
    hiring: [
      'Рекомендация кандидата',
      view.referralLeft + ' из ' + view.settings.referralSlots,
      'Рекомендаций осталось',
    ],
    offboarding: [
      'Подготовка к завершению',
      view.exitChecklist.length + ' из ' + exitSteps.length,
      'Шагов выполнено · уведомление за ' + view.settings.exitNoticeDays + ' дн.',
    ],
    consents: ['Доступные согласия', view.grants.size + ' из ' + consentOptions.length, 'Дополнительных согласий дано'],
    benefits: ['Программы компенсаций', rubles.format(view.benefitLeft), 'Остаток бюджета'],
  }[service.id];
  const props = { view, submit };
  const history = serviceHistory(view.history, service.id);
  const form = {
    absences: <VacationForm {...props} />,
    trips: <TripForm {...props} />,
    hiring: <HiringForm {...props} />,
    offboarding: (
      <ExitForm
        {...props}
        onToggle={(id) => {
          demo.toggleExitStep(id);
          setView(demo.read());
          setFeedback(undefined);
        }}
      />
    ),
    consents: <ConsentForm {...props} />,
    benefits: <BenefitsForm {...props} />,
  }[service.id];

  return (
    <main className="hr-page">
      <PageIntro title={service.title} text={service.description} tone={service.tone} icon={service.icon} />
      <div className="hr-layout">
        <Panel title={title}>
          {form}
          {feedback && (
            <p
              className={'hr-feedback' + (feedback.ok ? '' : ' hr-feedback--error')}
              role={feedback.ok ? 'status' : 'alert'}
            >
              <Icon name={feedback.ok ? 'check' : 'info'} size={18} />
              {feedback.message}
            </p>
          )}
        </Panel>
        <aside className="hr-aside" aria-label="Личные данные и история">
          <section className={'hr-metric tone-' + service.tone}>
            <div className="hr-metric__account">
              <Avatar initials={profile.initials} avatar={profile.avatar} />
              <span>
                <strong>{profile.fullName}</strong>
                <small>Демопрофиль</small>
              </span>
            </div>
            <span className="hr-metric__value">{metric}</span>
            <p>{note}</p>
          </section>
          <Panel title="История">
            {history.length ? (
              <ul className="hr-history">
                {history.map((item, index) => {
                  const [heading, detail] = historyRow(item);
                  return (
                    <li key={index}>
                      <Icon name="check" size={16} />
                      <span>
                        <strong>{heading}</strong>
                        <small>{detail}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="hr-note">Здесь появятся твои действия в этом сервисе.</p>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { profiles, type ProfileId } from '../../../web/frontend/src/data';
import { hrStatus, readAbsences, readTrips, submitHrRequest } from '../../../web/frontend/src/hr-schedule';
import { PageIntro } from '../../../web/frontend/src/ui';
import { VacationForm } from '../../../../services/hr/absences/frontend/VacationForm';
import { TripForm } from '../../../../services/hr/trips/frontend/TripForm';
import { dateLabel, type SubmitAction } from './form-shared';
import { hrServices } from './hr-catalog';
import { makeHrDemo } from './hr-demo';

type Service = 'absences' | 'trips';

export function LiveScheduleHr({ service }: { service: Service }) {
  const [profileId, setProfileId] = useState<ProfileId>('maria');
  const meta = hrServices.find((item) => item.id === service)!;

  return (
    <main className="hr-page">
      <PageIntro title={meta.title} text={meta.description} tone={meta.tone} icon={meta.icon} />
      <label>
        Демопрофиль{' '}
        <select value={profileId} onChange={(event) => setProfileId(event.target.value as ProfileId)}>
          {Object.entries(profiles).map(([id, profile]) => (
            <option key={id} value={id}>
              {profile.fullName}
            </option>
          ))}
        </select>
      </label>
      <Requests key={profileId} service={service} profileId={profileId} />
    </main>
  );
}

async function read(service: Service, profile: ProfileId, signal?: AbortSignal) {
  return service === 'absences'
    ? ({ service, data: await readAbsences(profile, signal) } as const)
    : ({ service, data: await readTrips(profile, signal) } as const);
}

function Requests({ service, profileId }: { service: Service; profileId: ProfileId }) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof read>>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    read(service, profileId, controller.signal)
      .then(setSnapshot)
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось загрузить заявки. Обновите страницу.');
      });
    return () => controller.abort();
  }, [service, profileId]);

  const submit: SubmitAction = async (action, message) => {
    if (action.service !== 'absences' && action.service !== 'trips') return false;
    setPending(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      if (action.service === 'absences') {
        await submitHrRequest(profileId, { start: action.start, end: action.end });
      } else {
        await submitHrRequest(profileId, { destination: action.destination, date: action.date, budget: action.budget });
      }
      saved = true;
      setNotice(message);
      setSnapshot(await read(service, profileId));
    } catch {
      setError(
        saved
          ? 'Заявка сохранена. Обновите страницу, чтобы увидеть её.'
          : 'Не удалось сохранить заявку. Проверьте даты и доступный лимит.',
      );
    } finally {
      setPending(false);
    }
    return saved;
  };

  if (!snapshot) return error ? <p role="alert">{error}</p> : <p role="status">Загружаем заявки…</p>;

  const base = makeHrDemo({ getItem: () => null, setItem: () => {} }, profileId).read();
  const view =
    snapshot.service === 'absences'
      ? {
          ...base,
          earliestVacation: snapshot.data.earliest_vacation,
          vacationLeft: snapshot.data.vacation_left,
          absences: snapshot.data.requests
            .filter((item) => item.status === 'pending' || item.status === 'approved')
            .map((item) => ({ ...item, service: 'absences' as const })),
        }
      : {
          ...base,
          earliestTrip: snapshot.data.earliest_trip,
          settings: {
            ...base.settings,
            travelEnabled: snapshot.data.travel_enabled,
            travelBudget: snapshot.data.travel_budget,
          },
        };

  return (
    <div className="hr-layout">
      <section className="panel hr-panel">
        <h2>{snapshot.service === 'absences' ? 'Запланировать отпуск' : 'Новая поездка'}</h2>
        <fieldset disabled={pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
          {snapshot.service === 'absences' ? (
            <VacationForm view={view} submit={submit} />
          ) : (
            <TripForm view={view} submit={submit} />
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="panel hr-panel">
        <h2>История</h2>
        <ul className="hr-history">
          {snapshot.data.requests.map((item) => (
            <li key={item.id}>
              <span>
                <strong>
                  {'date' in item ? dateLabel(item.date) : dateLabel(item.start) + ' — ' + dateLabel(item.end)}
                </strong>
                <small>{hrStatus(item.status)}</small>
              </span>
            </li>
          ))}
        </ul>
        {!snapshot.data.requests.length && <p className="hr-note">Здесь появятся твои заявки.</p>}
      </section>
    </div>
  );
}

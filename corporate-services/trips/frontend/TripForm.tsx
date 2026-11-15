import { useState } from 'react';
import { rubles, Submit, type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';
import { destinations } from './meta';

export function TripForm({ view, submit }: FormProps) {
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

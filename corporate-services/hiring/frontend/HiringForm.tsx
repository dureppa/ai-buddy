import type { FormEvent } from 'react';
import { Submit, type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';
import { vacancies } from './meta';

export function HiringForm({ view, submit }: FormProps) {
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

import { Submit, type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';
import { exitSteps } from './meta';

type Step = { id: string; title: string; description: string };

export function ExitForm({
  view,
  submit,
  onToggle,
  steps = exitSteps,
}: FormProps & {
  onToggle: (id: string) => void;
  steps?: readonly Step[];
}) {
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
      {steps.map((step) => (
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

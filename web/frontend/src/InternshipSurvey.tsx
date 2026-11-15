import { useId, useLayoutEffect, useRef, useState } from 'react';
import { surveys, type SurveyAnswers, type SurveyStage } from './surveys';

export function InternshipSurvey({
  stage,
  onSubmit,
}: {
  stage: SurveyStage;
  onSubmit: (answers: SurveyAnswers) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState('forward');
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const { questions } = surveys[stage];
  const question = questions[step];
  const last = step === questions.length - 1;

  useLayoutEffect(() => {
    heading.current?.focus();
  }, [step]);

  function move(offset: number) {
    setDirection(offset < 0 ? 'back' : 'forward');
    setStep(step + offset);
  }

  function answer(value: string) {
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
  }

  return (
    <form
      className="detail-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || (question.options && !answers[question.id])) return;
        if (!last) {
          move(1);
          return;
        }
        setSaving(true);
        setFailed(false);
        try {
          await onSubmit(answers);
        } catch {
          setFailed(true);
          setSaving(false);
        }
      }}
    >
      <p>
        Вопрос {step + 1} из {questions.length}
      </p>
      <div key={question.id} className={'survey-step survey-step--' + direction}>
        <h3 id={id} ref={heading} tabIndex={-1}>
          {question.prompt}
        </h3>
        {question.options ? (
          <fieldset aria-labelledby={id}>
            {question.options.map((option, index) => {
              const value = index === 5 ? 'na' : String(index + 1);
              return (
                <label key={value} className="radio-row">
                  <input
                    type="radio"
                    name={question.id}
                    value={value}
                    checked={answers[question.id] === value}
                    onChange={() => answer(value)}
                  />
                  {option}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <textarea
            aria-labelledby={id}
            placeholder="Необязательно"
            maxLength={1000}
            value={answers[question.id] ?? ''}
            onChange={(event) => answer(event.currentTarget.value)}
            disabled={saving}
          />
        )}
      </div>
      {failed && <p role="alert">Не удалось сохранить ответы. Попробуй отправить их ещё раз.</p>}
      <div className="survey-actions">
        {step > 0 && (
          <button className="button button--white" type="button" disabled={saving} onClick={() => move(-1)}>
            Назад
          </button>
        )}
        <button
          className="button button--dark"
          type="submit"
          disabled={saving || (!!question.options && !answers[question.id])}
        >
          {saving ? 'Отправляем…' : last ? 'Отправить ответы' : 'Далее'}
        </button>
      </div>
    </form>
  );
}

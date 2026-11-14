import { useEffect, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from './backend';
import { profiles, type ProfileId } from './data';
import type { StaffId } from './demo-accounts';

const reviewSchema = z.object({
  profile_id: z.string(),
  evaluation_id: z.string(),
  answer: z.string(),
  state: z.enum(['evaluating', 'awaiting_review', 'needs_revision', 'completed']),
  review_note: z.string(),
  assessment: z
    .object({
      recommendation: z.string(),
      criteria: z.array(z.object({ criterion_id: z.string(), verdict: z.string(), reason: z.string() })),
    })
    .nullable(),
});
type Review = z.infer<typeof reviewSchema>;
const states = {
  evaluating: 'Проверяем знания',
  awaiting_review: 'Ожидает наставника',
  needs_revision: 'Нужна доработка',
  completed: 'Задание завершено наставником',
};

function Result({ review }: { review: Review }) {
  return (
    <div>
      <p role="status">{states[review.state]}</p>
      {review.assessment?.criteria.map((criterion) => (
        <p key={criterion.criterion_id}>
          {criterion.reason} ({criterion.verdict})
        </p>
      ))}
      {review.review_note && <p>Комментарий наставника: {review.review_note}</p>}
    </div>
  );
}

export function ReviewPanel({ profileId }: { profileId: ProfileId }) {
  const [answer, setAnswer] = useState('');
  const [review, setReview] = useState<Review>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      const response = await apiFetch(profileId, '/api/v1/onboarding/consent-review');
      setReview(reviewSchema.parse(await response.json()));
    } catch {
      setError('Оценки пока нет либо сервис недоступен.');
    }
  }
  useEffect(() => {
    let active = true;
    apiFetch(profileId, '/api/v1/onboarding/consent-review')
      .then((response) => response.json())
      .then((body) => {
        if (active) setReview(reviewSchema.parse(body));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profileId]);
  return (
    <section className="panel hr-panel">
      <h2>Учебное задание: согласия</h2>
      <p>
        В сервисе согласий выбери тот же демопрофиль и предоставь учебное согласие на внутренние новости. Затем объясни:
        как изменить согласие, можно ли его отозвать и кто одобряет завершение задания?
      </p>
      <a
        className="text-link"
        href={import.meta.env.VITE_CONSENTS_URL || 'http://localhost:5185/'}
        target="_blank"
        rel="noreferrer"
      >
        Открыть согласия
      </a>
      {review && <Result review={review} />}
      {error && <p role="alert">{error}</p>}
      <form
        className="detail-form"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError('');
          apiFetch(profileId, '/api/v1/onboarding/consent-review', { method: 'POST', body: JSON.stringify({ answer }) })
            .then((response) => response.json())
            .then((body) => setReview(reviewSchema.parse(body)))
            .catch(() => setError('Не удалось оценить ответ. Проверь учебное согласие и попробуй ещё раз.'))
            .finally(() => setPending(false));
        }}
      >
        <label>
          Твой ответ
          <textarea
            value={answer}
            maxLength={4000}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={pending || review?.state === 'completed'}
          />
        </label>
        <div className="button-row">
          <button className="button button--dark" disabled={pending || !answer.trim() || review?.state === 'completed'}>
            {pending ? 'Проверяем…' : 'Проверить знания'}
          </button>
          <button className="button button--white" type="button" disabled={pending} onClick={() => void refresh()}>
            Обновить статус
          </button>
        </div>
      </form>
    </section>
  );
}

export function StaffReviews({ staff }: { staff: StaffId }) {
  const [profile, setProfile] = useState<ProfileId>('olga');
  const [review, setReview] = useState<Review>();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function request(approve?: boolean) {
    setPending(true);
    setError('');
    try {
      const login = await fetch('/api/v1/demo/staff-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staff === 'mentor' ? 'mentor' : 'lead' }),
      });
      if (!login.ok) throw new Error();
      const token = z.object({ access_token: z.string() }).parse(await login.json()).access_token;
      const response = await fetch('/api/v1/staff/reviews/' + profile, {
        method: approve === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(approve === undefined
          ? {}
          : { body: JSON.stringify({ evaluation_id: review?.evaluation_id, approve, note }) }),
      });
      if (!response.ok) throw new Error();
      setReview(reviewSchema.parse(await response.json()));
    } catch {
      setError('Нет доступной оценки либо она изменилась. Обнови данные перед решением.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel hr-panel">
      <h2>Проверка учебного задания</h2>
      <label>
        Стажёр{' '}
        <select
          value={profile}
          disabled={pending}
          onChange={(event) => {
            setProfile(event.target.value as ProfileId);
            setReview(undefined);
            setError('');
          }}
        >
          {(staff === 'mentor' ? (['olga', 'sasha'] as const) : (['olga', 'sasha', 'maria'] as const)).map((id) => (
            <option key={id} value={id}>
              {profiles[id].fullName}
            </option>
          ))}
        </select>
      </label>
      <button className="button button--white" disabled={pending} onClick={() => void request()}>
        Загрузить оценку
      </button>
      {error && <p role="alert">{error}</p>}
      {review && (
        <>
          <p>Ответ стажёра: {review.answer}</p>
          <Result review={review} />
          {review.state === 'awaiting_review' && (
            <>
              <label>
                Комментарий
                <textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
              </label>
              <div className="button-row">
                <button className="button button--dark" disabled={pending} onClick={() => void request(true)}>
                  Одобрить завершение
                </button>
                <button className="button button--white" disabled={pending} onClick={() => void request(false)}>
                  На доработку
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

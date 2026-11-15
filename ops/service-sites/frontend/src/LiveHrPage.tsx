import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiFetch } from '../../../../web/frontend/src/backend';
import type { ProfileId } from '../../../../web/frontend/src/data';
import { PageIntro } from '../../../../web/frontend/src/ui';
import type { SubmitAction } from './form-shared';
import { HrPageContent } from './HrPages';
import { hrServices } from './hr-catalog';
import { makeHrDemo } from './hr-demo';

const catalogItem = z.object({ id: z.string(), title: z.string(), description: z.string() });
const hiring = z.object({
  referral_slots: z.number(),
  referral_left: z.number(),
  vacancies: z.array(catalogItem),
  referrals: z.array(z.object({ vacancy: z.string(), name: z.string(), email: z.string() })),
});
const benefits = z.object({
  benefit_budget: z.number(),
  benefit_left: z.number(),
  options: z.array(catalogItem.extend({ amount: z.number(), available: z.boolean() })),
  requests: z.array(z.object({ benefit: z.string(), amount: z.number() })),
});
const offboarding = z.object({
  exit_notice_days: z.number(),
  earliest_exit: z.iso.date(),
  checklist: z.array(z.string()),
  steps: z.array(catalogItem),
  draft: z.object({ date: z.iso.date() }).nullable(),
});

const endpoints = {
  hiring: '/hr-api/v1/me/referral-summary',
  benefits: '/hr-api/v1/me/benefit-summary',
  offboarding: '/hr-api/v1/me/offboarding',
};
type Service = keyof typeof endpoints;

async function read(service: Service, profileId: ProfileId, signal?: AbortSignal) {
  const response = await apiFetch(profileId, endpoints[service], { signal });
  const data: unknown = await response.json();
  const base = makeHrDemo({ getItem: () => null, setItem: () => {} }, profileId).read();

  switch (service) {
    case 'hiring': {
      const summary = hiring.parse(data);
      const referrals = summary.referrals.map((item) => ({ ...item, service }));
      return {
        view: {
          ...base,
          settings: { ...base.settings, referralSlots: summary.referral_slots },
          referralLeft: summary.referral_left,
          referrals,
          history: referrals,
        },
        jobs: summary.vacancies,
      };
    }
    case 'benefits': {
      const summary = benefits.parse(data);
      const requests = summary.requests.map((item) => ({ ...item, service }));
      return {
        view: {
          ...base,
          settings: {
            ...base.settings,
            benefitBudget: summary.benefit_budget,
            benefits: summary.options.filter((option) => option.available).map((option) => option.id),
          },
          benefitLeft: summary.benefit_left,
          benefits: requests,
          history: requests,
        },
        programs: summary.options,
      };
    }
    case 'offboarding': {
      const summary = offboarding.parse(data);
      return {
        view: {
          ...base,
          settings: { ...base.settings, exitNoticeDays: summary.exit_notice_days },
          exitChecklist: summary.checklist,
          earliestExit: summary.earliest_exit,
          exitDraft: summary.draft !== null,
          history: summary.draft ? [{ service, date: summary.draft.date }] : [],
        },
        steps: summary.steps,
      };
    }
  }
}

export function LiveHrPage({ service, profileId }: { service: Service; profileId: ProfileId }) {
  const meta = hrServices.find((item) => item.id === service)!;
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof read>>>();
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean }>();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    read(service, profileId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFeedback({ message: 'Не удалось загрузить данные. Обновите страницу.', ok: false });
        }
      });
    return () => controller.abort();
  }, [service, profileId]);

  async function save(path: string, method: 'POST' | 'PUT', body: object, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setPending(true);
    setFeedback(undefined);
    let saved = false;
    try {
      await apiFetch(profileId, '/hr-api/v1/me/' + path, { method, body: JSON.stringify(body) });
      saved = true;
      setSnapshot(await read(service, profileId));
      setFeedback({ message, ok: true });
    } catch {
      if (saved) setSnapshot(undefined);
      setFeedback({
        message: saved
          ? 'Изменения сохранены. Обновите страницу, чтобы увидеть их.'
          : 'Не удалось сохранить изменения. Проверьте данные и попробуйте ещё раз.',
        ok: saved,
      });
    } finally {
      saving.current = false;
      setPending(false);
    }
    return saved;
  }

  const submit: SubmitAction = (action, message) => {
    switch (action.service) {
      case 'hiring':
        return save('referrals', 'POST', { vacancy: action.vacancy, name: action.name, email: action.email }, message);
      case 'benefits':
        return save('benefit-requests', 'POST', { benefit: action.benefit }, message);
      case 'offboarding':
        return save('offboarding/draft', 'POST', { date: action.date }, message);
      default:
        return false;
    }
  };

  if (!snapshot) {
    return (
      <main className="hr-page">
        <PageIntro title={meta.title} text={meta.description} tone={meta.tone} icon={meta.icon} />
        <p role={feedback?.ok === false ? 'alert' : 'status'}>{feedback?.message ?? 'Загружаем данные…'}</p>
      </main>
    );
  }

  return (
    <HrPageContent
      {...snapshot}
      service={meta}
      profileId={profileId}
      submit={submit}
      pending={pending}
      feedback={feedback}
      onToggle={(id) =>
        save(
          'offboarding/checklist/' + encodeURIComponent(id),
          'PUT',
          { checked: !snapshot.view.exitChecklist.includes(id) },
          'Чек-лист обновлён.',
        )
      }
    />
  );
}

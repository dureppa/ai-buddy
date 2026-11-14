import { z } from 'zod';
import type { ProfileId } from '../../../web/frontend/src/data';
import type { StoragePort } from '../../../web/frontend/src/demo';
import { benefitOptions, consentOptions, destinations, exitSteps, vacancies, type HrService } from './hr-catalog';
import fixtures from './hr-profiles.json';

const dateSchema = z.iso.date();
const emailSchema = z.email();
const events = z.discriminatedUnion('service', [
  z.object({ service: z.literal('absences'), start: dateSchema, end: dateSchema, days: z.number().int().positive() }),
  z.object({
    service: z.literal('trips'),
    destination: z.string(),
    date: dateSchema,
    budget: z.number().int().positive(),
  }),
  z.object({ service: z.literal('hiring'), vacancy: z.string(), name: z.string(), email: emailSchema }),
  z.object({ service: z.literal('offboarding'), date: dateSchema }),
  z.object({ service: z.literal('consents'), consent: z.string(), granted: z.boolean() }),
  z.object({ service: z.literal('benefits'), benefit: z.string(), amount: z.number().int().positive() }),
]);

type HrEvent = z.infer<typeof events>;
type HrAction =
  | { service: 'absences'; start: string; end: string }
  | { service: 'trips'; destination: string; date: string; budget: number }
  | { service: 'hiring'; vacancy: string; name: string; email: string }
  | { service: 'offboarding'; date: string }
  | { service: 'consents'; consent: string; granted: boolean }
  | { service: 'benefits'; benefit: string };

const stateSchema = z.object({ history: z.array(events), exitChecklist: z.array(z.string()) });
type HrState = z.infer<typeof stateSchema>;

const dayMs = 86400000;
export const travelNoticeDays = 10;

export function addDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
}

function intervalsOverlap(first: { start: string; end: string }, second: { start: string; end: string }) {
  return first.start <= second.end && second.start <= first.end;
}

export function calendarMonth(month: string) {
  const first = new Date(month + '-01T00:00:00Z');
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: offset + days }, (_, index) =>
    index < offset ? null : addDays(month + '-01', index - offset),
  );
}

export function todayInMoscow() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts();
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

export function makeHrDemo(storage: StoragePort, profile: ProfileId, today = todayInMoscow()) {
  const key = 'ai-buddy.hr.' + profile;
  const settings = fixtures[profile];
  const fallback: HrState = { history: [], exitChecklist: settings.exitChecklist };

  function read(): HrState {
    const saved = storage.getItem(key);
    if (!saved) return fallback;
    try {
      const parsed = stateSchema.safeParse(JSON.parse(saved));
      return parsed.success ? parsed.data : fallback;
    } catch {
      return fallback;
    }
  }

  function save(state: HrState) {
    storage.setItem(key, JSON.stringify(state));
  }

  function summarize(state: HrState) {
    const absences = state.history.filter((item) => item.service === 'absences');
    const trips = state.history.filter((item) => item.service === 'trips');
    const referrals = state.history.filter((item) => item.service === 'hiring');
    const benefits = state.history.filter((item) => item.service === 'benefits');
    const grants = new Set(settings.consents);
    for (const item of state.history) {
      if (item.service !== 'consents') continue;
      if (item.granted) grants.add(item.consent);
      else grants.delete(item.consent);
    }
    return {
      ...state,
      settings,
      absences,
      trips,
      referrals,
      benefits,
      grants,
      vacationLeft: settings.vacationDays - absences.reduce((sum, item) => sum + item.days, 0),
      referralLeft: settings.referralSlots - referrals.length,
      benefitLeft: settings.benefitBudget - benefits.reduce((sum, item) => sum + item.amount, 0),
      exitDraft: state.history.some((item) => item.service === 'offboarding'),
      earliestVacation: addDays(today, settings.vacationNoticeDays),
      earliestTrip: addDays(today, travelNoticeDays),
      earliestExit: addDays(today, settings.exitNoticeDays),
    };
  }

  function validate(action: HrAction, view: ReturnType<typeof summarize>): string | HrEvent {
    switch (action.service) {
      case 'absences': {
        if (
          !dateSchema.safeParse(action.start).success ||
          !dateSchema.safeParse(action.end).success ||
          action.end < action.start
        ) {
          return 'Выбери начало и конец отпуска.';
        }
        if (action.start < view.earliestVacation) return 'Для этих дат срок подачи уже прошёл.';
        if (view.absences.some((item) => intervalsOverlap(action, item)))
          return 'Период пересекается с другой заявкой.';
        const days = (Date.parse(action.end) - Date.parse(action.start)) / dayMs + 1;
        if (days > view.vacationLeft) return 'На этот период не хватает отпускных дней.';
        return { ...action, days };
      }
      case 'trips': {
        const city = destinations.find((item) => item.id === action.destination);
        if (!settings.travelEnabled) return 'Для твоего профиля поездки пока недоступны.';
        if (view.trips.some((item) => item.date >= today)) return 'У тебя уже есть заявка на предстоящую поездку.';
        if (!city || !dateSchema.safeParse(action.date).success || action.date < view.earliestTrip)
          return 'Выбери город и дату с учётом срока подачи.';
        if (
          !Number.isInteger(action.budget) ||
          action.budget < city.estimate ||
          action.budget > settings.travelBudget
        ) {
          return 'Укажи смету от оценки поездки до своего лимита.';
        }
        return action;
      }
      case 'hiring': {
        const name = action.name.trim();
        const email = action.email.trim().toLowerCase();
        if (
          !vacancies.some((item) => item.id === action.vacancy) ||
          name.length < 2 ||
          name.length > 100 ||
          !emailSchema.safeParse(email).success
        ) {
          return 'Проверь вакансию, имя и почту кандидата.';
        }
        if (view.referrals.some((item) => item.email === email && item.vacancy === action.vacancy))
          return 'Такая рекомендация уже есть.';
        if (view.referralLeft <= 0) return 'Лимит рекомендаций исчерпан.';
        return { ...action, name, email };
      }
      case 'offboarding':
        if (view.exitDraft) return 'Черновик уже сохранён.';
        if (!exitSteps.every((step) => view.exitChecklist.includes(step.id))) return 'Отметь все шаги подготовки.';
        if (!dateSchema.safeParse(action.date).success || action.date < view.earliestExit)
          return 'Выбери дату с учётом срока уведомления.';
        return action;
      case 'consents':
        if (!consentOptions.some((item) => item.id === action.consent)) return 'Это согласие обязательно для работы.';
        if (view.grants.has(action.consent) === action.granted) return 'Согласие уже в этом состоянии.';
        return action;
      case 'benefits': {
        const option = benefitOptions.find((item) => item.id === action.benefit);
        if (!option || !settings.benefits.includes(option.id)) return 'Эта программа недоступна для твоего профиля.';
        if (view.benefits.some((item) => item.benefit === option.id)) return 'По этой программе уже есть заявка.';
        if (option.amount > view.benefitLeft) return 'Остатка бюджета не хватает на эту программу.';
        return { ...action, amount: option.amount };
      }
    }
  }

  return {
    read: () => summarize(read()),
    submit(action: HrAction): { ok: true } | { ok: false; message: string } {
      const state = read();
      const result = validate(action, summarize(state));
      if (typeof result === 'string') return { ok: false, message: result };
      save({ ...state, history: [...state.history, result] });
      return { ok: true };
    },
    toggleExitStep(id: string) {
      const state = read();
      if (!exitSteps.some((step) => step.id === id) || summarize(state).exitDraft) return;
      const exitChecklist = state.exitChecklist.includes(id)
        ? state.exitChecklist.filter((item) => item !== id)
        : [...state.exitChecklist, id];
      save({ ...state, exitChecklist });
    },
  };
}

export function serviceHistory(history: HrEvent[], service: HrService['id']) {
  return history.filter((item) => item.service === service).reverse();
}

export type HrDemo = ReturnType<typeof makeHrDemo>;
export type HrView = ReturnType<HrDemo['read']>;

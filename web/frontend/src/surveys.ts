import { z } from 'zod';
import { apiFetch, backendEnabled } from './backend';
import type { ProfileId } from './demo-accounts';

export const surveyStages = ['first', 'midpoint', 'final'] as const;
export type SurveyStage = (typeof surveyStages)[number];
export type SurveyAnswers = Record<string, string>;
const stageSchema = z.enum(surveyStages);

type Question = { id: string; prompt: string; options?: readonly string[] };

const rating = ['Совсем нет', 'Скорее нет', 'Частично', 'Скорее да', 'Полностью'];
const satisfaction = ['Совсем не доволен', 'Скорее не доволен', 'Нейтрально', 'Скорее доволен', 'Полностью доволен'];
const common: Question[] = [
  { id: 'mentor', prompt: 'Насколько ты доволен поддержкой наставника?', options: [...satisfaction, 'Не обращался'] },
  { id: 'hr_bp', prompt: 'Насколько ты доволен поддержкой HR BP?', options: [...satisfaction, 'Не обращался'] },
  { id: 'buddy', prompt: 'Насколько ты доволен работой AI Buddy?', options: [...satisfaction, 'Не пользовался'] },
  {
    id: 'frequency',
    prompt: 'Как часто ты пользуешься AI Buddy?',
    options: ['Ни разу', 'Один раз', 'Реже раза в неделю', 'Несколько раз в неделю', 'Почти каждый день'],
  },
];

export const surveys = {
  first: {
    title: 'Опрос о начале стажировки',
    questions: [
      ...common,
      { id: 'tasks', prompt: 'Понятно ли, с каких задач начать?', options: rating },
      { id: 'access', prompt: 'Хватает ли тебе доступов для первых задач?', options: rating },
      { id: 'comment', prompt: 'Что мешает начать работу или что можно улучшить?' },
    ],
  },
  midpoint: {
    title: 'Опрос на экваторе стажировки',
    questions: [
      ...common,
      { id: 'feedback', prompt: 'Хватает ли тебе обратной связи по работе?', options: rating },
      { id: 'goals', prompt: 'Понятны ли цели на вторую половину стажировки?', options: rating },
      { id: 'comment', prompt: 'Где тебе нужна помощь во второй половине стажировки?' },
    ],
  },
  final: {
    title: 'Финальный опрос о стажировке',
    questions: [
      ...common,
      { id: 'outcomes', prompt: 'Удалось ли тебе достичь целей стажировки?', options: rating },
      { id: 'usefulness', prompt: 'Пригодятся ли тебе навыки, полученные на стажировке?', options: rating },
      { id: 'comment', prompt: 'Что помогло больше всего и что стоит изменить для следующих стажёров?' },
    ],
  },
} satisfies Record<SurveyStage, { title: string; questions: Question[] }>;

export function surveyStage(value: string | null): SurveyStage | undefined {
  return stageSchema.safeParse(value).data;
}

export function surveyForTask(id: string): SurveyStage | undefined {
  if (id === 'internship-survey') return 'final';
  return id.startsWith('internship-survey-') ? surveyStage(id.slice('internship-survey-'.length)) : undefined;
}

export function surveyTaskId(stage: SurveyStage) {
  return stage === 'final' ? 'internship-survey' : 'internship-survey-' + stage;
}

const notificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  action_title: z.string(),
  action_url: z
    .string()
    .regex(/^\/(?!\/)/)
    .or(z.literal(''))
    .catch(''),
  read: z.boolean(),
});

const localAnswersKey = (profile: ProfileId, stage: SurveyStage) => 'ai-buddy.survey-answers.' + profile + '.' + stage;
const localReadKey = (profile: ProfileId, id: string) => 'ai-buddy.notification-read.' + profile + '.' + id;

export async function completedSurveys(profile: ProfileId): Promise<SurveyStage[]> {
  if (!backendEnabled) return surveyStages.filter((stage) => localStorage.getItem(localAnswersKey(profile, stage)));
  const response = await apiFetch(profile, '/api/v1/onboarding/surveys');
  return z.array(stageSchema).parse(await response.json());
}

export async function submitSurvey(profile: ProfileId, stage: SurveyStage, answers: SurveyAnswers) {
  if (!backendEnabled) {
    const key = localAnswersKey(profile, stage);
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(answers));
    return;
  }
  await apiFetch(profile, '/api/v1/onboarding/surveys/' + stage, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  });
}

const localStageNotifications = {
  first: {
    id: 'first-day',
    title: 'Твой первый день',
    text: 'Сегодня в 14:00 — знакомство с лидом.',
    action_title: 'Посмотреть план',
    action_url: '/onboarding',
  },
  final: {
    id: 'graduation',
    title: 'Финал стажировки',
    text: 'Проверь итоги адаптации и подготовься к переходу в команду.',
    action_title: 'Открыть итоги',
    action_url: '/onboarding',
  },
};

export function notificationSurvey(url: string) {
  const prefix = '/onboarding?survey=';
  return url.startsWith(prefix) ? surveyStage(url.slice(prefix.length)) : undefined;
}

export async function readNotifications(profile: ProfileId, stage: SurveyStage) {
  if (!backendEnabled) {
    const reminder = {
      id: 'survey-' + stage,
      title: surveys[stage].title,
      text: 'Поделись впечатлениями о стажировке.',
      action_title: 'Пройти опрос',
      action_url: '/onboarding?survey=' + stage,
    };
    const notifications = stage === 'midpoint' ? [reminder] : [reminder, localStageNotifications[stage]];
    return notifications.map((notification) => ({
      ...notification,
      read: localStorage.getItem(localReadKey(profile, notification.id)) === 'true',
    }));
  }
  const response = await apiFetch(profile, '/api/v1/notifications');
  return z.array(notificationSchema).parse(await response.json());
}

export async function markNotificationsRead(profile: ProfileId, ids: string[]) {
  if (!backendEnabled) {
    ids.forEach((id) => localStorage.setItem(localReadKey(profile, id), 'true'));
    return;
  }
  await apiFetch(profile, '/api/v1/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
}

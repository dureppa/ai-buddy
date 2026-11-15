// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  completedSurveys,
  markNotificationsRead,
  notificationSurvey,
  readNotifications,
  submitSurvey,
  surveyForTask,
  surveyStages,
  surveyTaskId,
} from './surveys';

beforeEach(() => {
  vi.stubEnv('VITE_API_ENABLED', 'false');
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

it('uses one stable task ID and reminder link per survey stage', () => {
  for (const stage of surveyStages) {
    expect(surveyForTask(surveyTaskId(stage))).toBe(stage);
    expect(notificationSurvey('/onboarding?survey=' + stage)).toBe(stage);
  }
  expect(surveyForTask('meet-team')).toBeUndefined();
  expect(notificationSurvey('/onboarding?survey=unknown')).toBeUndefined();
  expect(notificationSurvey('https://example.com')).toBeUndefined();
});

it('stores original answers and read status by profile in web-only mode', async () => {
  for (const stage of surveyStages) await submitSurvey('olga', stage, { mentor: '5' });
  await submitSurvey('olga', 'first', { mentor: '1' });
  expect(await completedSurveys('olga')).toEqual(surveyStages);
  expect(await completedSurveys('timur')).toEqual([]);
  expect(localStorage.getItem('ai-buddy.survey-answers.olga.first')).toBe('{"mentor":"5"}');

  const [reminder] = await readNotifications('olga', 'first');
  expect(reminder.read).toBe(false);
  await markNotificationsRead('olga', [reminder.id]);
  expect((await readNotifications('olga', 'first'))[0].read).toBe(true);
  expect((await readNotifications('timur', 'first'))[0].read).toBe(false);
});
